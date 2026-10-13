import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

async function baseline(page: import('@playwright/test').Page) {
  const title = `공정 화면 검증 ${randomUUID().slice(0,8)}`;
  await page.goto('/#/schedule');
  await page.getByRole('combobox', {name:'시험 사용자 역할 선택'}).selectOption('CON');
  await expect(page.getByRole('combobox', {name:'시험 사용자 역할 선택'})).toHaveValue('CON');
  // Changing roles intentionally resets navigation to Today; reopen Schedule.
  await page.goto('/#/schedule');
  await expect(page.locator('[data-ui-component="schedule-workspace"]')).toBeVisible();
  await page.getByRole('tab',{name:'기준공정',exact:true}).click();
  await page.getByRole('button',{name:'공정 기록 추가',exact:true}).click();
  const dialog = page.getByRole('dialog',{name:'공정 기록 추가'});
  await dialog.getByLabel('제목 *',{exact:true}).fill(title);
  for (const [label,value] of [['공정번호 *','BL-UI'],['개정번호 *','B0'],['원본 파일 번호 *',randomUUID()],['원본 파일 무결성 확인값 *','a'.repeat(64)],['원본 파일 작성 차수 *','B0']]) await dialog.getByLabel(label,{exact:true}).fill(value);
  await dialog.getByLabel('원본 형식 *',{exact:true}).fill('xer');
  await dialog.getByText('추가 공정자료 · 참조 · 정정 사유',{exact:true}).click();
  for (const [label,value] of [['기준일','2026-10-06T00:00:00Z'],['계약 완료일','2026-12-31T00:00:00Z'],['예측 완료일','2027-01-15T00:00:00Z']]) await dialog.getByLabel(label,{exact:true}).fill(value);
  const response = page.waitForResponse(r=>r.url().endsWith('/schedule-baselines') && r.request().method()==='POST');
  await dialog.getByRole('button',{name:'기록 추가',exact:true}).click();
  const r=await response; expect(r.status()).toBe(201);
  const record=(await r.json()).record;
  await expect(page.locator('.detail-head')).toContainText(title);
  return {title,record};
}

test('Schedule creates, reloads and withdraws an exact baseline without mutating forecast',async({page})=>{
  const {title,record}=await baseline(page);
  const boundary=page.locator('[data-ui-component="status-boundary-group"]');
  await expect(boundary).toContainText('2026-12-31');
  await expect(boundary).toContainText('2027-01-15');
  await expect(boundary).toContainText('2026-10-06');
  await page.reload();
  await page.getByRole('combobox', {name:'시험 사용자 역할 선택'}).selectOption('CON');
  await page.getByRole('button',{name:'공정·지연·회복',exact:true}).click();
  await page.getByRole('button').filter({hasText:title}).click();
  await page.getByRole('button',{name:'기준공정 철회',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await dialog.getByLabel('사유',{exact:true}).fill('공정 연결시험 종료');
  const response=page.waitForResponse(r=>r.url().endsWith(`/${record.id}/withdraw-baseline`));
  await dialog.getByRole('button',{name:'확인 후 실행'}).click();
  const r=await response;expect(r.status()).toBe(200);
  const body=r.request().postDataJSON();expect(body.expectedVersion).toBe(1);
  expect(r.request().headers()['idempotency-key']).toBeTruthy();
  await expect(page.locator('.detail-head .badge')).toHaveText('요청 철회');
  await expect(boundary).toContainText('2027-01-15');
  await expect(page.locator('.detail-pane').getByRole('button',{name:'기준공정 철회',exact:true})).toHaveCount(0);
});

test('Schedule does not execute commands offline and owner has no contractor withdrawal command',async({page,context})=>{
  const {title}=await baseline(page);
  await context.setOffline(true);
  await expect(page.getByRole('button',{name:'기준공정 철회',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'공정 기록 추가',exact:true})).toBeDisabled();
  await context.setOffline(false);
  await page.getByRole('combobox',{name:'시험 사용자 역할 선택'}).selectOption('OWN');
  await expect(page.getByRole('combobox', {name:'시험 사용자 역할 선택'})).toHaveValue('OWN');
  await page.goto('/#/schedule');
  await expect(page.locator('[data-ui-component="schedule-workspace"]')).toBeVisible();
  await page.getByRole('tab',{name:'기준공정',exact:true}).click();
  await page.getByRole('button').filter({hasText:title}).click();
  await expect(page.locator('.detail-pane').getByRole('button',{name:'기준공정 철회',exact:true})).toHaveCount(0);
});

for (const width of [390,768,1440]) test(`Schedule tabs responsive ${width}`,async({page})=>{
  await page.setViewportSize({width,height:940});await page.goto('/#/schedule');
  await expect(page.locator('[data-ui-component="schedule-workspace"]')).toBeVisible();
  for(const tab of ['기준공정','진도기록','지연사건','회복계획']) {
    await page.getByRole('tab',{name:tab,exact:true}).click();
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBeTruthy();
  }
});

test('Schedule rejects a stale UI command and refresh exposes the saved version',async({page,request})=>{
  const {title,record}=await baseline(page);
  const session=await (await request.post('/api/dev/sessions',{data:{actorGroup:'CON'}})).json();
  const response=await request.post(`/api/projects/${session.projectId}/schedule-baselines/${record.id}/withdraw-baseline`,{
    headers:{Authorization:`Bearer ${session.accessToken}`,'X-RoleAssignment-Id':session.actor.roleAssignmentId,'Idempotency-Key':randomUUID()},
    data:{roleAssignmentId:session.actor.roleAssignmentId,expectedVersion:record.version,payload:{reason:'다른 창에서 철회'},evidenceIds:[]}
  });expect(response.status()).toBe(200);
  await page.getByRole('button',{name:'기준공정 철회',exact:true}).click();
  const dialog=page.getByRole('dialog');await dialog.getByLabel('사유',{exact:true}).fill('오래된 조회본 제출');
  const conflict=page.waitForResponse(r=>r.url().endsWith(`/${record.id}/withdraw-baseline`));
  await dialog.getByRole('button',{name:'확인 후 실행'}).click();expect((await conflict).status()).toBe(409);
  await expect(dialog.getByRole('alert')).toContainText('다른 사용자가 변경했습니다');
  await dialog.getByRole('button',{name:'취소',exact:true}).click();
  const fresh = page.waitForResponse(r => r.url().endsWith('/workspace') && r.ok());
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await fresh;
  await expect(page.locator('.detail-head')).toContainText(title);
  await expect(page.locator('.detail-head .badge')).toHaveText('요청 철회');
});

test('Schedule command sends a number and structured quality review to the real API',async({page})=>{
  await baseline(page);
  await page.getByRole('button',{name:'기준공정 제출',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await dialog.getByLabel('작업 수',{exact:true}).fill('10');
  await dialog.getByLabel('공정 품질검토',{exact:true}).fill('{"logicComplete":false}');
  const response=page.waitForResponse(r=>r.url().endsWith('/submit-baseline'));
  await dialog.getByRole('button',{name:'확인 후 실행'}).click();
  const r=await response;expect(r.request().postDataJSON().payload.activityCount).toBe(10);
  expect(r.request().postDataJSON().payload.scheduleQualitySummary).toEqual({logicComplete:false});
  expect(r.status()).toBe(409);await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(page.locator('.detail-head .badge')).toHaveText('작성 중');
});
