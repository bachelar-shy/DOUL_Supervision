import { useEffect, useState } from "react";
import type { SupervisionClient } from "../data/supervision-client";

type Alert = {
  id: string; version: number; recipientPartyId: string; commentId: string;
  createdAt: string; readAt: string | null; subjectRef: {
    objectType: string; objectId: string; version: number;
  };
};
export function FieldDiscussionAlertsPanel({ client, online }: {
  client: SupervisionClient; online: boolean;
}) {
  const [items, setItems] = useState<Alert[]>([]);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const identity = client.session?.actor.partyId || "";
  const project = client.session?.projectId || "";
  useEffect(() => {
    if (!online || !identity || !project) return;
    let active = true;
    void client.request<{ items: Alert[] }>(client.path("/field/discussions/alerts?unreadOnly=true&limit=20"))
      .then(data => { if (active) setItems(data.items); })
      .catch(() => { if (active) setError("업무 알림을 확인할 수 없습니다."); });
    return () => { active = false; };
  }, [client, identity, project, refresh, online]);
  async function markRead(alert: Alert) {
    setBusy(alert.id); setError("");
    try {
      await client.request(client.path("/field/discussions/alerts/" + alert.id + "/read"), {
        method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ expectedVersion: alert.version }),
      });
      setItems(old => old.filter(item => item.id !== alert.id));
      setRefresh(v => v + 1);
    } catch { setError("알림을 읽음으로 처리할 수 없습니다. 권한을 확인하십시오."); }
    finally { setBusy(null); }
  }
  return <section aria-label="업무별 미확인 알림" style={{
    border: "1px solid #d4d7db", borderRadius: 5, marginTop: 8, padding: 8,
  }}>
    <h4 style={{ fontWeight: 650, fontSize: 13 }}>업무별 미확인 알림 · {items.length}건</h4>
    {error && <p role="alert">{error}</p>}
    {!items.length && <p style={{ fontSize: 12 }}>새 업무 대화 알림이 없습니다.</p>}
    {items.map(item => <div key={item.id} style={{
      display: "flex", justifyContent: "space-between", gap: 8,
      borderTop: "1px solid #e4e7eb", padding: "6px 0", fontSize: 12,
    }}>
      <div>{item.subjectRef.objectType} · {item.subjectRef.objectId.slice(0, 8)}
        <small style={{ display: "block" }}>{item.createdAt.slice(0, 16).replace("T", " ")}</small>
      </div>
      <button type="button" disabled={!online || busy === item.id} onClick={() => void markRead(item)}>
        읽음
      </button>
    </div>)}
  </section>;
}
