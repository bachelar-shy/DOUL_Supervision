import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, type SupervisionClient } from '../../data/supervision-client';
import type { Workspace } from '../../data/ui-contract';
import { registerDrawingSource, type DrawingSourceInput, type DrawingSourceResult } from '../../data/drawing-source-client';
import { listDrawingRevisions, type DrawingRevisionOption } from '../../data/drawing-pdf-binding-client';
import { ActionButton, Panel, SectionHeader } from '../../ui';
import { reasonLabel } from '../../labels';

type Locale = 'ko' | 'vi' | 'en';
const copy: Record<Locale, Record<string, string>> = {
  ko: {
    section: '도면 개정 등록', title: '도면 개정 등록', meta: '새 원본 · 검토 요청',
    help: '새 개정본은 이전 도면을 보존하며 별도 등록합니다. 먼저 PDF 뷰어에서 원본을 업로드하십시오.',
    drawingTitle: '도면 제목', revision: '개정 번호', pdfSource: 'PDF 원본', select: '선택', previousDrawing: '이전 도면', newDrawing: '신규 도면',
    requestReview: '등록 후 검토 요청', reviewButton: '새 개정 등록 검토', denied: '도면 원본 등록은 설계자 개발 역할에서 진행하십시오. 승인과 현장 배포는 별도 절차입니다.',
    created: '등록 완료: {{title}}', revisionResult: '개정 {{revision}} · 원본 v{{version}}', reviewRequest: '검토 요청', receiptPending: '접수 대기', notRequested: '요청하지 않음',
    fieldUseBoundary: '현장 사용 전 승인·배포 확인 필요', reviewScreen: '승인 검토 화면', confirmTitle: '새 도면 개정 등록 확인',
    unchanged: '원본을 변경하지 않고 새 기록으로 등록합니다. 검토 요청은 승인 완료를 의미하지 않습니다.', cancel: '취소', registering: '등록 중…', confirmRegister: '확인 후 개정 등록',
    errRequired: '도면 제목, 개정 번호와 PDF 원본을 입력하십시오.', errGeneric: '요청을 처리하지 못했습니다. 다시 시도하십시오.',
  },
  vi: {
    section: 'Đăng ký phiên bản bản vẽ', title: 'Đăng ký phiên bản bản vẽ', meta: 'Nguồn mới · yêu cầu xem xét',
    help: 'Đăng ký phiên bản mới thành hồ sơ riêng và giữ nguyên bản vẽ trước đó. Trước tiên hãy tải bản gốc lên bằng trình xem PDF.',
    drawingTitle: 'Tiêu đề bản vẽ', revision: 'Mã phiên bản', pdfSource: 'PDF nguồn', select: 'Chọn', previousDrawing: 'Bản vẽ trước', newDrawing: 'Bản vẽ mới',
    requestReview: 'Yêu cầu xem xét sau khi đăng ký', reviewButton: 'Xem lại đăng ký phiên bản mới', denied: 'Đăng ký bản vẽ nguồn bằng vai trò phát triển của thiết kế. Phê duyệt và phân phối tại công trường là các quy trình riêng.',
    created: 'Đã đăng ký: {{title}}', revisionResult: 'Phiên bản {{revision}} · nguồn v{{version}}', reviewRequest: 'Yêu cầu xem xét', receiptPending: 'Đang chờ tiếp nhận', notRequested: 'Không yêu cầu',
    fieldUseBoundary: 'Cần xác nhận phê duyệt và phân phối trước khi sử dụng tại công trường', reviewScreen: 'Mở màn hình xem xét Approval', confirmTitle: 'Xác nhận đăng ký phiên bản bản vẽ mới',
    unchanged: 'Đăng ký thành hồ sơ mới mà không thay đổi bản gốc. Yêu cầu xem xét không có nghĩa là đã được phê duyệt.', cancel: 'Hủy', registering: 'Đang đăng ký…', confirmRegister: 'Xác nhận đăng ký phiên bản',
    errRequired: 'Nhập tiêu đề bản vẽ, mã phiên bản và chọn PDF nguồn.', errGeneric: 'Không thể xử lý yêu cầu. Hãy thử lại.',
  },
  en: {
    section: 'Drawing revision registration', title: 'Register drawing revision', meta: 'New source · request review',
    help: 'Register a new revision as a separate record while preserving the previous drawing. Upload the source PDF in the viewer first.',
    drawingTitle: 'Drawing title', revision: 'Revision number', pdfSource: 'Source PDF', select: 'Select', previousDrawing: 'Previous drawing', newDrawing: 'New drawing',
    requestReview: 'Request review after registration', reviewButton: 'Review new revision registration', denied: 'Register source drawings using the designer development role. Approval and field distribution follow separate steps.',
    created: 'Registered: {{title}}', revisionResult: 'Revision {{revision}} · source v{{version}}', reviewRequest: 'Review request', receiptPending: 'Awaiting receipt', notRequested: 'Not requested',
    fieldUseBoundary: 'Approval and distribution must be checked before field use', reviewScreen: 'Open Approval review', confirmTitle: 'Confirm new drawing revision registration',
    unchanged: 'Register a new record without changing the source. A review request does not mean approval is complete.', cancel: 'Cancel', registering: 'Registering…', confirmRegister: 'Confirm revision registration',
    errRequired: 'Enter a drawing title and revision number, and select the source PDF.', errGeneric: 'Could not complete the request. Try again.',
  },
};
const txValue = (locale: Locale, key: string, values?: Record<string, unknown>) => {
  let text = copy[locale][key] || copy.en[key] || key;
  for (const [name, value] of Object.entries(values || {})) text = text.replaceAll(`{{${name}}}`, String(value));
  return text;
};
const errorToken = (cause: unknown) => cause instanceof ApiError ? `reason:${cause.detail.code}` : 'error:errGeneric';
const errorText = (value: string, locale: Locale) => value.startsWith('reason:') ? reasonLabel(value.slice(7)) : txValue(locale, value.startsWith('error:') ? value.slice(6) : 'errGeneric');

