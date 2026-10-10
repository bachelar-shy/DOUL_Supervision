import { createHash } from "node:crypto";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { basename, delimiter, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";

const bundledPhotoPath = resolve(process.cwd(), "design/development/mock-site/assets/SYNTHETIC_WWT_contact_sheet_P01-P12.png");
const photoPath = process.env.DOUL_MOCK_PHOTO_PATH || bundledPhotoPath;
// Use the bundled synthetic contact sheet in CI; a separate generated asset
// can override it for local acceptance runs. Stale or unreadable paths fail.
const photo = readFileSync(photoPath);
const photoName = basename(photoPath);
const photoMime = photoPath.toLowerCase().endsWith(".jpg") || photoPath.toLowerCase().endsWith(".jpeg")
  ? "image/jpeg"
  : "image/png";
if (process.env.CHROMIUM_PATH) test.use({ launchOptions: { executablePath: process.env.CHROMIUM_PATH } });

const jpeg = photo[0] === 0xff && photo[1] === 0xd8 && photo[2] === 0xff;
const png = photo.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
if ((photoMime === "image/jpeg" && !jpeg) || (photoMime === "image/png" && !png)) {
  throw new Error(`DOUL_MOCK_PHOTO_PATH must be an actual JPEG or PNG image: ${photoPath}`);
}

let apiOrigin = "";
let apiProcess: ChildProcess | undefined;
let fixtureDir = "";
let workspaceScope: { packageId: string; locationId: string; discipline: string } | undefined;
const pendingRouteHandlers = new Set<Promise<void>>();

function trackRouteHandler(task: Promise<void>) {
  pendingRouteHandlers.add(task);
  return task.finally(() => pendingRouteHandlers.delete(task));
}

async function availablePort() {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not allocate a test API port");
  const port = address.port;
  await new Promise<void>((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
  return port;
}

async function stopApi() {
  if (apiProcess && apiProcess.exitCode === null) {
    const child = apiProcess;
    child.kill("SIGTERM");
    await new Promise<void>(done => {
      const timeout = setTimeout(() => { child.kill("SIGKILL"); done(); }, 3_000);
      child.once("exit", () => { clearTimeout(timeout); done(); });
    });
  }
  apiProcess = undefined;
  if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true });
  fixtureDir = "";
}

async function proxyApi(page: Page) {
  await page.route("**/api/**", route => trackRouteHandler((async () => {
    const requestUrl = new URL(route.request().url());
    const path = requestUrl.pathname.replace(/^\/api/, "");
    const response = await route.fetch({ url: `${apiOrigin}${path}${requestUrl.search}` });
    if (requestUrl.pathname.endsWith("/workspace") && response.ok()) {
      const body = await response.json() as { context?: { scope?: typeof workspaceScope } };
      workspaceScope = body.context?.scope;
      await route.fulfill({ response, json: body });
      return;
    }
    await route.fulfill({ response });
  })()));
}

test.beforeEach(async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  workspaceScope = undefined;
  const port = await availablePort();
  apiOrigin = `http://127.0.0.1:${port}`;
  fixtureDir = mkdtempSync(resolve(tmpdir(), "doul-mock-photo-"));
  const python = process.env.DOUL_TEST_PYTHON || "/workspace/DOUL_Supervision/work/priority-venv/bin/python";
  const browserOrigin = new URL(String(testInfo.project.use.baseURL)).origin;
  apiProcess = spawn(python, [
    "-m", "services.api", "--demo", "--database", resolve(fixtureDir, "demo.sqlite3"), "--port", String(port),
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DOUL_API_ALLOWED_ORIGINS: `${browserOrigin},${apiOrigin}`,
      PYTHONPATH: [process.cwd(), process.env.PYTHONPATH].filter(Boolean).join(delimiter),
    },
    stdio: "ignore",
  });
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (apiProcess.exitCode !== null) throw new Error(`Disposable demo API exited (${apiProcess.exitCode})`);
    try {
      if ((await fetch(`${apiOrigin}/health`)).ok) {
        await proxyApi(page);
        return;
      }
    } catch { /* Wait for the owned FastAPI process to bind its port. */ }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 150));
  }
  throw new Error("Disposable demo API did not become healthy");
});

