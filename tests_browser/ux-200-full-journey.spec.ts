import { expect, test, type APIRequestContext, type Page, type Request } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { aggregateCaseResults, assertAcceptanceGate, persistCaseResult, type Domain, type Outcome, type Result, type Role } from "./ux200-evidence";

/**
 * Scenario-by-scenario browser + real demo-API execution, NOT a navigation-only smoke test.
 * Each of the 200 catalogue rows is executed to the furthest verifiable state.
 * PASS is reserved for a case's full automated assertion. All other states
 * are explicitly retained as PARTIAL, BLOCKED, INVALID or FAIL, never PASS.
 * Human-only observations remain awaiting real participants.
 */
type Scenario = { domain: Domain; id: string; title: string; row: any };
const read = (name: string) => JSON.parse(readFileSync(resolve("app/reference/" + name + ".json"), "utf8"));
const R = read("role_field_use_cases_v1");
const F = read("feature_interaction_use_cases_v1");
const D = read("document_authoring_usability_v1");
const M = read("menu_usability_v1");
const formBindings=JSON.parse(readFileSync(resolve("app/forms/form_domain_bindings_v2.json"),"utf8")).forms;
const scenarios: Scenario[] = [
  ...R.cases.map((row: any) => ({ domain: "role" as const, id: row.id, title: row.title, row })),
  ...F.scenarios.map((row: any) => ({ domain: "feature" as const, id: row.id, title: row.title, row })),
  ...D.tasks.map((row: any) => ({ domain: "document" as const, id: row.id, title: row.title, row })),
  ...M.scenarios.map((row: any) => ({ domain: "menu" as const, id: row.id, title: row.title, row })),
];
if (scenarios.length !== 200 || new Set(scenarios.map(x => x.id)).size !== 200)
  throw Error("Source catalogue must contain 200 distinct case IDs.");
