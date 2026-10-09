import type { SupervisionClient, UploadOptions } from "./supervision-client";

export const EVIDENCE_UPLOAD_LIMIT_BYTES = 20 * 1024 * 1024;

export function sniffEvidenceMime(bytes: Uint8Array, fileName = ""): string | null {
  // A browser candidate only; the server validates the actual XLSX package.
  if (/\.xlsx$/i.test(fileName) && bytes.length >= 4 &&
      bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3 && bytes[3] === 4) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (bytes.length >= 8 && bytes.slice(0, 8).join(",") === "137,80,78,71,13,10,26,10") return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(String.fromCharCode(...bytes.slice(0, 6)))) return "image/gif";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  if (bytes.length >= 5 && String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-") return "application/pdf";
  return null;
}

export async function evidenceChecksum(bytes: Uint8Array): Promise<string> {
  const source = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", source)))
    .map((value) => value.toString(16).padStart(2, "0")).join("");
}

export function currentEvidenceActor(client: SupervisionClient) {
  const session = client.session;
  if (!session) throw new Error("로그인이 필요합니다.");
  return session.actor;
}

export async function uploadOfficialEvidence(
  client: SupervisionClient,
  bytes: Uint8Array,
  options: Omit<UploadOptions, "sourcePartyId">,
  progress?: (offset: number, total: number) => void,
) {
  return client.upload(bytes, {
    ...options,
    sourcePartyId: currentEvidenceActor(client).partyId,
  }, progress);
}
