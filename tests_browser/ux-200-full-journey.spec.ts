import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Scenario-by-scenario browser + real demo-API execution, NOT a navigation-only smoke test.
 * Each of the 200 catalogue rows is executed to the furthest verifiable state.
 * PASS is reserved for a case's full automated assertion. All other states
 * are explicitly retained as PARTIAL, BLOCKED, INVALID or FAIL, never PASS.
 * Human-only observations remain awaiting real participants.
 */
type Role = "SUP" | "CON" | "OWN" | "ADM" | "DES";
type Domain = "role" | "feature" | "document" | "menu";
type Scenario = { domain: Domain; id: string; title: string; row: any };
type Outcome = "PASS" | "PARTIAL" | "BLOCKED" | "INVALID" | "FAIL";
type Result = {
  id: string; domain: Domain; title: string; actor: Role; route: string;
  outcome: Outcome; workflowSteps: string[]; checked: string[];
  findings: string[]; elapsedMs: number; executionKind: string;
  evidenceIds: string[]; humanValidation: "PENDING";
};
const read = (name: string) => JSON.parse(readFileSync(resolve("app/reference/" + name + ".json"), "utf8"));
const R = read("role_field_use_cases_v1");
const F = read("feature_interaction_use_cases_v1");
const D = read("document_authoring_usability_v1");
const M = read("menu_usability_v1");
const scenarios: Scenario[] = [
  ...R.cases.map((row: any) => ({ domain: "role" as const, id: row.id, title: row.title, row })),
  ...F.scenarios.map((row: any) => ({ domain: "feature" as const, id: row.id, title: row.title, row })),
  ...D.tasks.map((row: any) => ({ domain: "document" as const, id: row.id, title: row.title, row })),
  ...M.scenarios.map((row: any) => ({ domain: "menu" as const, id: row.id, title: row.title, row })),
];
if (scenarios.length !== 200 || new Set(scenarios.map(x => x.id)).size !== 200)
  throw Error("Source catalogue must contain 200 distinct case IDs.");
const fullMenu = M.roleMenus as Record<Role, {visibleRouteIds:string[]}>;
const availableForms = new Set(D.formCoverage.documentPageSelectableFormIds as string[]);
const featureRoutes: Record<string,string> = {
  NAV:"today", DWG:"drawings", EVD:"capture", INS:"inspections", NCR:"actions",
  SAF:"safety", SCH:"schedule", PAY:"payment", OWN:"owner", HDO:"completion",
  DOC:"documents", ADM:"admin",
};
const menuTargets: Record<string,string> = {
  "MC-01":"drawings", "MC-02":"capture", "MC-03":"actions", "MC-04":"owner",
  "MC-05":"admin", "MC-18":"drawings", "MC-20":"documents",
  "MC-21":"inspections", "MC-25":"drawings", "MC-29":"admin",
};
const liveInspectionIds = new Set([
  "UC-SUP-01","UC-CON-04","FC-INS-01","FC-INS-02","FC-INS-04","FC-INS-05",
]);
const liveDocumentFeatureIds = new Set(["FC-DOC-02","FC-DOC-03","FC-DOC-05","FC-DOC-12","FC-DOC-14"]);
const automatedMenuIds = new Set(["MC-01","MC-06","MC-07","MC-08","MC-09","MC-11","MC-13","MC-14","MC-15","MC-16","MC-17","MC-18","MC-25","MC-27","MC-30"]);
const automatedNavIds = new Set(["FC-NAV-01","FC-NAV-02","FC-NAV-04"]);
const results = new Map<string,Result>();
const navSelector = 'aside.sidebar [data-ui-component="navigation"]';

