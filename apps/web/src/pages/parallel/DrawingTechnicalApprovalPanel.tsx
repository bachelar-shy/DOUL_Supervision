import { useEffect, useState } from "react";
import type { SupervisionClient } from "../../data/supervision-client";
import { listDrawingRevisions } from "../../data/drawing-pdf-binding-client";
import type { CommandDescriptor, WorkItem, Workspace } from '../../data/ui-contract';
import { describeCommandAvailability } from '../../data/ui-presentation';
import { commands, states } from '../../labels';
import { ActionButton, Panel, SectionHeader } from '../../ui';

export function DrawingTechnicalApprovalPanel({client,workspace,onOpenCommand}: {client: SupervisionClient;workspace: Workspace;onOpenCommand?: (item: WorkItem, action: CommandDescriptor) => void}) {
  const [drawings, setDrawings] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  useEffect(() => { let active = true; void listDrawingRevisions(client, workspace.project.id).then(rows => { if (active) { setDrawings(new Set(rows.map(row => row.domainRef.objectId))); setError(''); } }).catch(reason => { if (active) setError(String(reason)); }); return () => { active = false; }; }, [client, workspace.project.id, workspace.role.id, workspace.items]);
  const approvals = workspace.items.filter(item => item.machine === 'approval' && item.record.approvalKind === 'technical' && drawings.has(String((item.record.targetRef as {objectId?: string} | undefined)?.objectId)));
  return <section aria-label="도면 기술 승인"><Panel><SectionHeader title="도면 기술 승인" meta="공식 검토 · 승인 · 철회" />
    <p className="muted">원본 도면에 대한 공식 승인 절차입니다. 승인 후 현장 관리 기록의 승인 근거를 갱신하고 사용본을 발행하십시오.</p>
    {error && <p role="alert">{error}</p>}
    {!approvals.length && <p>등록된 도면 기술 승인 요청이 없습니다.</p>}
    <div className="grid gap-3">{approvals.map(item => <article key={item.record.id} data-testid={`drawing-approval-${item.record.id}`} className="rounded-lg border p-3">
      <strong>기술 승인 · {item.record.id} · v{item.record.version}</strong><p>상태 · {item.record.status === 'under_review' ? '기술 검토 중' : states[String(item.record.status)] || String(item.record.status)}</p>
      <p>대상 도면 · {String((item.record.targetRef as {objectId?: string}).objectId)}</p>
      {item.actions.map(action => { const availability = describeCommandAvailability(action, true); return <span key={action.command}><ActionButton disabled={!onOpenCommand || availability.disabled} onClick={() => onOpenCommand?.(item,action)}>{commands[action.command] || action.command}</ActionButton>{availability.reason && <small>{availability.reason}</small>}</span>; })}
      {!item.actions.length && <p className="muted">현재 역할에서 실행할 수 있는 작업이 없습니다.</p>}
    </article>)}</div>
  </Panel></section>;
}