const fullMenu = M.roleMenus as Record<Role, {visibleRouteIds:string[]}>;
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
  const picker=page.getByLabel("시험 사용자 역할 선택");
  if(await picker.inputValue()!==role)await picker.selectOption(role);
  await expect(picker).toHaveValue(role);
  // The header changes before the new role's workspace arrives. A visible h1
  // alone lets absence assertions pass against the intervening loading screen.
  await expect(page.locator("main .page-heading .heading-actions button").filter({hasText:"새로고침"})).toBeEnabled();
  await expect(page.locator("main .loading-panel")).toHaveCount(0);
}
async function checkRoute(page:Page,route:string):Promise<void> {
  const button=page.locator(navSelector+' button[data-route="'+route+'"]');
  await expect(page).toHaveURL(new RegExp("#/"+route+"$"));
  await expect(button).toHaveAttribute("aria-current","page");
  await expect(page.locator(navSelector+' button[aria-current="page"]')).toHaveCount(1);
  // Mobile navigation closes the sidebar after a selection. textContent keeps
  // the route label available for comparison even while the drawer is hidden.
  const title=(await button.locator("span").textContent())?.trim();
  expect(title,"업무 메뉴의 제목").toBeTruthy();
  if (route === "drawings") {
    // The plan-workspace replaces the page title with a dedicated command bar.
    await expect(page.locator('[data-ui-component="drawing-sheet-workspace"]')).toBeVisible();
    await expect(page.getByRole("searchbox", { name: "도면 검색" })).toBeVisible();
    await expect(page.getByRole("button", { name: "기존 PDF 검토" })).toBeVisible();
  } else {
    await expect(page.locator("main .page-heading h1")).toHaveText(title!);
  }
  await expect(page.locator("main .page-heading .heading-actions button").filter({hasText:"새로고침"})).toBeEnabled();
  await expect(page.locator("main .loading-panel")).toHaveCount(0);
}
async function openLegacyDrawingReview(page:Page):Promise<void> {
  // Verify both the new per-sheet catalogue and the complete preexisting
  // technical-review workflow remain reachable, without treating the
  // absent legacy tabs on the new default view as a feature failure.
  await expect(page.locator('[data-ui-component="drawing-sheet-workspace"]')).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "도면 검색" })).toBeVisible();
  await page.getByRole("button", { name: "기존 PDF 검토" }).click();
  await expect(page.locator('[data-ui-page="drawings"] [role="tablist"]')).toBeVisible();
}
async function moveTo(page:Page,route:string):Promise<void> {
  const button=page.locator(navSelector+' button[data-route="'+route+'"]');
  await expect(button).toHaveCount(1);
  await button.click();
  await checkRoute(page,route);
}
async function keyboardCycleLength(page:Page):Promise<number> {
  return page.locator("body").evaluate(body=>Array.from(body.querySelectorAll<HTMLElement>(
    'button,input,select,textarea,a[href],[tabindex]')).filter(element=>
    element.tabIndex>=0 && !element.matches(":disabled") && element.getClientRects().length>0 &&
    getComputedStyle(element).visibility!=="hidden").length+2);
}
async function focusWithTab(page:Page,selector:string):Promise<void> {
  const limit=await keyboardCycleLength(page);
  for(let i=0;i<limit;i++){
    await page.keyboard.press("Tab");
    if(await page.locator(selector).evaluate(element=>element===document.activeElement))return;
  }
  throw Error("키보드 Tab 순서에서 목표 항목에 도달하지 못함: "+selector);
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
  const select=page.getByLabel("문서 양식",{exact:true});
  await expect(select).toBeVisible();
  const options=await select.locator("option").evaluateAll(nodes=>
    nodes.map(node=>(node as HTMLOptionElement).value));
  if(formIds.some(id=>!options.includes(id))){
    const absent=formIds.filter(id=>!options.includes(id));
    x.findings.push("실제 문서작성 화면에서 원본 양식 선택 불가: "+absent.join(", "));
    x.checked.push("표준 양식 카탈로그와 실제 선택항목 대조");
    return "BLOCKED";
  }
  for(const formId of formIds){
    await select.selectOption(formId);
    const source=page.getByLabel("문서 원본 선택",{exact:true});
    await expect(source).toBeVisible();
    const candidates=await source.locator("option").evaluateAll(nodes=>
      nodes.map(node=>(node as HTMLOptionElement).value).filter(Boolean));
    if(!candidates.length){
      x.findings.push(formId+" 해당 양식의 유효한 원본자료 없음(자동생성 금지)");
      x.checked.push("필요 원본 후보 확인");
      return "BLOCKED";
    }
    await source.selectOption(candidates[0]);
    await expect(source).toHaveValue(candidates[0]);
    const sourceVersion=/기록 제(\d+)차\s*$/.exec((await source.locator("option:checked").textContent())||"");
    expect(sourceVersion,"사용자가 선택한 원본의 화면 표시 버전").toBeTruthy();
    x.checked.push(formId+" 사용자가 원본자료 명시적으로 선택");
    const mode=page.getByLabel("렌더링 종류",{exact:true});
    await mode.selectOption("draft");
    await expect(mode).toHaveValue("draft");
    const draftInput=page.locator('form.editor-pane .document-fields input[type="text"]').first();
    if(await draftInput.count())await draftInput.fill("UX200-"+x.id+" 검증값 "+randomUUID().slice(0,6));
    const response=page.waitForResponse(r=>
      r.request().method()==="POST" && new URL(r.url()).pathname.endsWith("/forms/"+formId+"/preview"),{timeout:15000});
    const [saved]=await Promise.all([response,page.locator('form.editor-pane button[type="submit"]').click()]);
    const savedBody=await saved.text();
    expect(saved.status(),formId+" response: "+savedBody.slice(0,400)).toBe(200);
    type SourceRef={objectType:string;objectId:string;version:number};
    const sent=saved.request().postDataJSON() as {sourceDomainRefs:SourceRef[]};
    expect(sent.sourceDomainRefs).toHaveLength(1);
    const selectedRef={objectType:sent.sourceDomainRefs[0].objectType,objectId:candidates[0],version:Number(sourceVersion![1])};
    expect(formBindings[formId].domain_sources.map((source:any)=>source.object_type)).toContain(selectedRef.objectType);
    expect(sent.sourceDomainRefs,"요청에 선택한 원본 ID와 정확한 버전을 전달").toEqual([selectedRef]);
    const rendered=JSON.parse(savedBody) as {
      id:string;projectId:string;formId:string;renderHash:string;status:string;
      sourceDomainRefs:SourceRef[];primarySourceRef:SourceRef;
      sourcePayload:{sources:{ref:SourceRef;record:{id:string;version:number;projectId:string}}[]};
    };
    expect(rendered.formId).toBe(formId);
    expect(rendered.status).toBe("draft");
    expect(rendered.id).toBeTruthy();
    expect(rendered.renderHash).toBeTruthy();
    expect(rendered.sourceDomainRefs,"저장된 스냅샷의 원본 참조").toEqual([selectedRef]);
    expect(rendered.primarySourceRef).toEqual(selectedRef);
    expect(rendered.sourcePayload.sources.map(source=>source.ref)).toEqual([selectedRef]);
    expect(rendered.sourcePayload.sources[0].record).toMatchObject({
      id:selectedRef.objectId,version:selectedRef.version,projectId:rendered.projectId,
    });
    await expect(page.locator("iframe[title]")).toBeVisible({timeout:15000});
    await expect(page.locator(".snapshot-note")).toBeVisible({timeout:15000});
    x.checked.push(formId+" 선택한 원본 ID·유형·버전의 스냅샷 보존·초안 서버 저장·HTML 미리보기");
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
    const before=await page.evaluate(()=>({
      pageY:window.scrollY,mainTop:document.querySelector(".main-shell")!.getBoundingClientRect().top,
      footerTop:document.querySelector(".side-bottom")!.getBoundingClientRect().top,
    }));
    const last=nav.locator('button[data-route]').last();
    await last.scrollIntoViewIfNeeded({timeout:5000});
    await expect(last).toBeInViewport();
    await expect.poll(()=>nav.evaluate(element=>element.scrollTop)).toBeGreaterThan(0);
    const after=await page.evaluate(()=>({
      pageY:window.scrollY,mainTop:document.querySelector(".main-shell")!.getBoundingClientRect().top,
      footerTop:document.querySelector(".side-bottom")!.getBoundingClientRect().top,
    }));
    expect(after,"메뉴 스크롤은 본문과 사이드바 하단의 위치를 이동시키지 않아야 함").toEqual(before);
    await last.click();
    await expect(last).toHaveAttribute("aria-current","page");
    x.checked.push("340px 높이 마지막 메뉴 스크롤·클릭·현재상태 및 본문·하단 위치 독립 확인");
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
    x.findings.push("직접 URL 복귀는 확인했으나 서버 명령의 권한 거부는 이 시험에서 수행하지 않음");
    return "PARTIAL";
  }
  if(id==="MC-18"){
    for(const role of ["ADM","SUP","DES","CON","OWN"] as const){
      await switchRole(page,role);
      await moveTo(page,"drawings");
      await openLegacyDrawingReview(page);
      const drawing=page.locator('[data-ui-page="drawings"]');
      await expect(drawing.getByRole("tablist")).toBeVisible();
      await expect(drawing.getByRole("tab",{name:"PDF 도면 보기·마킹",exact:true})).toBeVisible();
      const manage=drawing.getByRole("tab",{name:"도면 등록·배포",exact:true});
      if(["ADM","SUP","DES"].includes(role)){
        await expect(manage).toBeVisible();
        await manage.click();
        await expect(manage).toHaveAttribute("aria-selected","true");
        x.checked.push(role+" 등록·배포 탭 표시·진입");
      }else{
        await expect(manage).toHaveCount(0);
        x.checked.push(role+" 도면 조회 준비 후 등록·배포 탭 미노출");
      }
    }
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
    x.findings.push("입력값·업무권한 유지와 불필요한 제출 부재까지는 이 시험에서 검증하지 않음");
    return "PARTIAL";
  }
  if(id==="MC-07"){
    await moveTo(page,"drawings");await moveTo(page,"documents");
    await page.goBack();await checkRoute(page,"drawings");
    await page.goForward();await checkRoute(page,"documents");
    await page.reload();await checkRoute(page,"documents");
    await expect(page.getByLabel("시험 사용자 역할 선택")).toHaveValue(x.actor);
    x.checked.push("앞·뒤 이동 및 새로고침 후 URL·활성메뉴·제목·역할 복원");
    x.findings.push("기본 감리 역할에서만 유지 확인: 시험 역할을 전환한 뒤 재접속하는 조건은 미검증");
    return "PARTIAL";
  }
  if(["MC-11","MC-13","MC-14"].includes(id)){
    await page.setViewportSize({width:390,height:640});
    const sidebar=page.locator("aside.sidebar");
    const toggle=page.getByRole("button",{name:"메뉴 열기"});
    const nav=page.locator(navSelector);
    const navName=await nav.getAttribute("aria-label");
    expect(navName).toBeTruthy();
    const accessibleNav=page.getByRole("navigation",{name:navName!,exact:true});
    async function closed(){
      await expect(sidebar).toHaveCSS("visibility","hidden");
      await expect(toggle).toHaveAttribute("aria-expanded","false");
      await expect(accessibleNav).toHaveCount(0);
      await expect(page.locator(".sidebar-backdrop")).toHaveCount(0);
    }
    async function open(){
      await toggle.click();
      await expect(sidebar).toHaveCSS("visibility","visible");
      await expect(toggle).toHaveAttribute("aria-expanded","true");
      await expect(accessibleNav).toBeVisible();
    }
    await closed();
    if(id==="MC-11"){
      await open();
      const last=nav.locator("button[data-route]").last();
      const lastRoute=await last.getAttribute("data-route");
      expect(lastRoute).toBeTruthy();
      expect(await nav.evaluate(element=>element.scrollHeight>element.clientHeight)).toBe(true);
      await nav.hover();
      await page.mouse.wheel(0,await nav.evaluate(element=>element.scrollHeight));
      await expect.poll(()=>nav.evaluate(element=>element.scrollTop)).toBeGreaterThan(0);
      await expect(last).toBeInViewport();
      await last.click();await checkRoute(page,lastRoute!);await closed();
      await open();
      await nav.locator('button[data-route="drawings"]').click();
      await checkRoute(page,"drawings");await closed();
      x.checked.push("390px 모바일 메뉴 끝까지 실제 스크롤·마지막 항목 및 도면 선택·자동닫기");
    }else if(id==="MC-13"){
      await toggle.focus();
      const closedCycle=await keyboardCycleLength(page);
      for(let i=0;i<closedCycle;i++){
        await page.keyboard.press("Tab");
        expect(await page.evaluate(()=>Boolean(document.activeElement?.closest("aside.sidebar"))),
          "닫힌 드로어는 Tab 순서에서 제외되어야 함").toBe(false);
      }
      await toggle.focus();await page.keyboard.press("Enter");
      await expect(accessibleNav).toBeVisible();
      const routes=await nav.locator("button[data-route]").evaluateAll(nodes=>
        nodes.map(node=>node.getAttribute("data-route")!));
      const reached=new Set<string>();
      const openCycle=await keyboardCycleLength(page);
      for(let i=0;i<openCycle;i++){
        await page.keyboard.press("Tab");
        const route=await page.evaluate(()=>document.activeElement?.matches("aside.sidebar nav button[data-route]")
          ?document.activeElement.getAttribute("data-route"):null);
        if(route){
          reached.add(route);
          await expect(nav.locator('button[data-route="'+route+'"]')).toBeInViewport();
        }
        if(reached.size===routes.length)break;
      }
      expect([...reached].sort(),"열린 메뉴의 모든 항목은 실제 Tab으로 도달 가능해야 함").toEqual(routes.sort());
      await page.keyboard.press("Escape");await closed();
      x.checked.push("닫힌 메뉴 접근성 트리·Tab 순서 제외 및 열린 메뉴 전 항목 키보드 접근");
    }else{
      await open();await page.keyboard.press("Escape");await closed();
      await open();await page.locator(".sidebar-backdrop").click({position:{x:300,y:300}});await closed();
      await open();await sidebar.locator(".sidebar-close").click();await closed();
      await expect(page.locator("main h1")).toBeVisible();
      x.checked.push("Escape·배경 누르기·닫기 버튼 각각 실행 후 시각·접근성·aria 상태 확인");
    }
    return "PASS";
  }
  if(id==="MC-27"){
    await focusWithTab(page,navSelector+' button[data-route="drawings"]');
    await page.keyboard.press("Enter");await checkRoute(page,"drawings");
    await page.keyboard.press("Shift+Tab");
    await expect(page.locator(navSelector+' button[data-route="today"]')).toBeFocused();
    await page.keyboard.press("Enter");await checkRoute(page,"today");
    x.checked.push("실제 Tab·Enter로 도면화면 진입·활성상태 확인·Shift+Tab·Enter로 오늘 화면 복귀");
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
    const pending=new Set<Request>(),failures:string[]=[],timings:{route:string;elapsedMs:number}[]=[];
    const started=(request:Request)=>{if(new URL(request.url()).pathname.startsWith("/api/"))pending.add(request);};
    const finished=(request:Request)=>{pending.delete(request);};
    const failed=(request:Request)=>{if(pending.delete(request))failures.push(request.url()+" "+request.failure()?.errorText);};
    page.on("request",started);page.on("requestfinished",finished);page.on("requestfailed",failed);
    try{
      const routes=["drawings","inspections","capture","observations","issues","actions","schedule","contract","payment","today"];
      for(const route of routes){
        const start=Date.now();await moveTo(page,route);
        timings.push({route:new URL(page.url()).hash.slice(2),elapsedMs:Date.now()-start});
      }
      await page.goBack();await checkRoute(page,"payment");
      await page.goForward();await checkRoute(page,"today");
      await expect.poll(()=>pending.size,{timeout:15000,message:"이동 후 미종료 API 요청"}).toBe(0);
      expect(failures,"연속 메뉴 이동 중 실패한 요청").toEqual([]);
      const missingRouteEvents=routes.filter((route,index)=>timings[index]?.route!==route).length;
      expect(missingRouteEvents).toBe(0);
      expect(timings).toHaveLength(10);
      x.checked.push("연속 10회 이동·뒤로가기·앞으로가기: "+JSON.stringify({timings,missingRouteEvents,pendingRequests:pending.size,failedRequests:failures.length}));
    }finally{
      page.off("request",started);page.off("requestfinished",finished);page.off("requestfailed",failed);
    }
    return "PASS";
  }
  if(!automatedMenuIds.has(id)){
    x.findings.push(c.row.executionMode==="human"?
      "현장 사용자 관찰/인지 시험 필요":"요구된 문서·데이터 맥락의 전체 업무 수행까지 연결되지 않음");
    return "PARTIAL";
  }
  if(id==="MC-01"){
    await moveTo(page,"drawings");
    await openLegacyDrawingReview(page);
    const drawing=page.locator('[data-ui-page="drawings"]');
    const view=drawing.getByRole("tab",{name:"PDF 도면 보기·마킹",exact:true});
    await expect(view).toBeVisible();await view.click();await expect(view).toHaveAttribute("aria-selected","true");
    const compare=drawing.getByRole("tab",{name:"도면 개정 비교",exact:true});
    await compare.click();await expect(compare).toHaveAttribute("aria-selected","true");
    await expect(page.getByLabel("도면 PDF 비교")).toBeVisible();
    x.checked.push("오늘에서 독립 도면 메뉴 진입·PDF 보기 및 개정 비교 탭 실행");
    return "PASS";
  }
  if(id==="MC-06"){
    for(const route of c.row.sequence)await moveTo(page,route);
    x.checked.push("오늘·도면·문서·오늘 이동마다 URL·단일 활성메뉴·제목 일치");
    return "PASS";
  }
  await moveTo(page,x.route);await moveTo(page,"today");
  x.checked.push("목적 메뉴 이동·복귀");
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
              x.checked.push("동일 브라우저 탭 새로고침 후 임시 필드 내용 복원");
              x.findings.push("탭 내 임시보존만 확인: 브라우저 종료 후 재접속·명시적 서버 저장·최종발행은 미검증");
              x.outcome="PARTIAL";
            }else if(id==="DT-ALL-05"){
              x.outcome=await documentJourney(page,x,["FM-19"]);
              if(x.outcome==="PASS"){
                const documentId=x.evidenceIds.at(-1)!.split("#")[0];
                for(const format of ["pdf","docx"] as const){
                  const button=page.getByRole("button",{name:format.toUpperCase()+" 다운로드",exact:true});
                  await expect(button).toBeEnabled();
                  const response=page.waitForResponse(r=>r.request().method()==="GET" &&
                    new URL(r.url()).pathname.endsWith("/documents/"+documentId+"/exports/"+format));
                  const [exported]=await Promise.all([response,button.click()]);
                  expect(exported.status(),await exported.text()).toBe(501);
                  await expect(page.getByRole("alert")).toContainText("PDF/DOCX 출력 엔진이 설치되지 않았습니다.");
                  x.checked.push(format.toUpperCase()+" 실제 출력 요청·501 및 운영 출력 엔진 미설치 안내");
                }
                x.findings.push("초안 HTML은 생성되지만 실제 PDF/DOCX 출력 엔진이 없어 최종 출력은 BLOCKED");
                x.outcome="BLOCKED";
              }
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
            x.outcome="PARTIAL";
            x.findings.push(c.id==="FC-NAV-02"?
              "마지막 항목 스크롤만 확인: 도면·문서 왕복 및 키보드·터치·휠 전체 조건은 미검증":
              "전체 역할·타 프로젝트 접근권한까지는 현재 테스트로 확인되지 않음");
          }else if(c.domain==="feature" && c.row.featureGroup==="DWG"){
            await openLegacyDrawingReview(page);
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
          throw new Error("브라우저 예외: "+runtimeErrors.join(" | ").slice(0,500));
        }
      }catch(error){
        x.outcome="FAIL";
        x.findings.push("실행 예외: "+String(error).slice(0,650));
        try{await page.screenshot({path:testInfo.outputPath(c.id+".png"),fullPage:true,timeout:5000});}catch{ /* still record text evidence */ }
        // Keep this case failed so Playwright retains its own trace. Default
        // mode with maxFailures=0 continues the remaining cases in a new worker.
        throw error;
      }finally{
        x.elapsedMs=Date.now()-t0;
        persistCaseResult(testInfo.project.outputDir,x);
        await testInfo.attach("ux200-case-result",{body:Buffer.from(JSON.stringify(x,null,2)),contentType:"application/json"});
        testInfo.annotations.push({type:"ux200-outcome",description:x.outcome});
        testInfo.annotations.push({type:"ux200-evidence",description:x.checked.join(" → ").slice(0,600)});
        console.log("UX200_CASE "+JSON.stringify({
          id:x.id,result:x.outcome,elapsedMs:x.elapsedMs,
          verifiedSteps:x.checked.length,notes:x.findings.slice(0,2),
        }));
      }
    });
  }
  // An independent last test is responsible for aggregation and the gate. It
  // must not use module memory: Playwright restarts a worker after a case FAIL.
  test("UX200 summary and acceptance gate",async({},testInfo)=>{
    mkdirSync(".local",{recursive:true});
    const {attempted,counts,byDomain,results:output}=aggregateCaseResults(testInfo.project.outputDir,scenarios.map(resultFor));
    const testedCommit=process.env.GITHUB_SHA || execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim();
    const summary={
      catalogueSource:"PR #158 / faa8c2b855785492fcb0cc9bfe691ba3637e3734",
      testedCommit,caseEvidenceDirectory:resolve(testInfo.project.outputDir,"ux200-cases"),
      meaning:"PASS requires the case's automated conditions; PARTIAL/BLOCKED retain unverified work. Human UX acceptance is separate.",
      requested:200,attempted,automatedE2EPassed:counts.PASS,
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
      "- 카탈로그 기준: PR #158 / 시험 commit: "+testedCommit,
      "- 총 200건 / 고유 case 시도 "+attempted+"건",
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
    for(const extension of ["json","csv","md"])
      await testInfo.attach("ux200-full-results."+extension,{path:resolve(".local/ux200-full-results."+extension)});
    console.log("UX200_SUMMARY "+JSON.stringify({attempted,counts,byDomain,human:"PENDING"}));
    assertAcceptanceGate(attempted,200,counts);
  });
});
