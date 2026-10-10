import * as ImagePicker from "expo-image-picker";
import { Directory, File, Paths } from "expo-file-system";
import * as Crypto from "expo-crypto";
import * as SQLite from "expo-sqlite";
import type { ApiClient, Scope } from "@doul/client";

export interface SavedCapture {
  id: string;
  projectId: string;
  partyId: string;
  uri: string;
  name: string;
  mime: string;
  hash: string;
  capturedAt: string;
  status: "pending" | "uploaded";
}
let database: Promise<SQLite.SQLiteDatabase> | undefined;
async function db() {
  database ??= (async () => {
    const d = await SQLite.openDatabaseAsync("doul-field.db");
    await d.execAsync(
      "CREATE TABLE IF NOT EXISTS captures (id TEXT PRIMARY KEY, project TEXT NOT NULL, party TEXT NOT NULL, payload TEXT NOT NULL);",
    );
    return d;
  })();
  return database;
}
export async function listCaptures(
  projectId: string,
  partyId: string,
): Promise<SavedCapture[]> {
  const d = await db();
  const rows = await d.getAllAsync<{ payload: string }>(
    "SELECT payload FROM captures WHERE project=? AND party=?",
    projectId,
    partyId,
  );
  return rows.map((x) => JSON.parse(x.payload) as SavedCapture);
}
async function save(c: SavedCapture) {
  const d = await db();
  await d.runAsync(
    "INSERT INTO captures VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
    c.id,
    c.projectId,
    c.partyId,
    JSON.stringify(c),
  );
}
export async function captureOriginal(
  projectId: string,
  partyId: string,
  fromLibrary = false,
): Promise<SavedCapture | null> {
  const permission = fromLibrary
    ? await ImagePicker.requestMediaLibraryPermissionsAsync()
    : await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted)
    throw new Error(
      "카메라/사진 접근이 허용되지 않았습니다. 설정에서 권한을 확인하십시오.",
    );
  const result = fromLibrary
    ? await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images", "videos"],
        allowsEditing: false,
        quality: 1,
      })
    : await ImagePicker.launchCameraAsync({
        mediaTypes: ["images"],
        allowsEditing: false,
        quality: 1,
      });
  if (result.canceled) return null;
  const asset = result.assets[0];
  const id = Crypto.randomUUID();
  const directory = new Directory(Paths.document, "evidence-originals");
  directory.create({ intermediates: true, idempotent: true });
  const original = new File(asset.uri);
  if (original.size > 64 * 1024 * 1024)
    throw new Error(
      "64MB 이하 파일을 선택하십시오. 원래 파일은 변경하지 않았습니다.",
    );
  const preserved = new File(directory, id + ".bin");
  original.copy(preserved);
  const bytes = await preserved.bytes();
  if (bytes.length > 64 * 1024 * 1024)
    throw new Error(
      "원본은 기기에 보존했습니다. 현재 개발 업로드는 64MB 이하를 지원합니다.",
    );
  const hashBytes = await Crypto.digest(
    Crypto.CryptoDigestAlgorithm.SHA256,
    bytes,
  );
  const hash = Array.from(new Uint8Array(hashBytes))
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
  const saved: SavedCapture = {
    id,
    projectId,
    partyId,
    uri: preserved.uri,
    name: asset.fileName || `capture-${id}.jpg`,
    mime:
      asset.mimeType || (asset.type === "video" ? "video/mp4" : "image/jpeg"),
    hash,
    capturedAt: new Date().toISOString(),
    status: "pending",
  };
  await save(saved);
  return saved;
}
export async function submitCapture(
  api: ApiClient,
  c: SavedCapture,
  scope: Scope,
  progress: (offset: number, total: number) => void,
) {
  if (
    !api.session ||
    api.session.projectId !== c.projectId ||
    api.session.actor.partyId !== c.partyId
  )
    throw new Error("원본 작성자의 현장 세션으로 다시 로그인하십시오.");
  const result = await api.upload(
    await new File(c.uri).bytes(),
    {
      name: c.name,
      mime: c.mime,
      hash: c.hash,
      captureId: c.id,
      capturedAt: c.capturedAt,
      scope,
      sourcePartyId: c.partyId,
    },
    progress,
  );
  await save({ ...c, status: "uploaded" });
  return result;
}
export const spatialCapabilities = {
  gps: false,
  ar: false,
  qrAnchor: false,
  depth: false,
  mode: "manual_location_only",
} as const;
