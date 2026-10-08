import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
test("parallel workspace uses real authenticated API and verifies quarantine upload", async ({ page }) => {
  const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
  await page.goto("/#/parallel-test");
  await expect(page.getByText("병렬 기능 통합 테스트",{exact:true})).toBeVisible();
  for(const name of ["도면 버전","위치 계층","작업함","알림"]){
    await page.getByRole("tab",{name,exact:true}).click();
    await expect(page.getByText("서버 응답을 기다리는 중…",{exact:true})).toHaveCount(0);
    await expect(page.locator(".parallel-test-page [role=alert]")).toHaveCount(0);
    if(name==="도면 버전" || name==="위치 계층") await expect(page.locator(".parallel-test-list button").first()).toBeVisible();
  }
  await page.getByRole("tab",{name:"증빙 격리 테스트",exact:true}).click();
  await page.getByLabel("테스트 파일",{exact:true}).setInputFiles({name:"parallel-test.txt",mimeType:"text/plain",buffer:Buffer.from("DOUL quarantine browser verification")});
  const uploaded=page.waitForResponse(response=>response.url().includes("/parallel/evidence-quarantine")&&response.request().method()==="POST");
  await page.getByRole("button",{name:"격리 테스트 업로드",exact:true}).click();
  const result=await uploaded;expect(result.status()).toBe(200);expect((await result.json()).status).toBe("quarantined");
  await expect(page.getByText("격리 업로드 응답",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"격리 목록 조회",exact:true}).click();
  await expect(page.getByText("격리 파일 목록",{exact:true})).toBeVisible();
  await expect(page.locator(".parallel-test-page [role=alert]")).toHaveCount(0);
  expect(errors).toEqual([]);await mkdir(".local/screenshots",{recursive:true});
  await page.screenshot({path:".local/screenshots/parallel-test.png",fullPage:true});
});