export function DrawingSourceRegistrationPanel({ client, workspace, onChanged, onNavigate }: { client: SupervisionClient; workspace: Workspace; onChanged?: () => void; onNavigate?: (route: string) => void }) {
  const { i18n } = useTranslation();
  const language = (i18n.resolvedLanguage ?? i18n.language).slice(0, 2);
  const locale: Locale = language === 'ko' || language === 'vi' ? language : 'en';
  const tx = (key: string, values?: Record<string, unknown>) => txValue(locale, key, values);
  const [title, setTitle] = useState(''); const [revision, setRevision] = useState('');
  const [evidenceId, setEvidenceId] = useState(''); const [predecessorId, setPredecessorId] = useState('');
  const [drawings, setDrawings] = useState<DrawingRevisionOption[]>([]); const [review, setReview] = useState(true);
  const [confirming, setConfirming] = useState(false); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(''); const [result, setResult] = useState<DrawingSourceResult | null>(null);
  const attempt = useRef<{ fingerprint: string; key: string; body: DrawingSourceInput } | null>(null);
  const lifetime = useRef(0);
  useEffect(() => { const seq = ++lifetime.current; let active = true;
    void listDrawingRevisions(client, workspace.project.id).then(items => { if (active && seq === lifetime.current) setDrawings(items); }).catch(reason => { if (active && seq === lifetime.current) setError(errorToken(reason)); });
    return () => { active = false; lifetime.current++; };
  }, [client, workspace.project.id, workspace.items]);
  const pdfs = useMemo(() => workspace.items.filter(item => item.machine === 'evidence' && item.record.sourceType === 'original' && item.record.mediaType === 'document' && item.record.metadata?.mimeType === 'application/pdf').map(item => item.record), [workspace.items]);
  const canRegister = workspace.demo && workspace.role.actorGroup === 'DES' && workspace.role.roleCode === 'designer';
  function prepare() {
    const pdf = pdfs.find(item => item.id === evidenceId); const predecessor = drawings.find(item => item.domainRef.objectId === predecessorId);
    if (!pdf || !title.trim() || !revision.trim()) { setError('error:errRequired'); return; }
    const input = { title: title.trim(), revision: revision.trim(), evidenceRef: { objectType: 'Evidence', objectId: pdf.id, version: pdf.version }, predecessorRef: predecessor?.domainRef ?? null, requestReview: review };
    const fingerprint = JSON.stringify(input);
    if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, key: crypto.randomUUID(), body: { objectId: crypto.randomUUID(), ...input } };
    setError(''); setConfirming(true);
  }
  async function submit() {
    if (!attempt.current || busy) return; const seq = lifetime.current; const pending = attempt.current;
    setBusy(true); setError('');
    try { const created = await registerDrawingSource(client, pending.body, pending.key); if (seq !== lifetime.current) return;
      setResult(created); setConfirming(false); attempt.current = null; setTitle(''); setRevision(''); onChanged?.();
    } catch (reason) { if (seq === lifetime.current) setError(errorToken(reason)); }
    finally { if (seq === lifetime.current) setBusy(false); }
  }
  return <section aria-label={locale === 'ko' ? '도면 개정 등록' : tx('section')}><Panel><SectionHeader title={tx('title')} meta={tx('meta')} />
    <p className="muted">{tx('help')}</p>
    {canRegister ? <div className="grid gap-3 sm:grid-cols-2">
      <label>{tx('drawingTitle')}<input aria-label={locale === 'ko' ? '새 도면 제목' : tx('drawingTitle')} value={title} maxLength={240} onChange={e => setTitle(e.target.value)} /></label>
      <label>{tx('revision')}<input aria-label={locale === 'ko' ? '새 개정 번호' : tx('revision')} value={revision} maxLength={80} onChange={e => setRevision(e.target.value)} /></label>
      <label>{tx('pdfSource')}<select aria-label={locale === 'ko' ? '새 도면 PDF' : tx('pdfSource')} value={evidenceId} onChange={e => setEvidenceId(e.target.value)}><option value="">{tx('select')}</option>{pdfs.map(item => <option key={item.id} value={item.id}>{String(item.metadata?.name ?? item.id)} · v{item.version}</option>)}</select></label>
      <label>{tx('previousDrawing')}<select aria-label={locale === 'ko' ? '이전 도면 개정' : tx('previousDrawing')} value={predecessorId} onChange={e => setPredecessorId(e.target.value)}><option value="">{tx('newDrawing')}</option>{drawings.map(item => <option key={item.domainRef.objectId} value={item.domainRef.objectId}>{item.title} · {item.revision} · v{item.domainRef.version}</option>)}</select></label>
      <label><input type="checkbox" checked={review} onChange={e => setReview(e.target.checked)} /> {tx('requestReview')}</label>
      <ActionButton onClick={prepare} disabled={busy}>{tx('reviewButton')}</ActionButton>
    </div> : <p>{tx('denied')}</p>}
    {error && <p role="alert">{errorText(error, locale)}</p>}
    {result && <div role="status"><p>{tx('created', { title: result.drawing.title })} · {tx('revisionResult', { revision: String(result.drawing.revision), version: result.drawing.version })}</p><p>{tx('reviewRequest')}: {result.approval ? tx('receiptPending') : tx('notRequested')} · {tx('fieldUseBoundary')}</p>{result.approval && onNavigate && <ActionButton onClick={() => document.querySelector('[aria-label="도면 기술 승인"]')?.scrollIntoView({ behavior: 'smooth' })}>{tx('reviewScreen')}</ActionButton>}</div>}
    {confirming && <section role="dialog" aria-modal="true" aria-label={locale === 'ko' ? '새 도면 개정 등록 확인' : tx('confirmTitle')} className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"><div className="max-w-xl rounded-lg bg-white p-6"><h3>{tx('confirmTitle')}</h3><p>{title} · {tx('revision')} {revision}</p><p>{tx('unchanged')}</p>{error && <p role="alert">{errorText(error, locale)}</p>}<ActionButton onClick={() => setConfirming(false)} disabled={busy}>{tx('cancel')}</ActionButton><ActionButton onClick={() => void submit()} disabled={busy}>{busy ? tx('registering') : tx('confirmRegister')}</ActionButton></div></section>}
  </Panel></section>;
}
