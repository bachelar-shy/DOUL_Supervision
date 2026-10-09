import { useMemo, useState } from "react";
import { ApiError, type SupervisionClient } from "../data/supervision-client";
import type { CommandDescriptor, Fields, WorkItem, Workspace } from "../data/ui-contract";
import { clearOfflineCommandIntent, offlineCommandIntentKey, readOfflineCommandIntent, rebaseOfflineCommandIntent, saveOfflineCommandIntent, type OfflineCommandIntent } from "../data/offline-command-intent";
import { reasonLabel } from "../labels";
import { CommandModal } from "./CommandModal";

const labels = {
  ko: { title: "오프라인 명령 초안", help: "명령과 입력을 이 기기에만 보관합니다. 서버 처리는 재연결 후 현재 권한과 버전을 확인하고 직접 제출할 때만 시작됩니다.", choose: "서버가 허용한 명령 선택", open: "입력 작성", save: "기기에 보관", current: "서버 상태 다시 확인", checking: "확인 중…", old: "보관 버전", latest: "현재 서버 버전", conflict: "버전 또는 허용 명령이 변경되었습니다. 제안 내용을 검토하고 직접 해결하세요.", currentVersion: "저장 당시 버전이 현재입니다. 서버 처리는 아직 없습니다.", rebase: "현재 버전을 기준으로 다시 검토", discard: "기기 초안 취소", submit: "현재 허용 명령을 서버에 제출", pending: "미전송 기기 초안", payload: "제안 입력", unavailable: "현재 역할에서 이 명령을 사용할 수 없습니다. 제출할 수 없습니다.", identity: "프로젝트 또는 역할이 달라졌습니다. 이 초안은 다른 작업공간에서 사용할 수 없습니다." },
  en: { title: "Offline command draft", help: "The command and inputs stay on this device. The server is contacted only after reconnecting, checking current authority and version, and choosing to submit.", choose: "Choose a server-provided command", open: "Enter inputs", save: "Save on this device", current: "Check current server state", checking: "Checking…", old: "Captured version", latest: "Current server version", conflict: "The version or available command changed. Review the proposal and resolve it yourself.", currentVersion: "The captured version is current. Nothing has been sent to the server.", rebase: "Review against the current version", discard: "Cancel device draft", submit: "Submit currently allowed command", pending: "Unsent device draft", payload: "Proposed input", unavailable: "This command is unavailable to the current role. It cannot be submitted.", identity: "The project or role changed. This draft cannot be used in another workspace." },
  vi: { title: "Bản nháp lệnh ngoại tuyến", help: "Lệnh và dữ liệu chỉ được lưu trên thiết bị. Máy chủ chỉ được gọi sau khi kết nối lại, kiểm tra quyền và phiên bản hiện tại, rồi bạn chọn gửi.", choose: "Chọn lệnh do máy chủ cung cấp", open: "Nhập dữ liệu", save: "Lưu trên thiết bị", current: "Kiểm tra trạng thái máy chủ", checking: "Đang kiểm tra…", old: "Phiên bản đã lưu", latest: "Phiên bản máy chủ hiện tại", conflict: "Phiên bản hoặc lệnh được phép đã thay đổi. Hãy xem lại đề xuất và tự giải quyết.", currentVersion: "Phiên bản đã lưu vẫn hiện hành. Chưa gửi dữ liệu lên máy chủ.", rebase: "Xem xét lại theo phiên bản hiện tại", discard: "Hủy bản nháp trên thiết bị", submit: "Gửi lệnh hiện được phép", pending: "Bản nháp chưa gửi trên thiết bị", payload: "Dữ liệu đề xuất", unavailable: "Vai trò hiện tại không được phép dùng lệnh này. Không thể gửi.", identity: "Dự án hoặc vai trò đã thay đổi. Không thể dùng bản nháp này trong không gian khác." },
};

function language() {
  const code = document.documentElement.lang.slice(0, 2);
  return code === "ko" || code === "vi" ? code : "en";
}

type Choice = { key: string; item: WorkItem; action: CommandDescriptor };

