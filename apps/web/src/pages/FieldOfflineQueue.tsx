import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, type SupervisionClient } from "../data/supervision-client";
import type { CommandDescriptor, Fields, WorkItem, Workspace } from "../data/ui-contract";
import { type FieldOutboxItem, listFieldCommands, queueFieldCommand,
  removeFieldCommand, updateFieldCommand } from "../data/field-outbox";
import { CommandModal } from "./CommandModal";
import { OfflineMediaPanel } from "./OfflineMediaPanel";
import "./field-offline-queue.css";

type Choice = { item: WorkItem; action: CommandDescriptor; key: string };
export function FieldOfflineQueue({ client, workspace, online, onChanged, onStatus }: {
  client: SupervisionClient; workspace: Workspace; online: boolean;
  onChanged: () => Promise<void>; onStatus?: (message: string) => void;
}) {
  const identity = useMemo(() => ({
    projectId: workspace.project.id,
    partyId: client.session?.actor.partyId || "",
    roleId: client.session?.actor.roleAssignmentId || workspace.role.id,
  }), [client.session?.actor.partyId, client.session?.actor.roleAssignmentId,
    workspace.project.id, workspace.role.id]);
  const [outbox, setOutbox] = useState<FieldOutboxItem[]>([]);
  const [dialog, setDialog] = useState<Choice | null>(null);
  const [choice, setChoice] = useState("");
  const [error, setError] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [storageFailed, setStorageFailed] = useState(false);
  const syncingRef = useRef(false);
  const choices = useMemo<Choice[]>(() => workspace.items.flatMap(item => (item.actions || [])
    .filter(action => action.ready || action.requiresInput)
    .map(action => ({ key: [item.machine,item.record.id,action.command].join(":"),
      item, action }))), [workspace.items]);
  const selected = choices.find(x => x.key === choice);

  const reload = useCallback(async () => {
    try {
      setOutbox(await listFieldCommands(identity)); setStorageFailed(false);
    } catch { setStorageFailed(true); setError("기기의 대기 업무 저장공간을 읽지 못했습니다."); }
  }, [identity]);
  useEffect(() => { void reload(); }, [reload]);

  async function save(payload: Fields, evidenceIds: string[]) {
    if (!dialog) return;
    try {
      await queueFieldCommand(identity, dialog.item, dialog.action.command, payload, evidenceIds);
      setDialog(null); setChoice(""); setError("");
      await reload();
      onStatus?.("기기에 저장했습니다. 인터넷 연결 후 자동 동기화를 시도합니다.");
    } catch { setStorageFailed(true); setError("기기 저장에 실패했습니다. 업무 내용이 보관되지 않았습니다."); }
  }

  const sync = useCallback(async () => {
    if (!online || syncingRef.current || !identity.partyId || storageFailed) return;
    syncingRef.current = true; setSyncing(true); setError("");
    let syncedCount = 0;
    let needsReview = false;
    try {
      const pending = await listFieldCommands(identity);
      if (!pending.length) return;
      // Read fresh authoritative versions before submitting. Each actual
      // command still rechecks authority, state, signature and expectedVersion.
      const latest = await client.workspace();
      for (const queued of pending) {
        if (queued.status === "conflict") continue;
        const item = latest.items.find(candidate => candidate.machine === queued.machine
          && candidate.record.id === queued.itemId);
        const action = item?.actions.find(candidate => candidate.command === queued.command);
        if (!item || !action || item.record.version !== queued.expectedVersion
            || !action.ready && !action.requiresInput) {
          await updateFieldCommand({ ...queued, status: "conflict",
            error: "기준도면·업무 버전 또는 현재 권한이 변경되었습니다. 재검토가 필요합니다." });
          needsReview = true;
          continue;
        }
        try {
          await client.execute(item, queued.command, queued.payload, queued.evidenceIds, queued.requestKey);
          await removeFieldCommand(queued.id); syncedCount += 1;
        } catch (cause) {
          if (cause instanceof ApiError && [401,403,409,422].includes(cause.status)) {
            await updateFieldCommand({ ...queued, status: "conflict",
              error: "현재 권한 또는 업무 상태가 변경되어 자동 제출을 보류했습니다." });
            needsReview = true;
          } else {
            await updateFieldCommand({ ...queued, status: "retry",
              error: "전송 실패: 네트워크가 복구되면 다시 시도합니다." });
            break;
          }
        }
      }
      if (syncedCount) {
        await onChanged();
        onStatus?.(`기기 저장 업무 ${syncedCount}건을 서버에 동기화했습니다.`);
      }
      if (needsReview) onStatus?.("미전송 업무 중 재검토가 필요한 건이 있습니다. 연결 상태에서 작업함을 확인하세요.");
    } catch { setError("오프라인 업무 동기화가 중단되었습니다. 내용은 기기에 보존됩니다."); }
    finally {
      syncingRef.current = false; setSyncing(false); await reload();
    }
  }, [online, identity, storageFailed, client, onChanged, reload, onStatus]);

  // Attempt automatic transfer once when the connection returns. A failed
  // network attempt must not trigger an immediate infinite retry loop.
  useEffect(() => { if (online) void sync(); }, [online]);

  async function discard(item: FieldOutboxItem) {
    if (!window.confirm("이 기기의 미전송 업무를 폐기하시겠습니까?")) return;
    await removeFieldCommand(item.id); await reload();
  }

  return <section className="fw-offline-queue" aria-label="현장 오프라인 작업함">
    <header className="fw-offline-header"><div>
      <h3>현장 오프라인 작업함</h3>
      <p>통신이 불안정해도 여러 건의 업무 입력을 기기에 보관하고 연결 시 재전송합니다.</p>
    </div><strong>{outbox.length}건 대기</strong></header>
    {storageFailed && <p role="alert">브라우저 저장공간을 사용할 수 없습니다. 오프라인 작업을 진행할 수 없습니다.</p>}
    {error && <p role="alert">{error}</p>}
    <div className="fw-offline-controls">
      <select aria-label="오프라인 저장할 업무 선택" value={choice} onChange={e => setChoice(e.target.value)}>
        <option value="">업무와 처리명령 선택</option>
        {choices.map(x => <option key={x.key} value={x.key}>{x.item.record.title || x.item.record.id.slice(0,8)} · {x.action.command}</option>)}
      </select>
      <button type="button" disabled={!selected || storageFailed}
        onClick={() => selected && setDialog(selected)}>업무 입력 보관</button>
      <button type="button" disabled={!online || syncing || !outbox.some(x => x.status !== "conflict")}
        onClick={() => void sync()}>{syncing ? "전송 중…" : "지금 동기화"}</button>
    </div>
    <ol className="fw-offline-list">
      {outbox.map(item => <li key={item.id}>
        <div><strong>{item.title}</strong><small>{item.command} · v{item.expectedVersion} · {item.savedAt.slice(0,16).replace("T"," ")}</small>
          <span>{item.status === "conflict" ? "충돌·재검토 필요" : item.status === "retry" ? "연결 복구 대기" : "전송 대기"}</span>
          {item.error && <p role="alert">{item.error}</p>}
        </div>
        <button type="button" onClick={() => void discard(item)} aria-label={item.title + " 작업 폐기"}>폐기</button>
      </li>)}
    </ol>
    {!outbox.length && <p className="fw-offline-empty">미전송 업무가 없습니다.</p>}
    <p className="fw-offline-note">오프라인에서 작성한 내용은 공식 승인·검측 완료가 아닙니다. 재연결 시 서버 권한 및 이전 버전을 검증합니다.</p>
    <OfflineMediaPanel key={identity.projectId + ":" + identity.roleId + ":" + identity.partyId}
      client={client} scope={identity} online={online} />
    {dialog && <CommandModal key={dialog.key} dialog={dialog} workspace={workspace}
      submitLabel="기기에 보관" onClose={() => setDialog(null)}
      onSubmit={async (payload,evidenceIds) => { await save(payload,evidenceIds); }} />}
  </section>;
}