test.afterEach(async ({ page }) => {
  try {
    // Wait for live API forwarding to finish before removing its handler or
    // stopping the process. `wait` also drains Playwright's active route work.
    while (pendingRouteHandlers.size) await Promise.all([...pendingRouteHandlers]);
    await page.unrouteAll({ behavior: "wait" });
    await page.close();
  } finally {
    await stopApi();
  }
});

async function openKoreanCapture(page: Page) {
  await page.addInitScript(() => localStorage.setItem("doul.locale", "ko"));
  await page.goto("/#/capture");
  await expect(page.locator('[data-ui-page="capture"]')).toBeVisible();
  await expect(page.getByLabel("증빙 파일 선택")).toBeVisible();
}

async function uploadPhoto(page: Page, bytes: Buffer, ackLostOnce = false) {
  let loseNextCompletionAcknowledgement = ackLostOnce;
  const uploadStarts: Array<{ captureId: string; key: string | undefined }> = [];
  const completionPaths: string[] = [];
  const completionKeys: Array<string | undefined> = [];
  await page.route("**/api/projects/*/uploads**", route => trackRouteHandler((async () => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api/, "");
    if (request.method() === "POST" && path.endsWith("/uploads")) {
      const payload = request.postDataJSON() as { captureId: string };
      uploadStarts.push({ captureId: payload.captureId, key: request.headers()["idempotency-key"] });
    }
    if (request.method() === "POST" && /\/uploads\/[^/]+\/complete$/.test(path)) {
      completionPaths.push(path);
      completionKeys.push(request.headers()["idempotency-key"]);
      const response = await route.fetch({ url: `${apiOrigin}${path}${url.search}` });
      if (loseNextCompletionAcknowledgement && response.status() === 201) {
        loseNextCompletionAcknowledgement = false;
        await response.dispose();
        await route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ message: "Synthetic lost upload acknowledgement after server commit" }) });
        return;
      }
      await route.fulfill({ response });
      return;
    }
    const response = await route.fetch({ url: `${apiOrigin}${path}${url.search}` });
    await route.fulfill({ response });
  })()));

  await page.getByLabel("증빙 파일 선택").setInputFiles({ name: photoName, mimeType: photoMime, buffer: bytes });
  const row = page.locator(".pending-row").filter({ has: page.getByText(photoName, { exact: true }) });
  await expect(row).toBeVisible();
  const send = row.getByRole("button", { name: "서버 전송", exact: true });
  const firstResponse = page.waitForResponse(response => response.url().includes("/uploads/") && response.url().endsWith("/complete") && response.request().method() === "POST");
  await send.click();
  const first = await firstResponse;
  if (ackLostOnce) {
    expect(first.status()).toBe(502);
    await expect(row).toBeVisible();
    await expect(page.getByRole("alert")).toBeVisible();
    const retryResponse = page.waitForResponse(response => response.url().includes("/uploads/") && response.url().endsWith("/complete") && response.request().method() === "POST");
    await send.click();
    const retried = await retryResponse;
    // The API returns 200 when the completion key resolves to the already
    // committed Evidence record after the first acknowledgement was lost.
    expect(retried.status(), await retried.text()).toBe(200);
    return { row, uploaded: retried, uploadStarts, completionPaths, completionKeys };
  }
  expect(first.status(), await first.text()).toBe(201);
  return { row, uploaded: first, uploadStarts, completionPaths, completionKeys };
}

function localKoreanDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(new Date(value));
}

