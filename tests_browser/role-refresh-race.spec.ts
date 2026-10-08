import {expect,test} from '@playwright/test';
for (const fails of [false,true]) test(`a delayed prior-role ${fails ? 'failure' : 'refresh'} cannot replace the active workspace`, async ({page}) => {
  await page.goto('/#/parallel-test');
  await expect(page.getByLabel('PDF 도면 뷰어')).toBeVisible();
  let release!: () => void;
  let captured!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { captured = resolve; });
  let first = true;
  await page.route('**/workspace', async route => {
    if (!first) { await route.continue(); return; }
    first = false;
    const response = await route.fetch();
    captured(); await held;
    if (fails) await route.fulfill({status:503,json:{message:'Synthetic delayed refresh failure'}});
    else await route.fulfill({response});
  });
  await page.getByRole('button',{name:'새로고침',exact:true}).click();
  await ready;
  await page.getByLabel('개발 역할 선택').selectOption('ADM');
  await page.goto('/#/parallel-test');
  await expect(page.getByTestId('drawing-field-register')).toBeVisible();
  const oldResponse = page.waitForResponse(response => response.url().endsWith('/workspace') && response.request().headers()['x-roleassignment-id'] !== undefined);
  release(); await oldResponse;
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.getByTestId('drawing-field-register')).toBeVisible();
  await expect(page.getByLabel('개발 역할 선택')).toHaveValue('ADM');
});
