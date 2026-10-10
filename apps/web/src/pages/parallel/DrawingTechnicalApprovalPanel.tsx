import { recordVersionLabel } from "../../labels";
import { useEffect, useState } from "react";
import { useTranslation } from 'react-i18next';
import { normalizeLanguage } from '@doul/localization';
import { ApiError, type SupervisionClient } from "../../data/supervision-client";
import { listDrawingRevisions } from "../../data/drawing-pdf-binding-client";
import type { CommandDescriptor, WorkItem, Workspace } from '../../data/ui-contract';
import { describeCommandAvailability } from '../../data/ui-presentation';
import { commands, reasonLabel, states } from '../../labels';
import { ActionButton, Panel, SectionHeader } from '../../ui';

type Locale = 'ko' | 'vi' | 'en';
const copy: Record<Locale, Record<string, string>> = {
  ko: {
    panel: '도면 기술 승인', title: '도면 기술 승인', meta: '공식 검토 · 승인 · 철회', description: '원본 도면에 대한 공식 승인 절차입니다. 승인 후 현장 관리 기록의 승인 근거를 갱신하고 사용본을 발행하십시오.', loadFailed: '도면 기술 승인 정보를 불러오지 못했습니다.', empty: '등록된 도면 기술 승인 요청이 없습니다.', technicalApproval: '기술 승인', status: '상태', underReview: '기술 검토 중', targetDrawing: '대상 도면', noActions: '현재 역할에서 실행할 수 있는 작업이 없습니다.'
  },
  vi: {
    panel: 'Phê duyệt kỹ thuật bản vẽ', title: 'Phê duyệt kỹ thuật bản vẽ', meta: 'Rà soát chính thức · phê duyệt · thu hồi', description: 'Đây là quy trình phê duyệt chính thức cho bản vẽ gốc. Sau khi phê duyệt, hãy cập nhật căn cứ phê duyệt trong hồ sơ quản lý hiện trường và phát hành bản dùng tại hiện trường.', loadFailed: 'Không thể tải thông tin phê duyệt kỹ thuật bản vẽ.', empty: 'Không có yêu cầu phê duyệt kỹ thuật bản vẽ đã đăng ký.', technicalApproval: 'Phê duyệt kỹ thuật', status: 'Trạng thái', underReview: 'Đang rà soát kỹ thuật', targetDrawing: 'Bản vẽ mục tiêu', noActions: 'Vai trò hiện tại không có thao tác nào khả dụng.'
  },
  en: {
    panel: 'Drawing technical approval', title: 'Drawing technical approval', meta: 'Official review · approval · withdrawal', description: 'This is the formal approval process for the source drawing. After approval, update the approval basis in the field management record and issue the field use copy.', loadFailed: 'Could not load drawing technical approval information.', empty: 'There are no registered drawing technical approval requests.', technicalApproval: 'Technical approval', status: 'Status', underReview: 'Under technical review', targetDrawing: 'Target drawing', noActions: 'No actions are available for the current role.'
  },
};

function txFor(language: Locale, key: string) { return copy[language][key] ?? copy.en[key] ?? key; }
function apiErrorMessage(cause: unknown, fallback: string) { return cause instanceof ApiError ? reasonLabel(cause.detail.code) : fallback; }

export function DrawingTechnicalApprovalPanel({client,workspace,onOpenCommand}: {client: SupervisionClient;workspace: Workspace;onOpenCommand?: (item: WorkItem, action: CommandDescriptor) => void}) {
  const { i18n } = useTranslation();
  const language: Locale = normalizeLanguage(i18n.resolvedLanguage ?? i18n.language);
  const tx = (key: string) => txFor(language, key);
  const [drawings, setDrawings] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  useEffect(() => { let active = true; void listDrawingRevisions(client, workspace.project.id).then(rows => { if (active) { setDrawings(new Set(rows.map(row => row.domainRef.objectId))); setError(''); } }).catch(reason => { if (active) setError(apiErrorMessage(reason, tx('loadFailed'))); }); return () => { active = false; }; }, [client, workspace.project.id, workspace.role.id, workspace.items]);
  const approvals = workspace.items.filter(item => item.machine === 'approval' && item.record.approvalKind === 'technical' && drawings.has(String((item.record.targetRef as {objectId?: string} | undefined)?.objectId)));
  return <section aria-label={tx('panel')}><Panel><SectionHeader title={tx('title')} meta={tx('meta')} />
    <p className="muted">{tx('description')}</p>
    {error && <p role="alert">{error}</p>}
    {!approvals.length && <p>{tx('empty')}</p>}
    <div className="grid gap-3">{approvals.map(item => <article key={item.record.id} data-testid={`drawing-approval-${item.record.id}`} className="rounded-lg border p-3">
      <strong>{tx('technicalApproval')} · {item.record.id} · {recordVersionLabel(item.record.version)}</strong><p>{tx('status')} · {item.record.status === 'under_review' ? tx('underReview') : states[String(item.record.status)] || String(item.record.status)}</p>
      <p>{tx('targetDrawing')} · {String((item.record.targetRef as {objectId?: string}).objectId)}</p>
      {item.actions.map(action => { const availability = describeCommandAvailability(action, true); return <span key={action.command}><ActionButton disabled={!onOpenCommand || availability.disabled} onClick={() => onOpenCommand?.(item,action)}>{commands[action.command] || action.command}</ActionButton>{availability.reason && <small>{availability.reason}</small>}</span>; })}
      {!item.actions.length && <p className="muted">{tx('noActions')}</p>}
    </article>)}</div>
  </Panel></section>;
}