export function OfflineCommandIntentPanel({ client, workspace, onChanged }: { client: SupervisionClient; workspace: Workspace; onChanged: () => Promise<void> }) {
  const t = labels[language()];
  const actorId = client.session?.actor.partyId ?? "unknown";
  const roleId = workspace.role.id;
  const projectId = workspace.project.id;
  const key = offlineCommandIntentKey(projectId, actorId, roleId);
  const [intent, setIntent] = useState<OfflineCommandIntent | null>(() => readOfflineCommandIntent(key));
  const [selectedKey, setSelectedKey] = useState("");
  const [dialog, setDialog] = useState<Choice | null>(null);
  const [fresh, setFresh] = useState<Workspace | null>(null);
  const [checked, setChecked] = useState(false);
  const [checking, setChecking] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const currentWorkspace = fresh ?? workspace;
  const choices = useMemo(() => currentWorkspace.items.flatMap(item => item.actions
    .filter(action => action.ready || action.requiresInput)
    .map(action => ({ key: `${item.machine}:${item.record.id}:${action.command}`, item, action }))), [currentWorkspace.items]);
  const selected = choices.find(choice => choice.key === selectedKey) ?? null;
  const currentItem = intent ? currentWorkspace.items.find(item => item.machine === intent.machine && item.record.id === intent.itemId) ?? null : null;
  const currentAction = currentItem?.actions.find(action => action.command === intent?.command) ?? null;
  const identityMatches = Boolean(intent && intent.projectId === projectId && intent.actorId === actorId && intent.roleId === roleId);
  const commandAvailable = Boolean(currentItem && currentAction && currentAction.expectedVersion === currentItem.record.version && (currentAction.ready || currentAction.requiresInput));
  const conflict = Boolean(intent && checked && (!identityMatches || !currentItem || currentItem.record.version !== intent.expectedVersion || !commandAvailable));

  async function checkCurrent() {
    if (!intent || checking) return;
    setChecking(true); setError(""); setChecked(false);
    try {
      const latest = await client.workspace();
      setFresh(latest); setChecked(true);
    } catch (cause) {
      setError(cause instanceof ApiError ? reasonLabel(cause.detail.code) : reasonLabel());
    } finally { setChecking(false); }
  }

  function save(payload: Fields, evidenceIds: string[]) {
    if (!selected) return;
    const next = saveOfflineCommandIntent(key, selected.item, selected.action.command, payload, evidenceIds, actorId, roleId, projectId);
    setIntent(next); setFresh(null); setChecked(false); setDialog(null); setError("");
  }

  function rebase() {
    if (!intent || !currentItem || !currentAction || !identityMatches || !commandAvailable) return;
    const next = rebaseOfflineCommandIntent(key, intent, currentItem, actorId, roleId, projectId);
    setIntent(next); setChecked(true); setError("");
  }

  async function submit() {
    if (!intent || !currentItem || !currentAction || !checked || conflict || !identityMatches || currentItem.record.version !== intent.expectedVersion || !commandAvailable || sending) return;
    setSending(true); setError("");
    try {
      await client.execute(currentItem, intent.command, intent.payload, intent.evidenceIds, intent.requestKey);
      clearOfflineCommandIntent(key); setIntent(null); setFresh(null); setChecked(false); await onChanged();
    } catch (cause) {
      setError(cause instanceof ApiError ? reasonLabel(cause.detail.code) : reasonLabel());
      setChecked(false);
    } finally { setSending(false); }
  }

  function discard() {
    clearOfflineCommandIntent(key); setIntent(null); setFresh(null); setChecked(false); setError("");
  }

  return <section className="my-3 rounded-sm border border-border bg-card p-3" aria-label={t.title}>
    <h3 className="text-sm font-semibold">{t.title}</h3><p className="my-2 text-xs text-muted-foreground">{t.help}</p>
    {!intent && <div className="flex flex-wrap gap-2">
      <select aria-label={t.choose} value={selectedKey} onChange={event => setSelectedKey(event.target.value)} className="min-w-64 rounded-sm border border-input bg-background px-2 py-2 text-sm">
        <option value="">{t.choose}</option>{choices.map(choice => <option key={choice.key} value={choice.key}>{choice.item.record.title || choice.item.record.id} · v{choice.item.record.version} · {choice.action.command}</option>)}
      </select>
      <button type="button" className="secondary" disabled={!selected} onClick={() => selected && setDialog(selected)}>{t.open}</button>
    </div>}
    {intent && <div className="space-y-2 text-sm">
      <p><strong>{t.pending}</strong> · {intent.record.title || intent.itemId} · {intent.command}</p>
      <p>{t.old}: v{intent.expectedVersion}{currentItem ? ` · ${t.latest}: v${currentItem.record.version}` : ""}</p>
      <details><summary>{t.payload}</summary><pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-sm bg-muted p-2 text-xs">{JSON.stringify({ payload: intent.payload, evidenceIds: intent.evidenceIds }, null, 2)}</pre></details>
      {checked && <p role={conflict ? "alert" : "status"}>{!identityMatches ? t.identity : conflict ? t.conflict : t.currentVersion}</p>}
      {!commandAvailable && checked && identityMatches && <p role="alert">{t.unavailable}</p>}
      {error && <p role="alert">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="secondary" onClick={() => void checkCurrent()} disabled={checking || sending}>{checking ? t.checking : t.current}</button>
        {conflict && commandAvailable && <button type="button" className="secondary" onClick={rebase} disabled={sending}>{t.rebase}</button>}
        <button type="button" className="secondary" onClick={discard} disabled={sending}>{t.discard}</button>
        {checked && !conflict && commandAvailable && <button type="button" className="primary" onClick={() => void submit()} disabled={sending}>{sending ? "…" : t.submit}</button>}
      </div>
    </div>}
    {dialog && <CommandModal key={`${dialog.item.machine}:${dialog.item.record.id}:${dialog.action.command}:${dialog.item.record.version}`} dialog={dialog} workspace={workspace} onClose={() => setDialog(null)} onSubmit={async (payload, evidenceIds) => save(payload, evidenceIds)} />}
  </section>;
}
