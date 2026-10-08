import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { PdfViewport } from "../apps/web/src/data/pdf-coordinate";
import { cssPointToPdfPoint, pdfPointToCssPoint } from "../apps/web/src/data/pdf-coordinate";
import type { DomainRef, Workspace } from "../apps/web/src/data/ui-contract";

function viewportAt(scale: number, rotation: number): PdfViewport {
  const minX = 43, minY = 79, maxX = 655, maxY = 871;
  const pageWidth = maxX - minX, pageHeight = maxY - minY;
  const quarterTurn = rotation === 90 || rotation === 270;
  const width = (quarterTurn ? pageHeight : pageWidth) * scale;
  const height = (quarterTurn ? pageWidth : pageHeight) * scale;
  return {
    width, height, viewBox: [minX, minY, maxX, maxY],
    convertToViewportPoint(x, y) {
      if (rotation === 90) return [(y - minY) * scale, (x - minX) * scale];
      if (rotation === 180) return [(maxX - x) * scale, (y - minY) * scale];
      if (rotation === 270) return [(maxY - y) * scale, (maxX - x) * scale];
      return [(x - minX) * scale, (maxY - y) * scale];
    },
    convertToPdfPoint(x, y) {
      if (rotation === 90) return [minX + y / scale, minY + x / scale];
      if (rotation === 180) return [maxX - x / scale, minY + y / scale];
      if (rotation === 270) return [maxX - y / scale, maxY - x / scale];
      return [minX + x / scale, maxY - y / scale];
    },
  };
}

