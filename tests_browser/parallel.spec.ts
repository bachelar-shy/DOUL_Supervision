import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
test("parallel workspace uses real authenticated API and verifies quarantine upload", async ({ page }) => {
  const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
  await page.goto("/#/parallel-test");
  await expect(page.getByRole("heading", { name: "업무별 상세 확인", exact:true })).toBeVisible();
  for(const name of ["도면 작성 차수","위치 계층","작업함","알림"]){
    await page.getByRole("tab",{name,exact:true}).click();
    await expect(page.getByText("업무 시스템 응답을 기다리는 중…",{exact:true})).toHaveCount(0);
    await expect(page.locator(".parallel-test-page [role=alert]")).toHaveCount(0);
    if(name==="도면 작성 차수" || name==="위치 계층") await expect(page.locator(".parallel-test-list button").first()).toBeVisible();
  }
  await page.getByRole("tab",{name:"미등록 파일 확인",exact:true}).click();
  await page.getByLabel("시험 파일",{exact:true}).setInputFiles({name:"parallel-test.txt",mimeType:"text/plain",buffer:Buffer.from("DOUL quarantine browser verification")});
  const uploaded=page.waitForResponse(response=>response.url().includes("/parallel/evidence-quarantine")&&response.request().method()==="POST");
  await page.getByRole("button",{name:"시험 파일 보관",exact:true}).click();
  const result=await uploaded;expect(result.status()).toBe(200);expect((await result.json()).status).toBe("quarantined");
  await expect(page.getByText("시험 파일 보관 결과",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"격리 목록 조회",exact:true}).click();
  await expect(page.getByText("보관된 시험 파일",{exact:true})).toBeVisible();
  await expect(page.locator(".parallel-test-page [role=alert]")).toHaveCount(0);
  expect(errors).toEqual([]);await mkdir(".local/screenshots",{recursive:true});
  await page.screenshot({path:".local/screenshots/parallel-test.png",fullPage:true});
});