function getRoute(c:Scenario): string {
  if (c.domain === "feature") return featureRoutes[c.row.featureGroup] || "today";
  if (c.domain === "document") return "documents";
  if (c.domain === "menu") return menuTargets[c.id] || "today";
  const r = c.row, str = String(r.title||"")+" "+String(r.uiActionLabelCandidate||"");
  if (/현장일일|현장기록|현장 순회|현장사진/.test(str)) return "capture";
  if (/재검측|지적|시정|부적합/.test(str)) return "actions";
  if (/검측|반입|자재.*검사/.test(str)) return "inspections";
  if (/도면|설계|상세도|질의/.test(str)) return r.role === "DES" && /질의/.test(str) ? "rfis" : "drawings";
  if (/기성|물량|지급/.test(str)) return "payment";
  if (/공정|지연|회복/.test(str)) return "schedule";
  if (/시운전|준공|인수|하자/.test(str)) return "completion";
  if(r.role==="OWN" && /중대안전|중대사항/.test(str)) return "owner";
  if (/작업허가|안전|위험|작업중지/.test(str)) return "safety";
  if (/계약|공기연장|클레임|보증/.test(str)) return "contract";
  if (/보고|발주처|결정/.test(str)) return "owner";
  if (/문서|양식|서류/.test(str)) return "documents";
  if (r.role === "ADM" || r.domain === "setup" || r.domain === "platform") return "admin";
  return "today";
}
function actorFor(c:Scenario,route:string): Role {
  const raw = c.domain === "role" ? [c.row.role] :
    c.domain === "document" ? [c.row.actorGroup === "ALL" ? "SUP" : c.row.actorGroup] : c.row.actors;
  const actors: Role[] = (raw||[]).filter((z:unknown):z is Role =>
    typeof z === "string" && ["SUP","CON","OWN","ADM","DES"].includes(z)) as Role[];
  return actors.find(a => fullMenu[a]?.visibleRouteIds.includes(route)) || actors[0] || "SUP";
}
function resultFor(c:Scenario):Result {
  const route=getRoute(c), actor=actorFor(c,route);
  return {id:c.id,domain:c.domain,title:c.title,actor,route,
    outcome:"BLOCKED",workflowSteps:[],checked:[],findings:[],
    elapsedMs:0,executionKind:"real_chromium_and_demo_api",evidenceIds:[],humanValidation:"PENDING"};
}
async function step(x:Result, name:string, action:()=>Promise<void>):Promise<void> {
  x.workflowSteps.push(name);
  await action();
  x.checked.push(name);
}
async function switchRole(page:Page,role:Role):Promise<void> {
  if (role==="SUP") return;
  const picker=page.getByLabel("시험 사용자 역할 선택");
  await picker.selectOption(role);
  await expect(picker).toHaveValue(role);
  await expect(page.locator("main h1")).toBeVisible();
}
async function moveTo(page:Page,route:string):Promise<void> {
  const button=page.locator(navSelector+' button[data-route="'+route+'"]');
  await expect(button).toHaveCount(1);
  await button.click();
  await expect(page).toHaveURL(new RegExp("#/"+route+"$"));
  await expect(button).toHaveAttribute("aria-current","page");
  await expect(page.locator("main h1")).toBeVisible();
}
type Session={accessToken:string;projectId:string;actor:{roleAssignmentId:string;partyId:string}};
type RecordType={id:string;version:number;status?:string;resultStatus?:string;nextWorkAllowed?:boolean};
function headers(s:Session, mutation=false){
  return {Authorization:"Bearer "+s.accessToken,"X-RoleAssignment-Id":s.actor.roleAssignmentId,
    ...(mutation?{"Idempotency-Key":randomUUID()}:{})};
}
async function api<T>(request:APIRequestContext,path:string,s:Session,body?:unknown,code=200):Promise<T>{
  const response=body===undefined
    ?await request.get(path,{headers:headers(s)})
    :await request.post(path,{headers:headers(s,true),data:body});
  const data=await response.text();
  expect(response.status(),path+" "+data.slice(0,500)).toBe(code);
  return JSON.parse(data) as T;
}
async function login(request:APIRequestContext,role:"SUP"|"CON"):Promise<Session>{
  const response=await request.post("/api/dev/sessions",{data:{actorGroup:role}});
  expect(response.status(),await response.text()).toBe(200);
  return response.json() as Promise<Session>;
}
async function command(request:APIRequestContext,s:Session,collection:string,
  record:RecordType,action:string,payload:Record<string,unknown>={}, evidenceIds:string[]=[]){
  const result=await api<{record:RecordType}>(request,
    "/api/projects/"+s.projectId+"/"+collection+"/"+record.id+"/"+action.replaceAll("_","-"),
    s,{roleAssignmentId:s.actor.roleAssignmentId,expectedVersion:record.version,payload,evidenceIds});
  expect(result.record.version).toBeGreaterThan(record.version);
  return result.record;
}
/** Real persisted cross-role inspection, including a deliberate forbidden next-work release. */
async function inspectionJourney(request:APIRequestContext,x:Result):Promise<void>{
  const con=await login(request,"CON"),sup=await login(request,"SUP");
  expect(con.projectId).toBe(sup.projectId);
  const ws=await api<{context:{scope:Record<string,unknown>;drawingRef:object;requirementRef:object;evidenceId:string}}>(
    request,"/api/projects/"+con.projectId+"/workspace",con);
  const ctx=ws.context,stamp=new Date();
  const now=stamp.toISOString(),future=new Date(stamp.getTime()+3_600_000).toISOString();
  const title="UX200-"+x.id+"-"+randomUUID().slice(0,8);
  const precheck={drawing:true,material:true,test:true,previous:true,change:true};
  const initial=await api<{record:RecordType}>(request,
    "/api/projects/"+con.projectId+"/inspections",con,{
      roleAssignmentId:con.actor.roleAssignmentId,clientObjectId:randomUUID(),
      payload:{...ctx.scope,workName:title,selfInspectionComplete:true,precheck,
        holdPoint:true,minimumQualificationRank:1,nextWorkAllowed:false,
        requirementRefs:[ctx.requirementRef],drawingRef:ctx.drawingRef,evidenceIds:[ctx.evidenceId]}
    },201);
  x.workflowSteps.push("시공사 자체검측 저장");x.checked.push("시공사 자체검측 저장");
  let record=initial.record;
  record=await command(request,con,"inspections",record,"request",
    {requestedAt:now,requestedInspectionAt:future,selfInspectionComplete:true,precheck,
      drawingRef:ctx.drawingRef,requirementRefs:[ctx.requirementRef]},[ctx.evidenceId]);
  x.checked.push("시공사 검측요청 접수");
  record=await command(request,sup,"inspections",record,"receive",{receivedAt:now},[ctx.evidenceId]);
  record=await command(request,sup,"inspections",record,"schedule",{scheduledAt:now},[ctx.evidenceId]);
  record=await command(request,sup,"inspections",record,"start",{},[ctx.evidenceId]);
  x.checked.push("감리 접수·일정배정·검측시작");
  record=await command(request,sup,"inspections",record,"submit_results",{
    checkResults:[{itemId:"dimension",requirementRef:ctx.requirementRef,result:"pass",
      evidenceIds:[ctx.evidenceId],measuredValue:120,unit:"mm"}]},[ctx.evidenceId]);
  record=await command(request,sup,"inspections",record,"pass",{},[ctx.evidenceId]);
  expect(record.status).toBe("passed");
  expect(record.resultStatus).toBe("pass");
  expect(record.nextWorkAllowed).toBe(false);
  x.checked.push("검측 결과 판정 및 후속공정 허용 분리");
  const denied=await api<{code:string}>(request,
    "/api/projects/"+sup.projectId+"/inspections/"+record.id+"/release-next-work",sup,
    {roleAssignmentId:sup.actor.roleAssignmentId,expectedVersion:record.version,
      payload:{},evidenceIds:[ctx.evidenceId]},409);
  expect(denied.code).toBe("ACCEPTANCE_SIGNED");
  x.checked.push("서명 없는 후속공정 진행 거부");
  const reread=await api<any>(request,
    "/api/projects/"+sup.projectId+"/workspace",sup);
  expect(JSON.stringify(reread.items)).toContain(record.id);
  x.checked.push("서버 원본 재조회·버전 보존");
  x.evidenceIds.push(record.id);
}
async function documentJourney(page:Page,x:Result,formIds:string[]):Promise<"PASS"|"BLOCKED">{
  const missing:string[]=[]; // integrated preview: validate actual runtime form selection, not previous 5-form catalog
  const select=page.locator('form.editor-pane select').first();
  await expect(select).toBeVisible();
  const options=await select.locator("option").evaluateAll(nodes=>
    nodes.map(node=>(node as HTMLOptionElement).value));
  if(missing.length || formIds.some(id=>!options.includes(id))){
    const absent=formIds.filter(id=>!options.includes(id));
    x.findings.push("실제 문서작성 화면에서 원본 양식 선택 불가: "+[...new Set([...missing,...absent])].join(", "));
    x.checked.push("표준 양식 카탈로그와 실제 선택항목 대조");
    return "BLOCKED";
  }
  for(const formId of formIds){
    await select.selectOption(formId);
    const source=page.locator('form.editor-pane select').nth(1);
    await expect(source).toBeVisible();
    const candidates=await source.locator("option").evaluateAll(nodes=>
      nodes.map(node=>(node as HTMLOptionElement).value).filter(Boolean));
    if(!candidates.length){
      x.findings.push(formId+" 해당 양식의 유효한 원본자료 없음(자동생성 금지)");
      x.checked.push("필요 원본 후보 확인");
      return "BLOCKED";
    }
    await source.selectOption(candidates[0]);
    x.checked.push(formId+" 사용자가 원본자료 명시적으로 선택");
    const draftInput=page.locator('form.editor-pane .document-fields input[type="text"]').first();
    if(await draftInput.count())await draftInput.fill("UX200-"+x.id+" 검증값 "+randomUUID().slice(0,6));
    const response=page.waitForResponse(r=>
      r.request().method()==="POST" && r.url().includes("/forms/"+formId+"/render"),{timeout:15000});
    await page.locator('form.editor-pane button[type="submit"]').click();
    const saved=await response;
    const savedBody=await saved.text();
    expect(saved.status(),formId+" response: "+savedBody.slice(0,400)).toBe(200);
    const rendered=JSON.parse(savedBody) as { id:string; formId:string; renderHash:string; status:string };
    expect(rendered.formId).toBe(formId);
    expect(rendered.id).toBeTruthy();
    expect(rendered.renderHash).toBeTruthy();
    await expect(page.locator("iframe[title]")).toBeVisible({timeout:15000});
    await expect(page.locator(".snapshot-note")).toBeVisible({timeout:15000});
    x.checked.push(formId+" 초안 서버 저장·HTML 미리보기");
    x.evidenceIds.push(rendered.id+"#"+rendered.renderHash);
  }
  return "PASS";
}
async function menuJourney(page:Page,c:Scenario,x:Result):Promise<Outcome>{
  const id=c.id;
  if(["MC-09","MC-10","MC-28"].includes(id)){
    await page.setViewportSize({width:1024,height:340});
    const nav=page.locator(navSelector);
    await expect(nav).toHaveCSS("overflow-y","auto");
    const last=nav.locator('button[data-route]').last();
    await last.scrollIntoViewIfNeeded({timeout:5000});
    await expect(last).toBeInViewport();
    await last.click();
    await expect(last).toHaveAttribute("aria-current","page");
    x.checked.push("340px 높이 마지막 메뉴 스크롤·클릭·현재상태 확인");
    if(id!=="MC-09")x.findings.push(id==="MC-10"?
      "긴 프로젝트명·실제 프로젝트 선택 조건 별도 검증 필요":
      "200% 브라우저 확대 조건 별도 검증 필요");
    return id==="MC-09"?"PASS":"PARTIAL";
  }
  if(id==="MC-17"){
    await page.evaluate(()=>{location.hash="#/admin";});
    await expect(page).toHaveURL(/#\/today$/);
    await expect(page.locator('[data-ui-page="admin"]')).toHaveCount(0);
    x.checked.push("비인가 직접 URL 접근 차단");
    return "PASS";
  }
  if(id==="MC-18"){
    await moveTo(page,"drawings");
    await expect(page.getByRole("tab",{name:"도면 등록·배포"})).toHaveCount(0);
    x.checked.push("열람자 도면 등록 권한 분리");
    return "PASS";
  }
  if(id==="MC-25"){
    await moveTo(page,"drawings");
    const picker=page.locator(".top-actions .role-picker select").first();
    for(const lang of ["vi","en","ko"]){
      await picker.selectOption(lang);
      await expect(page).toHaveURL(/#\/drawings$/);
    }
    x.checked.push("화면 언어 전환 후 도면 경로 유지");
    return "PASS";
  }
  if(id==="MC-07"){
    await moveTo(page,"drawings");await moveTo(page,"today");
    await page.goBack();await expect(page).toHaveURL(/#\/drawings$/);
    await page.goForward();await expect(page).toHaveURL(/#\/today$/);
    await page.reload();await expect(page).toHaveURL(/#\/today$/);
    x.checked.push("앞·뒤 이동 및 새로고침 상태 복원");
    return "PASS";
  }
  if(["MC-11","MC-13","MC-14"].includes(id)){
    await page.setViewportSize({width:390,height:640});
    const sidebar=page.locator("aside.sidebar");
    await expect(sidebar).toHaveCSS("visibility","hidden");
    const toggle=page.getByRole("button",{name:"메뉴 열기"});
    await toggle.click();await expect(sidebar).toHaveCSS("visibility","visible");
    await page.keyboard.press("Escape");
    await expect(sidebar).toHaveCSS("visibility","hidden");
    x.checked.push("모바일 메뉴 열기·키보드 Escape·닫기");
    return "PASS";
  }
  if(id==="MC-27"){
    const item=page.locator(navSelector+' button[data-route="drawings"]');
    await item.focus();await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#\/drawings$/);
    x.checked.push("키보드만으로 도면화면 이동");
    return "PASS";
  }
  if(id==="MC-16"){
    await switchRole(page,"OWN");
    await expect(page.locator(navSelector+' button[data-route="admin"]')).toHaveCount(0);
    await moveTo(page,"drawings");
    x.checked.push("사용자 역할 전환 후 관리자 메뉴 은폐");
    return "PARTIAL"; // The actual API authorization for actions is a separate gate.
  }
  if(id==="MC-30"){
    const start=Date.now();
    await moveTo(page,"drawings");await moveTo(page,"today");
    const elapsed=Date.now()-start;
    x.checked.push("왕복 2회 실브라우저 동작 "+elapsed+"ms");
    if(elapsed>10000)throw Error("메뉴 두 번 이동이 10초 초과");
    return "PASS";
  }
  if(!automatedMenuIds.has(id)){
    x.findings.push(c.row.executionMode==="human"?
      "현장 사용자 관찰/인지 시험 필요":"요구된 문서·데이터 맥락의 전체 업무 수행까지 연결되지 않음");
    return "PARTIAL";
  }
  await moveTo(page,x.route);await moveTo(page,"today");
  x.checked.push("목적 메뉴 이동·복귀");
  if(["MC-01","MC-06"].includes(id))return "PASS";
  x.findings.push("이동만 검증: 시나리오 고유의 접근성·사용자 발견/표시 요건은 미검증");
  return "PARTIAL";
}
async function routeAndCheck(page:Page,x:Result){
  await moveTo(page,x.route);
  x.checked.push("역할별 실제 업무 화면 도달");
}
function classifyStatic(c:Scenario,x:Result):Outcome|null {
  if(["UC-SUP-19","UC-SUP-20"].includes(c.id) && c.row.domain!=="completion"){
    x.findings.push("준공검사·인수 업무 분류가 completion이 아님");
    return "INVALID";
  }
  if(c.id==="DT-ALL-04")x.findings.push("200행 표·다국어 인쇄는 일반 사용성보다 스트레스/성능 시험으로 분리 권고");
  if(["UC-ADM-08","UC-ADM-12","UC-ADM-13","FC-ADM-04","FC-ADM-05"].includes(c.id))
    x.findings.push("현장 일반관리자 화면과 시스템운영자/복구권한 분리 필요");
  if(c.domain==="feature" && c.row.implementationSurface==="contract_target")
    x.findings.push("요구계약 대상(구현 완료 아님): "+c.row.implementationSurface);
  return null;
}
const attempts:Result[]=[];
test.describe("UX 200 field journeys: run, verify, and isolate blockers",()=>{
  test.describe.configure({mode:"default"});
  for(const c of scenarios){
    test(c.id+" "+c.title,async({page,request},testInfo)=>{
      test.setTimeout(60000);
      const x=resultFor(c),t0=Date.now();
      const runtimeErrors:string[]=[];
      page.on("pageerror",error=>runtimeErrors.push(error.message));
      try{
        const staticVerdict=classifyStatic(c,x);
        await step(x,"접속 및 현재 역할 확인",async()=>{
          await page.goto("/#/today");
          await expect(page.locator(navSelector)).toBeVisible();
          await switchRole(page,x.actor);
        });
        if(staticVerdict){
          await routeAndCheck(page,{...x,route:fullMenu[x.actor].visibleRouteIds.includes("completion")?"completion":"today"});
          x.outcome=staticVerdict;
        }else if(!fullMenu[x.actor]?.visibleRouteIds.includes(x.route)){
          x.findings.push("전체 개발 메뉴에서 이 사용자에게 업무 경로가 없음: "+x.route);
          x.outcome="BLOCKED";
        }else if(c.domain==="menu"){
          x.outcome=await menuJourney(page,c,x);
        }else{
          await routeAndCheck(page,x);
          if(liveInspectionIds.has(c.id)){
            await step(x,"시공사 신청→감리 접수→검측→판정→근거 재조회",()=>inspectionJourney(request,x));
            x.outcome=["UC-SUP-01","FC-INS-05"].includes(c.id)?"PARTIAL":"PASS";
            if(x.outcome==="PARTIAL")x.findings.push(c.id==="FC-INS-05"?
              "동시 판정·중복제출에 대한 독립 재시도 검증이 추가로 필요":
              "최신 승인도면 개정 대조 및 서명 인수조건이 별도 검증 필요");
          }else if(c.domain==="document"){
            const id=c.id;
            if(id==="DT-ALL-02"){
              const select=page.locator('form.editor-pane select').first();
              await select.selectOption("FM-19");
              const field=page.locator('form.editor-pane .document-fields input[type="text"]').first();
              await expect(field).toBeVisible();
              await field.fill("UX200 임시 작성 내용");
              await page.reload();
              await expect(field).toHaveValue("UX200 임시 작성 내용");
              x.checked.push("작성 중 브라우저 재접속 후 원래 필드 내용 복원");
              x.outcome="PASS";
            }else if(id==="DT-ALL-05"){
              const disabled=page.locator('form.editor-pane button[disabled]');
              await expect(disabled).toHaveCount(2);
              x.checked.push("PDF/DOCX 실제 출력 버튼 비활성 상태 확인");
              x.findings.push("PDF/DOCX 운영 출력이 현재 구현되지 않아 업무 최종 종료 불가");
              x.outcome="BLOCKED";
            }else{
              x.outcome=await documentJourney(page,x,c.row.formIds);
              if(x.outcome==="PASS"){
                x.findings.push("초안 생성·원본 선택은 검증했으나 시나리오별 공식 발행·서명·회신·출력 및 실패처리 전체는 미완료");
                x.outcome="PARTIAL";
              }
            }
          }else if(c.domain==="feature" && liveDocumentFeatureIds.has(c.id)){
            x.outcome=await documentJourney(page,x,["FM-19"]);
            if(x.outcome==="PASS"){
              x.outcome="PARTIAL";
              x.findings.push("문서 원본 선택·HTML 생성은 확인했으나 해당 시나리오의 후속 승인/내보내기/버전 검증까지 종료되지 않음");
            }
          }else if(c.domain==="feature" && automatedNavIds.has(c.id)){
            if(c.id==="FC-NAV-02"){
              await page.setViewportSize({width:1024,height:340});
              const last=page.locator(navSelector+' button[data-route]').last();
              await last.scrollIntoViewIfNeeded();
              await expect(last).toBeInViewport();
              x.checked.push("짧은 화면에서 마지막 업무 메뉴 실접근");
            }else if(c.id==="FC-NAV-04"){
              await page.evaluate(()=>{location.hash="#/admin";});
              await expect(page).toHaveURL(/#\/today$/);
              x.checked.push("금지 주소 보안 복귀");
            }else{
              await moveTo(page,"drawings");await moveTo(page,"today");
              x.checked.push("업무 이동·복귀 상태 유지");
            }
            x.outcome=c.id==="FC-NAV-02"?"PASS":"PARTIAL";
            if(x.outcome==="PARTIAL")x.findings.push("전체 역할·타 프로젝트 접근권한까지는 현재 테스트로 확인되지 않음");
          }else if(c.domain==="feature" && c.row.featureGroup==="DWG"){
            const tabs=page.getByRole("tab");
            await expect(tabs.first()).toBeVisible();
            await page.getByRole("tab",{name:"도면 개정 비교"}).click();
            await expect(page.getByLabel("도면 PDF 비교")).toBeVisible();
            x.checked.push("도면 열람/개정비교 실화면 전환");
            x.outcome="PARTIAL";
            x.findings.push("개정 원본 PDF/마킹 저장·재열람 등 개별 완료조건을 본 시험에서 수행하지 못함");
          }else{
            // Even for unsupported cases, actively attempt target screen and return.
            const targets=fullMenu[x.actor].visibleRouteIds;
            if(targets.includes("today") && x.route!=="today")await moveTo(page,"today");
            x.checked.push("현재 구현된 업무 화면의 출발/복귀 경로 실행");
            x.outcome="PARTIAL";
            x.findings.push("요구되는 제출·승인·복구 등의 사건을 끝까지 실행한 증빙 없음");
            if(c.domain==="feature" && c.row.implementationSurface==="contract_target")
              x.outcome="BLOCKED";
          }
        }
        if(runtimeErrors.length){
          x.outcome="FAIL";x.findings.push("브라우저 예외: "+runtimeErrors.join(" | ").slice(0,500));
        }
      }catch(error){
        x.outcome="FAIL";
        x.findings.push("실행 예외: "+String(error).slice(0,650));
        try{await page.screenshot({path:testInfo.outputPath(c.id+".png"),fullPage:true,timeout:5000});}catch{ /* still record text evidence */ }
      }finally{
        x.elapsedMs=Date.now()-t0;
        attempts.push(x);
        testInfo.annotations.push({type:"ux200-outcome",description:x.outcome});
        testInfo.annotations.push({type:"ux200-evidence",description:x.checked.join(" → ").slice(0,600)});
        console.log("UX200_CASE "+JSON.stringify({
          id:x.id,result:x.outcome,elapsedMs:x.elapsedMs,
          verifiedSteps:x.checked.length,notes:x.findings.slice(0,2),
        }));
      }
    });
  }
  test.afterAll(()=>{
    mkdirSync(".local",{recursive:true});
    const byId=new Map(attempts.map(r=>[r.id,r]));
    const output=scenarios.map(c=>byId.get(c.id)||{
      ...resultFor(c),outcome:"BLOCKED" as const,findings:["테스트가 실제 실행되지 않음"],elapsedMs:0
    });
    const counts=Object.fromEntries(["PASS","PARTIAL","BLOCKED","INVALID","FAIL"]
      .map(k=>[k,output.filter(x=>x.outcome===k).length]));
    const byDomain=Object.fromEntries(["role","feature","document","menu"]
      .map(domain=>[domain,Object.fromEntries(["PASS","PARTIAL","BLOCKED","INVALID","FAIL"].map(status=>
        [status,output.filter(x=>x.domain===domain && x.outcome===status).length]))]));
    const summary={
      source:"PR #158 / faa8c2b855785492fcb0cc9bfe691ba3637e3734",
      meaning:"Each row was attempted; PASS means this test's listed checkpoints succeeded, not human UX acceptance.",
      requested:200,attempted:attempts.length,automatedE2EPassed:counts.PASS,
      humanUXAcceptance:"NOT_PERFORMED",counts,byDomain,results:output,
    };
    writeFileSync(".local/ux200-full-results.json",JSON.stringify(summary,null,2)+"\n");
    const csv=(s:unknown)=>'"'+String(s??"").replaceAll('"','""').replaceAll(/\r?\n/g," ")+'"';
    const rows=["id","domain","title","actor","route","outcome","elapsedMs","checked","findings","evidenceIds"];
    writeFileSync(".local/ux200-full-results.csv",rows.join(",")+"\n"+output.map(x=>
      rows.map(k=>csv(k==="checked"?x.checked.join(";"):k==="findings"?x.findings.join(";"):
        k==="evidenceIds"?x.evidenceIds.join(";"):(x as any)[k])).join(",")).join("\n")+"\n");
    const lines=[
      "# DOUL 감리앱 200건 실행 보고", "",
      "- 기준: PR #158 (2026-10-11)",
      "- 총 200건 / 시도 "+attempts.length+"건",
      "- 평가 구분: "+JSON.stringify(counts),
      "- 현장 사용자 인지·이해도 평가는 별도 미실시",
      "- **PASS는 전체 200건 인수 합격이 아니라 해당 시험이 실제 확인한 단계의 결과임.**", "",
      "| ID | 구분 | 결과 | 확인 단계 | 결함/미완료 사유 |",
      "|---|---|---|---|---|",
      ...output.map(x=>"| "+x.id+" | "+x.domain+" | "+x.outcome+" | "+
        x.checked.join(" → ").slice(0,95).replaceAll("|","/")+" | "+
        x.findings.join("; ").slice(0,150).replaceAll("|","/")+" |"),
    ];
    writeFileSync(".local/ux200-full-results.md",lines.join("\n")+"\n");
    console.log("UX200_SUMMARY "+JSON.stringify({attempted:attempts.length,counts,byDomain,human:"PENDING"}));
    if(attempts.length!==200||counts.FAIL>0||counts.INVALID>0) {
      throw new Error("UX200 acceptance blocked: "+JSON.stringify({
        attempted:attempts.length,failed:counts.FAIL,invalid:counts.INVALID,
        incomplete:counts.PARTIAL+counts.BLOCKED
      })+"; see preserved JSON/CSV report");
    }
  });
});