function twoPagePdf(): Buffer {
  const streams = [
    "BT /F1 24 Tf 72 720 Td (Pin page one) Tj ET",
    "BT /F1 24 Tf 72 720 Td (Pin page two) Tj ET",
  ].map((text) => `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`);
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    streams[0],
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>",
    streams[1],
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

test("PDF point pins round-trip through zoom, rotation, CSS resize, and ignore DPR", () => {
  const pdfPoint = { x: 321.25, y: 442.5 };
  for (const zoom of [0.5, 1, 2.5]) {
    for (const rotation of [0, 90, 180, 270]) {
      const viewport = viewportAt(zoom, rotation);
      for (const cssScale of [0.42, 0.83]) {
        const rect = { left: 37, top: 61, width: viewport.width * cssScale, height: viewport.height * cssScale };
        const css = pdfPointToCssPoint(viewport, rect, pdfPoint);
        expect(css).not.toBeNull();
        const recovered = cssPointToPdfPoint(viewport, rect, rect.left + css!.left, rect.top + css!.top);
        expect(recovered?.x).toBeCloseTo(pdfPoint.x, 8);
        expect(recovered?.y).toBeCloseTo(pdfPoint.y, 8);
      }
    }
  }
  const viewport = viewportAt(1, 0);
  expect(cssPointToPdfPoint(viewport, { left: 10, top: 20, width: viewport.width, height: viewport.height }, 9, 30)).toBeNull();
  expect(pdfPointToCssPoint(viewport, { width: viewport.width, height: viewport.height }, { x: 999, y: 40 })).toBeNull();
});

test("mocked drawing binding plus real Location API stages, saves, and restores exact PDF pins", async ({ page, baseURL }) => {
  let evidenceId = "";
  let evidenceVersion = 0;
  let evidenceHash = "";
  let evidenceProjectId = "";
  let drawingRef: DomainRef | undefined;
  let adminWorkspace: Workspace | undefined;
  let adminSession: { accessToken: string; projectId: string; actor: { roleAssignmentId: string } } | undefined;
  let locationRows: Array<{ reference: DomainRef; name: string; drawingAnchors: unknown[] }> = [];
  let resolveBinding!: () => void;
  const bindingReady = new Promise<void>((resolve) => { resolveBinding = resolve; });

  page.on("response", (response) => {
    const url = response.url();
    if (url.endsWith("/dev/sessions") && response.request().method() === "POST") {
      const body = response.request().postData() || "";
      if (body.includes('"actorGroup":"ADM"')) {
        void response.json().then((session) => { adminSession = session; }).catch(() => undefined);
      }
    }
    if (url.endsWith("/workspace")) {
      void response.json().then((workspace: Workspace) => {
        if (workspace.role.actorGroup === "ADM") {
          adminWorkspace = workspace;
          drawingRef = workspace.context.drawingRef;
          if (evidenceId) resolveBinding();
        }
      }).catch(() => undefined);
    }
    if (url.includes("/parallel/locations") && response.request().method() === "GET") {
      void response.json().then((data) => {
        if (Array.isArray(data?.items)) locationRows = data.items.map((row: { drawingAnchors?: unknown[] }) => ({ ...row, drawingAnchors: row.drawingAnchors ?? [] }));
      }).catch(() => undefined);
    }
  });

  await page.route("**/api/projects/*/parallel/drawing-pdf-bindings", async (route) => {
    await bindingReady;
    const evidenceRef = { objectType: "Evidence", objectId: evidenceId, version: evidenceVersion };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [{
        id: "pdf-pin-binding-fixture",
        projectId: evidenceProjectId,
        drawingRef,
        evidenceRef,
        fileHash: evidenceHash,
        createdAt: "2026-01-01T00:00:00Z",
        createdBy: "ADM",
      }] }),
    });
  });
  await page.route("**/api/projects/*/parallel/drawing-pdf-bindings/pdf-pin-binding-fixture/content", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/pdf", body: twoPagePdf() });
  });

  let initialLocation: { reference: DomainRef; name: string; drawingAnchors: unknown[] } | undefined;
  let insertedAnchor: Record<string, unknown> | undefined;
  let pinSaveSucceeded = false;
  let projectId = "";
  const apiHeaders = () => {
    if (!adminSession) throw new Error("ADM session not captured");
    return {
      Authorization: "Bearer " + adminSession.accessToken,
      "X-RoleAssignment-Id": adminSession.actor.roleAssignmentId,
    };
  };

  try {
    await page.goto("/#/parallel-test");
    await page.getByLabel("개발 역할 선택").selectOption("ADM");
    await expect(page.getByLabel("개발 역할 선택")).toHaveValue("ADM");
    await expect.poll(() => adminWorkspace?.role.actorGroup).toBe("ADM");
    await page.goto("/#/parallel-test");
    await page.getByRole("tab", { name: "도면 버전", exact: true }).click();
    const viewer = page.getByLabel("PDF 도면 뷰어");
    await expect(viewer).toBeVisible();

    const completeResponse = page.waitForResponse((response) =>
      response.url().includes("/uploads/") && response.url().endsWith("/complete") && response.request().method() === "POST",
    );
    await viewer.getByTestId("pdf-upload").setInputFiles({
      name: `pdf-location-pin-${randomUUID()}.pdf`,
      mimeType: "application/pdf",
      buffer: twoPagePdf(),
    });
    const uploadRecord = await completeResponse;
    expect(uploadRecord.ok()).toBeTruthy();
    const evidence = await uploadRecord.json() as { id: string; version: number; fileHash: string; projectId: string };
    evidenceId = evidence.id;
    evidenceVersion = evidence.version;
    evidenceHash = evidence.fileHash;
    evidenceProjectId = evidence.projectId;
    projectId = evidence.projectId;
    if (drawingRef) resolveBinding();

    await expect(viewer.getByLabel("핀을 연결할 위치")).toBeVisible();
    await expect.poll(() => locationRows.length).toBeGreaterThan(0);
    initialLocation = locationRows[0];
    expect(initialLocation.reference.objectType).toBe("Location");
    await viewer.getByLabel("핀을 연결할 위치").selectOption(initialLocation.reference.objectId);
    const canvas = viewer.locator("canvas");
    await expect(canvas).toHaveAttribute("aria-label", "PDF 페이지 1 / 2");
    await expect.poll(() => canvas.evaluate((element: HTMLCanvasElement) => element.width > 0 && element.height > 0)).toBe(true);
    await expect(viewer.getByRole("status", { name: "페이지를 표시하는 중…" })).toHaveCount(0);
    await expect(viewer.getByRole("button", { name: "위치 핀 저장" })).toHaveCount(0);

    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    await canvas.click({ position: { x: box!.width / 2, y: box!.height / 2 } });
    await expect(viewer.getByRole("button", { name: "위치 핀 저장" })).toBeVisible();
    const stagedPin = viewer.getByTestId("pdf-pin-preview");
    await expect(stagedPin).toBeVisible();
    insertedAnchor = {
      drawingRef,
      page: Number(await stagedPin.getAttribute("data-pdf-page")),
      x: Number(await stagedPin.getAttribute("data-pdf-x")),
      y: Number(await stagedPin.getAttribute("data-pdf-y")),
      coordinateSystem: "pdf_points",
    };

    const saveResponse = page.waitForResponse((response) =>
      response.url().includes("/parallel/locations/" + initialLocation!.reference.objectId) && response.request().method() === "PUT",
    );
    await viewer.getByRole("button", { name: "위치 핀 저장" }).click();
    const saved = await saveResponse;
    expect(saved.status()).toBe(200);
    expect(saved.request().headers()["idempotency-key"]).toBeTruthy();
    pinSaveSucceeded = true;
    const refetch = await page.request.get(
      String(baseURL) + "/api/projects/" + projectId + "/parallel/locations",
      { headers: apiHeaders() },
    );
    expect(refetch.ok()).toBeTruthy();
    const locationTree = await refetch.json();
    expect(Array.isArray(locationTree.items)).toBe(true);
    const freshRows = locationTree.items as Array<{ reference: DomainRef; name: string; drawingAnchors?: unknown[] }>;
    const freshLocation = freshRows.find((row) => row.reference.objectId === initialLocation!.reference.objectId);
    expect(freshLocation).toBeTruthy();
    expect(freshLocation!.drawingAnchors).toContainEqual(insertedAnchor);
    expect(freshLocation!.drawingAnchors).toContainEqual(expect.objectContaining({
      drawingRef, page: 1, coordinateSystem: "pdf_points",
    }));
    await expect(viewer.getByRole("button", { name: initialLocation!.name + " 위치 핀" })).toBeVisible();

    await viewer.getByRole("button", { name: "확대" }).click();
    await expect(viewer.getByText("110%", { exact: true })).toBeVisible();
    await expect(viewer.getByRole("status", { name: "페이지를 표시하는 중…" })).toHaveCount(0);
    const zoomPinBox = await viewer.getByRole("button", { name: initialLocation.name + " 위치 핀" }).boundingBox();
    const zoomCanvasBox = await canvas.boundingBox();
    expect(zoomPinBox && zoomCanvasBox).toBeTruthy();
    expect(zoomPinBox!.x).toBeGreaterThanOrEqual(zoomCanvasBox!.x);
    expect(zoomPinBox!.y).toBeGreaterThanOrEqual(zoomCanvasBox!.y);
    expect(zoomPinBox!.x + zoomPinBox!.width).toBeLessThanOrEqual(zoomCanvasBox!.x + zoomCanvasBox!.width + 1);

    await viewer.getByRole("button", { name: "회전" }).click();
    await expect.poll(async () => (await canvas.boundingBox())?.width).not.toBe(zoomCanvasBox!.width);
    await expect(viewer.getByRole("button", { name: initialLocation.name + " 위치 핀" })).toBeVisible();

    adminWorkspace = undefined;
    adminSession = undefined;
    await page.reload();
    await page.getByLabel("개발 역할 선택").selectOption("ADM");
    await expect.poll(() => adminWorkspace?.role.actorGroup).toBe("ADM");
    await expect.poll(() => adminSession?.actor.roleAssignmentId).toBeTruthy();
    await page.goto("/#/parallel-test");
    await page.getByRole("tab", { name: "도면 버전", exact: true }).click();
    const restoredViewer = page.getByLabel("PDF 도면 뷰어");
    await expect(restoredViewer).toBeVisible();
    await restoredViewer.getByLabel("PDF 원본 선택").selectOption(evidenceId);
    await expect(restoredViewer.getByRole("button", { name: initialLocation.name + " 위치 핀" })).toBeVisible();
  } finally {
    // Restore the demo location's original anchor list so the browser fixture is repeatable.
    if (pinSaveSucceeded && insertedAnchor && initialLocation && adminSession && projectId) {
      const headers = apiHeaders();
      const latestResponse = await page.request.get(String(baseURL) + "/api/projects/" + projectId + "/parallel/locations", { headers });
      if (latestResponse.ok()) {
        const latestRows = (await latestResponse.json()).items as Array<{ reference: DomainRef; drawingAnchors?: unknown[] }>;
        const latest = latestRows.find((row) => row.reference.objectId === initialLocation!.reference.objectId);
        if (latest) {
          const restored = (latest.drawingAnchors ?? []).filter((anchor) => JSON.stringify(anchor) !== JSON.stringify(insertedAnchor));
          await page.request.put(
            String(baseURL) + "/api/projects/" + projectId + "/parallel/locations/" + latest.reference.objectId,
            {
              headers: { ...headers, "Idempotency-Key": randomUUID() },
              data: { expectedVersion: latest.reference.version, drawingAnchors: restored },
            },
          );
        }
      }
    }
  }
});
