import { useEffect, useMemo, useRef, useState } from 'react';
import type { SupervisionClient } from '../../data/supervision-client';
import type { Workspace } from '../../data/ui-contract';
import { registerDrawingSource, type DrawingSourceInput, type DrawingSourceResult } from '../../data/drawing-source-client';
import { listDrawingRevisions, type DrawingRevisionOption } from '../../data/drawing-pdf-binding-client';
import { ActionButton, Panel, SectionHeader } from '../../ui';

export function DrawingSourceRegistrationPanel({ client, workspace, onChanged, onNavigate }: { client: SupervisionClient; workspace: Workspace; onChanged?: () => void; onNavigate?: (route: string) => void }) {
  const [title, setTitle] = useState(''); const [revision, setRevision] = useState('');
  const [evidenceId, setEvidenceId] = useState(''); const [predecessorId, setPredecessorId] = useState('');
  const [drawings, setDrawings] = useState<DrawingRevisionOption[]>([]); const [review, setReview] = useState(true);
  const [confirming, setConfirming] = useState(false); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(''); const [result, setResult] = useState<DrawingSourceResult | null>(null);
  const attempt = useRef<{ fingerprint: string; key: string; body: DrawingSourceInput } | null>(null);
  const lifetime = useRef(0);
  useEffect(() => { const seq = ++lifetime.current; let active = true;
    void listDrawingRevisions(client, workspace.project.id).then(items => { if (active && seq === lifetime.current) setDrawings(items); }).catch(reason => { if (active && seq === lifetime.current) setError(String(reason)); });
    return () => { active = false; lifetime.current++; };
  }, [client, workspace.project.id, workspace.items]);
  const pdfs = useMemo(() => workspace.items.filter(item => item.machine === 'evidence' && item.record.sourceType === 'original' && item.record.mediaType === 'document' && item.record.metadata?.mimeType === 'application/pdf').map(item => item.record), [workspace.items]);
  const canRegister = workspace.demo && workspace.role.actorGroup === 'DES' && workspace.role.roleCode === 'designer';
  function prepare() {
    const pdf = pdfs.find(item => item.id === evidenceId); const predecessor = drawings.find(item => item.domainRef.objectId === predecessorId);
    if (!pdf || !title.trim() || !revision.trim()) { setError('도면 제목, 개정 번호와 PDF 원본을 입력하십시오.'); return; }
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
    } catch (reason) { if (seq === lifetime.current) setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { if (seq === lifetime.current) setBusy(false); }
  }
  return <section aria-label="도면 개정 등록"><Panel><SectionHeader title="도면 개정 등록" meta="새 원본 · 검토 요청" />
    <p className="muted">새 개정본은 이전 도면을 보존하며 별도 등록합니다. 먼저 PDF 뷰어에서 원본을 업로드하십시오.</p>
    {canRegister ? <div className="grid gap-3 sm:grid-cols-2">
      <label>도면 제목<input aria-label="새 도면 제목" value={title} maxLength={240} onChange={e => setTitle(e.target.value)} /></label>
      <label>개정 번호<input aria-label="새 개정 번호" value={revision} maxLength={80} onChange={e => setRevision(e.target.value)} /></label>
      <label>PDF 원본<select aria-label="새 도면 PDF" value={evidenceId} onChange={e => setEvidenceId(e.target.value)}><option value="">선택</option>{pdfs.map(item => <option key={item.id} value={item.id}>{String(item.metadata?.name ?? item.id)} · v{item.version}</option>)}</select></label>
      <label>이전 도면<select aria-label="이전 도면 개정" value={predecessorId} onChange={e => setPredecessorId(e.target.value)}><option value="">신규 도면</option>{drawings.map(item => <option key={item.domainRef.objectId} value={item.domainRef.objectId}>{item.title} · {item.revision} · v{item.domainRef.version}</option>)}</select></label>
      <label><input type="checkbox" checked={review} onChange={e => setReview(e.target.checked)} /> 등록 후 검토 요청</label>
      <ActionButton onClick={prepare} disabled={busy}>새 개정 등록 검토</ActionButton>
    </div> : <p>도면 원본 등록은 설계자 개발 역할에서 진행하십시오. 승인과 현장 배포는 별도 절차입니다.</p>}
    {error && <p role="alert">{error}</p>}
    {result && <div role="status"><p>등록 완료: {result.drawing.title} · 개정 {String(result.drawing.revision)} · 원본 v{result.drawing.version}</p><p>검토 요청: {result.approval ? '접수 대기' : '요청하지 않음'} · 현장 사용 전 승인·배포 확인 필요</p>{result.approval && onNavigate && <ActionButton onClick={() => onNavigate('approvals')}>승인 검토 화면</ActionButton>}</div>}
    {confirming && <section role="dialog" aria-modal="true" aria-label="새 도면 개정 등록 확인" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"><div className="max-w-xl rounded-lg bg-white p-6"><h3>새 도면 개정 등록 확인</h3><p>{title} · 개정 {revision}</p><p>원본을 변경하지 않고 새 기록으로 등록합니다. 검토 요청은 승인 완료를 의미하지 않습니다.</p>{error && <p role="alert">{error}</p>}<ActionButton onClick={() => setConfirming(false)} disabled={busy}>취소</ActionButton><ActionButton onClick={() => void submit()} disabled={busy}>{busy ? '등록 중…' : '확인 후 개정 등록'}</ActionButton></div></section>}
  </Panel></section>;
}
