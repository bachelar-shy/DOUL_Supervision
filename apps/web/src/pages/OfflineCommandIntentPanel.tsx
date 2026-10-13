import { recordVersionLabel } from "../labels";
import { useEffect, useMemo, useState } from "react";
import { ApiError, type SupervisionClient } from "../data/supervision-client";
import type { CommandDescriptor, Fields, WorkItem, Workspace } from "../data/ui-contract";
import { clearOfflineCommandIntent, offlineCommandIntentKey, readOfflineCommandIntent, rebaseOfflineCommandIntent, saveOfflineCommandIntent, type OfflineCommandIntent } from "../data/offline-command-intent";
import { commands, reasonLabel } from "../labels";
import { CommandModal } from "./CommandModal";

import { offlineCommandLabels } from "../data/offline-command-labels";

function language() {
  const code = document.documentElement.lang.slice(0, 2);
  return code === "ko" || code === "vi" ? code : "en";
}

type Choice = { key: string; item: WorkItem; action: CommandDescriptor };

export function OfflineCommandIntentPanel({ client, workspace, online, onChanged, onStatus }: { client: SupervisionClient; workspace: Workspace; online: boolean; onChanged: () => Promise<void>; onStatus?: (message: string) => void }) {
  const t = offlineCommandLabels[language()];
  const actorId = client.session?.actor.partyId ?? "unknown";
  const roleId = client.session?.actor.roleAssignmentId ?? workspace.role.id;
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
  const choices = useMemo(() => currentWorkspace.items.flatMap(item => (item.actions ?? [])
    .filter(action => action.ready || action.requiresInput)
    .map(action => ({ key: `${item.machine}:${item.record.id}:${action.command}`, item, action }))), [currentWorkspace.items]);
  const selected = choices.find(choice => choice.key === selectedKey) ?? null;
  const currentItem = intent ? currentWorkspace.items.find(item => item.machine === intent.machine && item.record.id === intent.itemId) ?? null : null;
  const currentAction = currentItem?.actions?.find(action => action.command === intent?.command) ?? null;
  const identityMatches = Boolean(intent && intent.projectId === projectId && intent.actorId === actorId && intent.roleId === roleId);
  const commandAvailable = Boolean(currentItem && currentAction && currentAction.expectedVersion === currentItem.record.version && (currentAction.ready || currentAction.requiresInput));
  const conflict = Boolean(intent && checked && (!identityMatches || !currentItem || currentItem.record.version !== intent.expectedVersion || !commandAvailable));

  useEffect(() => {
    if (!online || !intent) return;
    let cancelled = false;
    setChecking(true); setChecked(false); setError("");
    void client.workspace().then(latest => {
      if (!cancelled) { setFresh(latest); setChecked(true); }
    }).catch(cause => {
      if (!cancelled) setError(cause instanceof ApiError ? reasonLabel(cause.detail.code) : reasonLabel());
    }).finally(() => { if (!cancelled) setChecking(false); });
    return () => { cancelled = true; };
  }, [client, intent, key, online]);

  async function checkCurrent() {
    if (!intent || checking || !online) return;
    setChecking(true); setError(""); setChecked(false);
    try {
      const latest = await client.workspace();
      setFresh(latest); setChecked(true);
    } catch (cause) {
      setError(cause instanceof ApiError ? reasonLabel(cause.detail.code) : reasonLabel());
    } finally { setChecking(false); }
  }

  function save(payload: Fields, evidenceIds: string[]) {
    if (!dialog) return;
    const next = saveOfflineCommandIntent(key, dialog.item, dialog.action.command, payload, evidenceIds, actorId, roleId, projectId);
    setIntent(next); setFresh(null); setChecked(false); setDialog(null); setError("");
    onStatus?.("기기에 임시 저장했습니다. 인터넷 연결 후 확인·제출할 수 있습니다.");
  }

  function rebase() {
    if (!intent || !currentItem || !currentAction || !identityMatches || !commandAvailable) return;
    const next = rebaseOfflineCommandIntent(key, intent, currentItem, actorId, roleId, projectId);
    setIntent(next); setChecked(true); setError("");
  }

  async function submit() {
    if (!intent || !currentItem || !currentAction || !checked || conflict || !identityMatches || currentItem.record.version !== intent.expectedVersion || !commandAvailable || sending || !online) return;
    setSending(true); setError("");
    try {
      await client.execute(currentItem, intent.command, intent.payload, intent.evidenceIds, intent.requestKey);
      clearOfflineCommandIntent(key); setIntent(null); setFresh(null); setChecked(false); await onChanged();
      onStatus?.("기기에 보관한 업무를 서버에 제출했습니다.");
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
        <option value="">{t.choose}</option>{choices.map(choice => <option key={choice.key} value={choice.key}>{choice.item.record.title || String(choice.item.record.workName ?? choice.item.record.data?.workName ?? choice.item.record.data?.title ?? choice.item.record.id)} · {recordVersionLabel(choice.item.record.version)} · {commands[choice.action.command] ?? choice.action.command}</option>)}
      </select>
      <button type="button" className="secondary" disabled={!selected} onClick={() => selected && setDialog(selected)}>{t.open}</button>
    </div>}
    {intent && <div className="space-y-2 text-sm">
      <p><strong>{t.pending}</strong> · {intent.record.title || intent.itemId} · {commands[intent.command] ?? intent.command}</p>
      <p>{t.old}: {recordVersionLabel(intent.expectedVersion)}{currentItem ? ` · ${t.latest}: ${recordVersionLabel(currentItem.record.version)}` : ""}</p>
      <details><summary>{t.payload}</summary><pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-sm bg-muted p-2 text-xs">{JSON.stringify({ payload: intent.payload, evidenceIds: intent.evidenceIds }, null, 2)}</pre></details>
      {checked && <p role={conflict ? "alert" : "status"}>{!identityMatches ? t.identity : conflict ? t.conflict : t.currentVersion}</p>}
      {!commandAvailable && checked && identityMatches && <p role="alert">{t.unavailable}</p>}
      {error && <p role="alert">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="secondary" onClick={() => void checkCurrent()} disabled={checking || sending || !online}>{checking ? t.checking : t.current}</button>
        {conflict && commandAvailable && <button type="button" className="secondary" onClick={rebase} disabled={sending}>{t.rebase}</button>}
        <button type="button" className="secondary" onClick={discard} disabled={sending}>{t.discard}</button>
        {checked && !conflict && commandAvailable && <button type="button" className="primary" onClick={() => void submit()} disabled={sending || !online}>{sending ? "…" : t.submit}</button>}
      </div>
    </div>}
    {dialog && <CommandModal key={`${dialog.item.machine}:${dialog.item.record.id}:${dialog.action.command}:${dialog.item.record.version}`} dialog={dialog} workspace={currentWorkspace} submitLabel={t.save} onClose={() => setDialog(null)} onSubmit={async (payload, evidenceIds) => save(payload, evidenceIds)} />}
  </section>;
}
