import { expect, test } from "@playwright/test";
import { listPdfEvidenceSources } from "../apps/web/src/data/pdf-viewer-client";
import type { Workspace } from "../apps/web/src/data/ui-contract";

const workspace = {
  context: {
    drawingRef: { objectType: "drawing", objectId: "DRW-42", version: 3 },
  },
  items: [
    { machine: "evidence", record: { id: "pdf-bound", metadata: { name: "plan.pdf", mimeType: "application/pdf" }, drawingRef: { objectType: "drawing", objectId: "DRW-42", version: 3 } } },
    { machine: "evidence", record: { id: "pdf-unbound", metadata: { name: "other.pdf", mimeType: "application/pdf", drawingRef: { objectType: "drawing", objectId: "DRW-42", version: 3 } } } },
    { machine: "evidence", record: { id: "pdf-stale", metadata: { name: "old.pdf", mimeType: "application/pdf" }, drawingRef: { objectType: "drawing", objectId: "DRW-42", version: 2 } } },
    { machine: "evidence", record: { id: "image", metadata: { name: "photo.jpg", mimeType: "image/jpeg" } } },
    { machine: "inspection", record: { id: "not-evidence", metadata: { name: "plan.pdf", mimeType: "application/pdf" } } },
  ],
} as unknown as Workspace;

test("lists only readable evidence PDFs and labels only exact drawing-bound sources", () => {
  const sources = listPdfEvidenceSources(workspace);
  expect(sources.map((source) => source.id)).toEqual(["pdf-bound", "pdf-unbound", "pdf-stale"]);
  expect(sources[0]).toMatchObject({ name: "plan.pdf", drawing: true });
  expect(sources[1]).toMatchObject({ name: "other.pdf", drawing: false });
  expect(sources[2]).toMatchObject({ name: "old.pdf", drawing: false });
});

test("construction purpose preserves original filename and does not invent a drawing binding", () => {
  const original = {
    ...workspace,
    items: [{ machine: "evidence", record: { id: "user-original", metadata: {
      name: "LAYEX_For Bidding_Architecture_260911.pdf", mimeType: "application/pdf", documentPurpose: "construction",
    } } }],
  } as unknown as Workspace;
  expect(listPdfEvidenceSources(original)[0]).toMatchObject({
    name: "LAYEX_For Bidding_Architecture_260911.pdf", purpose: "construction", drawing: false,
  });
});
