import { expect, test, type Page } from "@playwright/test";

async function login(page: Page, username="operator",password="Synthetic-Password-12",navigate=true) {
  if(navigate)await page.goto("/#/admin");
  await page.getByRole("textbox",{name:"아이디",exact:true}).fill(username);
  await page.getByLabel("비밀번호",{exact:true}).fill(password);
  await page.getByRole("button",{name:"로그인",exact:true}).click();
  await expect(page.getByRole("button",{name:"로그아웃",exact:true})).toBeVisible();
}
async function settings(page: Page) {
  await page.goto("/#/admin");
  await expect(page.getByRole("tab",{name:"기본정보",exact:true})).toBeVisible();
}
const panel=(page:Page,name:string)=>page.getByRole("tabpanel",{name,exact:true});
const unique=()=>"시험-"+Date.now()+"-"+Math.floor(Math.random()*1000);

test("administrator creates a blank project with a visible add button and can reopen it",async({page,context})=>{
  await login(page);await settings(page);
  const button=page.getByRole("button",{name:"＋ 프로젝트 추가",exact:true});await expect(button).toBeVisible();
  await button.click();const form=page.locator("#new-project-form");await expect(form).toBeVisible();
  const name=unique();await form.getByLabel("프로젝트명",{exact:true}).fill(name);
  await form.getByLabel("관리회사명",{exact:true}).fill("시험 관리회사");
  await form.getByLabel("공사 종류",{exact:true}).fill("공장");
  await context.setOffline(true);await expect(form.getByRole("button",{name:"프로젝트 생성",exact:true})).toBeDisabled();
  await context.setOffline(false);await expect(form.getByLabel("프로젝트명",{exact:true})).toHaveValue(name);
  await form.getByRole("button",{name:"프로젝트 생성",exact:true}).click();
  await expect(panel(page,"기본정보").getByLabel("프로젝트명",{exact:true})).toHaveValue(name);
  await expect(page.getByText("합성 테스트 자료 · 실제 현장 증빙 아님",{exact:true})).toHaveCount(0);
  await page.getByRole("tab",{name:"업무배정",exact:true}).click();
  await expect(panel(page,"업무배정").locator("tbody tr")).toHaveCount(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBeTruthy();
  await page.reload();await login(page);await settings(page);
  if(test.info().project.name==="phone")await page.locator(".menu-toggle").click();
  await page.getByRole("combobox",{name:"프로젝트 선택",exact:true}).selectOption({label:name});
  await settings(page);await expect(panel(page,"기본정보").getByLabel("프로젝트명",{exact:true})).toHaveValue(name);
});

test("real project save persists after a new password session",async({page})=>{
  await login(page); await settings(page);
  const form=panel(page,"기본정보"); const name=unique();
  await form.getByLabel("프로젝트명",{exact:true}).fill(name);
  await form.getByRole("button",{name:"기본정보 저장",exact:true}).click();
  await expect(page.getByRole("status").filter({hasText:"프로젝트 설정을 저장했습니다"})).toBeVisible();
  await page.reload(); await login(page); await settings(page);
  await expect(panel(page,"기본정보").getByLabel("프로젝트명",{exact:true})).toHaveValue(name);
  expect(await page.evaluate(()=>Object.values(localStorage).some(v=>v.includes("Synthetic-Password")||v.startsWith("eyJ")))).toBeFalsy();
});

test("four field roles and account choices show names without internal identifiers",async({page})=>{
  await login(page); await settings(page);
  await page.getByRole("tab",{name:"참여회사·담당자",exact:true}).click();
  const role=panel(page,"참여회사·담당자").getByRole("combobox",{name:"역할",exact:true});
  await expect(role).toBeVisible();
  expect(await role.locator("option").allTextContents()).toEqual(["관리자","감리자","발주처","시공사"]);
  await page.getByRole("tab",{name:"로그인계정",exact:true}).click();
  const options=await panel(page,"로그인계정").getByLabel("담당자·역할").locator("option").allTextContents();
  expect(options.join(" ")).not.toMatch(/project_admin|chief_supervisor|[a-f0-9]{8}-[a-f0-9]{4}-/);
  const accountRole=panel(page,"로그인계정").getByRole("combobox",{name:"계정 역할",exact:true});
  expect(await accountRole.locator("option").allTextContents()).toEqual(["관리자","감리자","발주처","시공사"]);
  for(const [code,label] of [["ADM","관리자"],["SUP","감리자"],["OWN","발주처"],["CON","시공사"]]){
    await accountRole.selectOption(code);await expect(panel(page,"로그인계정").getByRole("combobox",{name:"담당자·역할",exact:true})).toContainText(label+" · ");
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBeTruthy();
});

test("company and participant are saved through the API and become an account choice",async({page})=>{
  await login(page);await settings(page);await page.getByRole("tab",{name:"참여회사·담당자",exact:true}).click();
  const tab=panel(page,"참여회사·담당자");const company=unique(); const person=unique();
  await tab.getByLabel("회사명",{exact:true}).fill(company);await tab.getByRole("combobox",{name:"회사 구분",exact:true}).selectOption("CON");
  await tab.getByRole("button",{name:"참여회사 등록",exact:true}).click();
  await expect(tab.getByText(company,{exact:false})).toBeVisible();
  await tab.getByRole("combobox",{name:"역할",exact:true}).selectOption("CON");await tab.getByRole("combobox",{name:"소속 회사",exact:true}).selectOption({label:company});
  await tab.getByLabel("담당자 이름",{exact:true}).fill(person);await tab.getByRole("button",{name:"담당자 등록",exact:true}).click();
  await page.getByRole("tab",{name:"로그인계정",exact:true}).click();
  await panel(page,"로그인계정").getByRole("combobox",{name:"계정 역할",exact:true}).selectOption("CON");
  await expect(panel(page,"로그인계정").getByLabel("담당자·역할").locator("option").filter({hasText:person})).toHaveCount(1);
});

test("conflict keeps entered text and offline blocks saving",async({page,context})=>{
  await login(page);await settings(page);
  const input=panel(page,"기본정보").getByLabel("프로젝트명",{exact:true}); const original=await input.inputValue();
  await input.fill(unique());
  // A second administrator session updates the actual server version.
  const admin=await context.request.post("/api/auth/login",{headers:{Origin:"https://127.0.0.1:5210"},data:{username:"operator",password:"Synthetic-Password-12"}});
  const session=await admin.json();const headers={Origin:"https://127.0.0.1:5210",Authorization:"Bearer "+session.accessToken};
  const response=await context.request.get(`/api/projects/${session.projectId}/settings`,{headers});const data=await response.json();
  const updated=await context.request.post(`/api/projects/${session.projectId}/settings/commands/update_project`,{headers:{...headers,"Idempotency-Key":crypto.randomUUID()},data:{expectedVersion:data.project.version,name:original,country:data.project.country,timezone:data.project.timezone,classification:data.project.classification??""}});
  expect(updated.status()).toBe(200);const draft=await input.inputValue();
  await panel(page,"기본정보").getByRole("button",{name:"기본정보 저장",exact:true}).click();
  await expect(page.getByRole("alert").filter({hasText:"입력은 유지했습니다"})).toBeVisible();await expect(input).toHaveValue(draft);
  await context.setOffline(true);await expect(panel(page,"기본정보").getByRole("button",{name:"기본정보 저장",exact:true})).toBeDisabled();
  await context.setOffline(false);await page.getByRole("button",{name:"다시 불러오기",exact:true}).click();await expect(input).toHaveValue(original);
});

test("registered account authenticates as the assigned supervisor and cannot administer the project",async({page,context})=>{
  await login(page);await settings(page);await page.getByRole("tab",{name:"로그인계정",exact:true}).click();
  const tab=panel(page,"로그인계정");const username="sup"+Date.now();
  await tab.getByRole("combobox",{name:"계정 역할",exact:true}).selectOption("SUP");
  await tab.getByRole("combobox",{name:"담당자·역할",exact:true}).selectOption({label:"감리자 · 가상 감리책임자 · 기존 감리 회사"});
  await tab.getByLabel("로그인 아이디",{exact:true}).fill(username);
  await tab.getByLabel("초기 비밀번호",{exact:true}).fill("Synthetic-Password-34");
  await tab.getByRole("button",{name:"계정 생성",exact:true}).click();
  await expect(page.getByRole("status").filter({hasText:"로그인 계정을 등록했습니다"})).toBeVisible();
  await expect(tab.getByLabel("초기 비밀번호",{exact:true})).toHaveValue("");
  await page.getByRole("button",{name:"로그아웃",exact:true}).click();await expect(page.getByRole("textbox",{name:"아이디",exact:true})).toBeVisible();await login(page,username,"Synthetic-Password-34",false);
  await expect(page.locator("aside.sidebar").getByText("프로젝트 설정",{exact:true})).toHaveCount(0);
  const auth=await context.request.post("/api/auth/login",{headers:{Origin:"https://127.0.0.1:5210"},data:{username,password:"Synthetic-Password-34"}});
  const session=await auth.json();expect(session.actor.actorGroup).toBe("SUP");
  const denied=await context.request.get(`/api/projects/${session.projectId}/settings`,{headers:{Authorization:"Bearer "+session.accessToken}});
  expect(denied.status()).toBe(403);
});

test("approved test project switches real sessions and shows synthetic data and PDF",async({page})=>{
  await login(page);
  if(test.info().project.name==="phone")await page.locator(".menu-toggle").click();
  const chooser=page.getByLabel("프로젝트 선택",{exact:true});await expect(chooser).toBeVisible();
  await chooser.selectOption({label:"DOUL 테스트 프로젝트 · 합성자료"});
  await expect(page.getByText("합성 테스트 자료 · 실제 현장 증빙 아님",{exact:true})).toBeVisible();
  await settings(page);await expect(panel(page,"기본정보").getByLabel("프로젝트명",{exact:true})).toHaveValue("DOUL 테스트 프로젝트 · 합성자료");
  await page.goto("/#/drawings");await expect(page.locator("[data-ui-template=drawing] select").first()).toContainText("SYNTHETIC-A201.pdf");
  await page.getByRole("combobox",{name:"PDF 원본 선택",exact:true}).selectOption({label:"증빙 · SYNTHETIC-A201.pdf"});
  await expect(page.locator("[data-ui-template=drawing] canvas").first()).toBeVisible();
});


test("project choice remains usable on tablets and when desktop navigation is collapsed",async({page})=>{
  await page.setViewportSize({width:768,height:900});await login(page);
  await expect(page.getByRole("combobox",{name:"프로젝트 선택",exact:true})).toBeVisible();
  await expect(page.getByRole("combobox",{name:"프로젝트 선택",exact:true})).toHaveCount(1);
  await page.setViewportSize({width:1024,height:900});
  await expect(page.getByRole("combobox",{name:"프로젝트 선택",exact:true})).toBeVisible();
  await page.setViewportSize({width:1365,height:900});
  await page.locator(".sidebar-collapse-toggle").click();
  const picker=page.getByRole("combobox",{name:"프로젝트 선택",exact:true});await expect(picker).toBeVisible();
  await picker.selectOption({label:"DOUL 테스트 프로젝트 · 합성자료"});
  await expect(page.getByText("합성 테스트 자료 · 실제 현장 증빙 아님",{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBeTruthy();
});