test.describe("desktop Korean site-photo intake", () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test("uploads the real synthetic image, persists date and location, downloads exact bytes, and retries idempotently", async ({ page, request }, testInfo) => {
    const bytes = photo;
    // CapturePage stamps the UI intake time; this deliberately does not claim
    // to read EXIF or infer the photo's original camera time.
    const intakeStartedAt = Date.now();
    await openKoreanCapture(page);
    await expect(page.getByText("사진·영상·음성과 PDF·Excel 원본을 등록합니다.")).toBeVisible();

    const { row, uploaded, uploadStarts, completionPaths, completionKeys } = await uploadPhoto(page, bytes, true);
    const evidence = await uploaded.json() as {
      id: string; projectId: string; fileHash: string; mediaType: string;
      sourceType: string; capturedAt: string; locationId: string;
      packageId: string; discipline: string; metadata: { name: string; mimeType: string; byteCount: number };
    };
    expect(evidence.fileHash).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(evidence.mediaType).toBe("photo");
    expect(evidence.sourceType).toBe("original");
    expect(evidence.metadata).toMatchObject({ name: photoName, mimeType: photoMime, byteCount: bytes.length });
    expect(Date.parse(evidence.capturedAt)).toBeGreaterThanOrEqual(intakeStartedAt - 5_000);
    expect(Date.parse(evidence.capturedAt)).toBeLessThanOrEqual(Date.now() + 5_000);
    expect(evidence.locationId).toBeTruthy();
    expect(evidence.packageId).toBe(workspaceScope?.packageId);
    expect(evidence.locationId).toBe(workspaceScope?.locationId);
    expect(evidence.discipline).toBe(workspaceScope?.discipline);
    expect(uploadStarts).toHaveLength(2);
    expect(uploadStarts[1]).toEqual(uploadStarts[0]);
    expect(completionPaths).toHaveLength(2);
    expect(completionPaths[1]).toBe(completionPaths[0]);
    expect(completionKeys[1]).toBe(completionKeys[0]);
    await expect(row).toHaveCount(0);

    const auth = uploaded.request().headers();
    const roleAssignmentId = (uploaded.request().postDataJSON() as { roleAssignmentId: string }).roleAssignmentId;
    const download = await request.get(`${apiOrigin}/projects/${evidence.projectId}/evidence/${evidence.id}/content`, {
      headers: { Authorization: auth.authorization, "X-RoleAssignment-Id": roleAssignmentId },
    });
    expect(download.status()).toBe(200);
    expect(createHash("sha256").update(await download.body()).digest("hex")).toBe(evidence.fileHash);

    const evidenceCard = page.getByRole("button", { name: new RegExp(photoName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) });
    await expect(evidenceCard).toBeVisible();
    await evidenceCard.click();
    const detail = page.locator('[data-ui-component="evidence-detail-sheet"]');
    await expect(detail).toBeVisible();
    const captureDate = localKoreanDate(evidence.capturedAt);
    await expect(detail.getByText("촬영 시각", { exact: true }).locator("..")).toContainText(captureDate);
    await expect(detail.getByText("위치 / 공종", { exact: true }).locator("..")).toContainText(evidence.locationId);
    await detail.getByRole("tab", { name: "출처·연결" }).click();
    await expect(detail.getByText("위치", { exact: true }).locator("..")).toContainText(evidence.locationId);

    await detail.getByRole("tab", { name: "기본정보" }).click();
    await expect(detail.getByText("촬영 시각", { exact: true }).locator("..")).toContainText(captureDate);
    await expect(detail.getByText("위치 / 공종", { exact: true }).locator("..")).toContainText(evidence.locationId);
    await page.screenshot({ path: testInfo.outputPath("mock-site-photo-desktop-ko.png"), fullPage: true });
  });
});

test.describe("mobile Korean site-photo intake", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("uploads and opens the original photo without clipping Korean capture controls", async ({ page }, testInfo) => {
    const bytes = photo;
    await openKoreanCapture(page);
    await expect(page.getByText("사진·영상·음성과 PDF·Excel 원본을 등록합니다.")).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();

    const { uploaded } = await uploadPhoto(page, bytes);
    const evidence = await uploaded.json() as { id: string; fileHash: string; capturedAt: string; locationId: string };
    expect(evidence.fileHash).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(evidence.locationId).toBe(workspaceScope?.locationId);
    const evidenceCard = page.getByRole("button", { name: new RegExp(photoName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) });
    await expect(evidenceCard).toBeVisible();
    await evidenceCard.click();
    const detail = page.locator('[data-ui-component="evidence-detail-sheet"]');
    await expect(detail).toBeVisible();
    await expect(detail.getByText("촬영 시각", { exact: true }).locator("..")).toContainText(localKoreanDate(evidence.capturedAt));
    await expect(detail.getByText("위치 / 공종", { exact: true }).locator("..")).toContainText(evidence.locationId);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
    await page.screenshot({ path: testInfo.outputPath("mock-site-photo-mobile-ko.png"), fullPage: true });
  });
});
