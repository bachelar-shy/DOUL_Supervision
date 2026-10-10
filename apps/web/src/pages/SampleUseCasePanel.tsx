import { useEffect, useState } from "react";
import type { SupervisionClient } from "../data/supervision-client";

type Case = {
  id: string;
  title: string;
  category: string;
  roles: string[];
  situation: string;
  expected: string;
  classification: "synthetic_development_only";
  actualFieldAcceptance: false;
};
type Result = {
  id: string;
  status: "PASS" | "PARTIAL" | "FAIL";
  message: string;
  checks: string[];
  runAt?: string;
};
type CatalogResponse = {
  projectId: string;
  cases: Case[];
  runs: Record<string, Result>;
  sampleStats: Record<string, number>;
  actualFieldAcceptance: false;
};

export function SampleUseCasePanel({ client, projectId }: { client: SupervisionClient; projectId: string }) {
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [activeId, setActiveId] = useState("UC-01");
  const [executing, setExecuting] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");

  async function refresh() {
    const response = await client.request<CatalogResponse>(
      "/dev/sample/usecases?projectId=" + encodeURIComponent(projectId),
    );
    setCatalog(response);
  }

  useEffect(() => {
    let mounted = true;
    client.request<CatalogResponse>(
      "/dev/sample/usecases?projectId=" + encodeURIComponent(projectId),
    ).then(response => { if (mounted) { setCatalog(response); setError(""); } })
      .catch((reason: unknown) => {
        if (mounted) setError(reason instanceof Error ? reason.message : "사례 목록을 조회하지 못했습니다.");
      });
    return () => { mounted = false; };
  }, [client, projectId]);

  async function runCase(id: string) {
    const result = await client.request<Result>("/dev/sample/usecases/" + id + "/run", {
      method: "POST",
      body: JSON.stringify({ projectId }),
    });
    setCatalog(previous => previous ? ({
      ...previous,
      runs: { ...previous.runs, [id]: result },
    }) : previous);
    return result;
  }

  async function execute(id: string) {
    setExecuting(id);
    setProgress("");
    setError("");
    try { await runCase(id); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "검증을 실행하지 못했습니다."); }
    finally { setExecuting(null); }
  }

  async function executeAll() {
    if (!catalog) return;
    setExecuting("all");
    setError("");
    try {
      for (let i = 0; i < catalog.cases.length; i++) {
        const item = catalog.cases[i];
        setProgress(`${i + 1}/${catalog.cases.length} · ${item.id}`);
        await runCase(item.id);
      }
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "전체 실행 중 오류가 발생했습니다.");
    } finally {
      setExecuting(null);
      setProgress("");
    }
  }

  const active = catalog?.cases.find(item => item.id === activeId) ?? catalog?.cases[0];
  const latest = active && catalog?.runs[active.id];
  const counts = catalog ? {
    pass: Object.values(catalog.runs).filter(run => run.status === "PASS").length,
    partial: Object.values(catalog.runs).filter(run => run.status === "PARTIAL").length,
    fail: Object.values(catalog.runs).filter(run => run.status === "FAIL").length,
  } : { pass: 0, partial: 0, fail: 0 };

  return (
    <section data-testid="sample-usecase-panel" className="mt-6 space-y-4 rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-base font-semibold">DOUL SAMPLE · 상황별 유즈케이스 검증</h2>
          <p className="text-xs text-slate-600">합성 시험자료 · 실제 현장증빙이나 법정 인수가 아닙니다.</p>
          <p className="text-xs text-slate-600">사례를 실행하면 독립 DB 복사본에서 실제 업무 API를 시험합니다. 샘플 프로젝트 원본은 변경하지 않습니다.</p>
        </div>
        <button type="button" onClick={() => void executeAll()} disabled={!catalog || !!executing}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {executing === "all" ? `실행 중 ${progress}` : "15개 사례 전체 검증"}
        </button>
      </div>

      {error && <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
      {!catalog ? <p className="text-sm text-slate-600">사례 목록을 불러오는 중입니다.</p> : <>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            ["등록 사례", catalog.cases.length],
            ["통과", counts.pass],
            ["부분 검증", counts.partial],
            ["실패", counts.fail],
          ].map(([label, number]) => (
            <div key={label} className="rounded-lg bg-slate-50 p-3">
              <div className="text-xs text-slate-600">{label}</div>
              <div className="mt-1 text-xl font-semibold tabular-nums">{number}</div>
            </div>
          ))}
        </div>

        <p className="text-xs text-slate-600">
          등록 자료: 도면 {catalog.sampleStats.drawings}개 · 사진 파생뷰 {catalog.sampleStats.photos}개 ·
          검측 {catalog.sampleStats.inspections}건 · 지적 {catalog.sampleStats.issues}건 ·
          시정조치 {catalog.sampleStats.actions}건 · 보고 {catalog.sampleStats.reports}건
        </p>

        <div className="grid gap-3 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
          <div aria-label="사례 목록" className="max-h-[490px] min-h-[220px] space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
            {catalog.cases.map(item => {
              const state = catalog.runs[item.id]?.status ?? "미검증";
              return (
                <button type="button" key={item.id} aria-pressed={activeId === item.id}
                  onClick={() => setActiveId(item.id)}
                  className={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-2.5 text-left text-sm ${activeId === item.id ? "bg-slate-100 font-semibold" : "hover:bg-slate-50"}`}>
                  <span className="min-w-0"><span className="mr-2 text-xs text-slate-500">{item.id}</span>{item.title}</span>
                  <span className="shrink-0 text-xs text-slate-500">{state}</span>
                </button>
              );
            })}
          </div>

          <div className="min-h-[250px] space-y-3 rounded-lg border border-slate-200 p-4">
            {active && <>
              <div className="text-xs text-slate-500">{active.category} · {active.id}</div>
              <h3 className="text-base font-semibold">{active.title}</h3>
              <p className="text-sm">{active.situation}</p>
              <p className="text-xs text-slate-600">참여: {active.roles.join(" · ")}</p>
              <p className="text-xs text-slate-600">예상 결과: {active.expected}</p>
              <button type="button" onClick={() => void execute(active.id)} disabled={!!executing}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium disabled:opacity-50">
                {executing === active.id ? "검증 중..." : "선택 사례 실행"}
              </button>
              {latest ? (
                <div className="space-y-2 border-t border-slate-200 pt-3" aria-live="polite">
                  <div className="text-sm font-semibold">검증 결과: {latest.status}</div>
                  <p className="text-xs text-slate-600">{latest.message}</p>
                  {latest.runAt && <p className="text-xs text-slate-500">{new Date(latest.runAt).toLocaleString()}</p>}
                  <ol className="max-h-[210px] list-decimal space-y-1 overflow-y-auto pl-5 text-xs">
                    {latest.checks.map((check, index) => <li key={index}>{check}</li>)}
                  </ol>
                </div>
              ) : <p className="text-xs text-slate-500">아직 실행한 기록이 없습니다.</p>}
            </>}
          </div>
        </div>
        <p className="text-xs text-slate-500">
          사진 60개는 한 개의 합성 원본에 포함된 장면 12개의 파생 뷰입니다.
          관리자 계정 발급·법적 서명·실제 오프라인 복귀 등은 별도 검증이 필요합니다.
        </p>
      </>}
    </section>
  );
}
