import { useCallback, useEffect, useState } from "react";
import type { Workspace } from "../data/ui-contract";
import type { SupervisionClient } from "../data/supervision-client";
import { CaptureTemplate } from "../ui/templates";
import { PageBoundary } from "./PageBoundary";
import { FloorPlan, Icon } from "./shared";
import { recordTitle } from "./record-utils";

interface LocalCapture {
  id: string;
  projectId: string;
  partyId: string;
  name: string;
  mime: string;
  bytes: ArrayBuffer;
  hash: string;
  capturedAt: string;
}
async function captures(
  action: "list" | "put" | "delete",
  value?: LocalCapture | string,
): Promise<LocalCapture[]> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("doul-captures", 1);
    req.onupgradeneeded = () =>
      req.result.createObjectStore("originals", { keyPath: "id" });
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(
        "originals",
        action === "list" ? "readonly" : "readwrite",
      );
      const store = tx.objectStore("originals");
      if (action === "put") store.put(value);
      if (action === "delete") store.delete(value as string);
      const all = store.getAll();
      tx.oncomplete = () => {
        resolve(all.result as LocalCapture[]);
        db.close();
      };
      tx.onerror = () => reject(tx.error);
    };
  });
}
export function CapturePage({
  client,
  workspace,
  online,
  refresh,
  notify,
}: {
  client: SupervisionClient;
  workspace: Workspace;
  online: boolean;
  refresh: () => Promise<void>;
  notify: (s: string) => void;
}) {
  const [pending, setPending] = useState<LocalCapture[]>([]);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setPending(
      (await captures("list")).filter(
        (x) =>
          x.projectId === workspace.project.id &&
          x.partyId === client.session!.actor.partyId,
      ),
    );
  }, [client, workspace.project.id]);
  useEffect(() => {
    let active = true;
    captures("list")
      .then((rows) => {
        if (active)
          setPending(
            rows.filter(
              (x) =>
                x.projectId === workspace.project.id &&
                x.partyId === client.session!.actor.partyId,
            ),
          );
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, [client, workspace.project.id]);
  async function intake(file: File) {
    try {
      if (file.size > 64 * 1024 * 1024)
        throw new Error("개발용 업로드는 64MB 이하입니다.");
      const bytes = await file.arrayBuffer();
      const hash = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      )
        .map((x) => x.toString(16).padStart(2, "0"))
        .join("");
      await captures("put", {
        id: crypto.randomUUID(),
        projectId: workspace.project.id,
        partyId: client.session!.actor.partyId,
        name: file.name,
        mime: file.type,
        bytes,
        hash,
        capturedAt: new Date().toISOString(),
      });
      await load();
      notify("원본을 기기에 저장했습니다. 아직 제출되지 않았습니다.");
    } catch (e) {
      setError(String(e));
    }
  }
  async function send(p: LocalCapture) {
    setError("");
    setProgress("전송 시작");
    try {
      await client.upload(
        new Uint8Array(p.bytes),
        {
          name: p.name,
          mime: p.mime,
          hash: p.hash,
          captureId: p.id,
          scope: workspace.context.scope,
          sourcePartyId: client.session!.actor.partyId,
          capturedAt: p.capturedAt,
        },
        (o, t) => setProgress(Math.round((o / t) * 100) + "%"),
      );
      await captures("delete", p.id);
      await load();
      await refresh();
      notify("서버 해시 확인 후 증빙을 등록했습니다.");
    } catch (e) {
      setError(String(e));
    } finally {
      setProgress("");
    }
  }
  return (
    <PageBoundary name="capture">
      <CaptureTemplate>
      <section className="panel">
        <div className="section-heading">
          <h2>현장 기록 가져오기</h2>
          <span>원본 보존</span>
        </div>
        <div className="capture-drop">
          <Icon name="camera" />
          <h2>사진·영상·음성을 기록합니다.</h2>
          <p>
            촬영 위치는 수동 선택값입니다. 자동 측위·AI 판정은 실행하지
            않습니다.
          </p>
          <label className="primary upload-label">
            파일 선택
            <input
              aria-label="증빙 파일 선택"
              type="file"
              accept="image/png,image/jpeg,image/webp,video/mp4,video/webm,audio/mpeg,audio/wav,application/pdf"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void intake(f);
                e.target.value = "";
              }}
            />
          </label>
          <label className="secondary upload-label">
            카메라 촬영
            <input
              aria-label="카메라 사진 촬영"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void intake(f);
              }}
            />
          </label>
        </div>
        <h3>기기 저장 · 제출 대기 {pending.length}건</h3>
        {pending.map((p) => (
          <div className="pending-row" key={p.id}>
            <div>
              <strong>{p.name}</strong>
              <small>
                {(p.bytes.byteLength / 1024).toFixed(0)} KB · SHA256{" "}
                {p.hash.slice(0, 12)}…
              </small>
            </div>
            <button
              className="secondary"
              disabled={!online || !!progress}
              onClick={() => void send(p)}
            >
              서버 전송
            </button>
          </div>
        ))}
        {progress && <p role="status">{progress}</p>}
        {error && (
          <div role="alert" className="error-box">
            {error}
          </div>
        )}
      </section>
      <div className="right-stack">
        <section className="panel">
          <h2>현재 촬영 맥락</h2>
          <div className="meta-grid">
            <div>
              <small>건물 / 층</small>
              <b>A동 / 2층</b>
            </div>
            <div>
              <small>위치 방식</small>
              <b>수동 지정</b>
            </div>
          </div>
          <FloorPlan />
          <div className="notice">
            기기에 저장된 파일은 전송 버튼을 누르기 전까지 서버 증빙이 아닙니다.
            재연결 시 자동 승인·종결하지 않습니다.
          </div>
        </section>
        <section className="panel">
          <h2>서버 증빙</h2>
          {workspace.items
            .filter((x) => x.machine === "evidence")
            .map((x) => (
              <div className="evidence-row" key={x.record.id}>
                <Icon name="document" />
                <div>
                  <strong>{recordTitle(x.record)}</strong>
                  <small>
                    {x.record.mediaType} · 원본 /{" "}
                    {x.record.fileHash?.slice(0, 12)}…
                  </small>
                </div>
              </div>
            ))}
          <button className="secondary wide" disabled>
            AI 분석 · 서비스 미연결
          </button>
        </section>
      </div>
      </CaptureTemplate>
    </PageBoundary>
  );
}
