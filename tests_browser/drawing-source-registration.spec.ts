import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
function onePagePdf(): Buffer {
  const text = "BT /F1 24 Tf 72 720 Td (Markup integration drawing page) Tj ET";
  const stream = `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    stream,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(body, "ascii"));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(body, "ascii");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, "ascii");
}

test('designer registers an immutable PDF revision and explicitly requests technical review', async ({ page }) => {
  const suffix = randomUUID().slice(0,8); const title = `Synthetic authored drawing ${suffix}`;
  // Designers use the official drawing workspace, not the SUP/ADM diagnostic.
  await page.goto('/#/drawings');
  await page.getByLabel('시험 사용자 역할 선택').selectOption('DES');
  await page.goto('/#/drawings');
  const viewer = page.getByLabel('PDF 도면 보기');
  const upload = page.waitForResponse(r => r.url().includes('/uploads/') && r.url().endsWith('/complete') && r.request().method() === 'POST');
  await viewer.getByTestId('pdf-upload').setInputFiles({ name: `authored-${suffix}.pdf`, mimeType:'application/pdf', buffer:onePagePdf() });
  const completed = await upload; expect(completed.ok(), await completed.text()).toBeTruthy();
  const evidence = await completed.json() as {id:string;version:number};
  await page.getByRole('tab', { name: '도면 등록·배포', exact: true }).click();
  const panel = page.getByRole('region', {name:'도면 개정 등록'});
  await panel.getByLabel('새 도면 제목').fill(title);
  await panel.getByLabel('새 개정 번호').fill('01');
  await panel.getByLabel('새 도면 PDF').selectOption(evidence.id);
  const writes: unknown[] = []; page.on('request',r=>{ if(r.method()==='POST' && r.url().endsWith('/parallel/drawing-sources')) writes.push(r.postDataJSON()); });
  await panel.getByRole('button',{name:'새 개정 등록 검토'}).click();
  const dialog = page.getByRole('dialog',{name:'새 도면 개정 등록 확인'});
  await dialog.getByRole('button',{name:'취소',exact:true}).click(); expect(writes).toHaveLength(0);
  await panel.getByRole('button',{name:'새 개정 등록 검토'}).click();
  const creation = page.waitForResponse(r=>r.url().endsWith('/parallel/drawing-sources') && r.request().method()==='POST');
  await dialog.getByRole('button',{name:'확인 후 개정 등록'}).click();
  const response = await creation; expect(response.status(),await response.text()).toBe(201);
  const result = await response.json() as {drawing:{id:string;status:string};binding:{drawingRef:{objectId:string}};approval:{status:string;targetRef:{objectId:string}}};
  expect(result.drawing.status).toBe('draft'); expect(result.approval.status).toBe('pending');
  expect(result.approval.targetRef.objectId).toBe(result.drawing.id); expect(result.binding.drawingRef.objectId).toBe(result.drawing.id);
  expect(writes).toHaveLength(1); await expect(panel.getByText(new RegExp(`등록 완료: ${title}`))).toBeVisible();
  await page.reload();
  await page.getByLabel('시험 사용자 역할 선택').selectOption('DES');
  await page.goto('/#/drawings');
  await page.getByRole('tab', { name: '도면 등록·배포', exact: true }).click();
  await expect(page.getByLabel('도면 작성 차수 기록').getByRole('button', {name: new RegExp(title)})).toBeVisible();
});
