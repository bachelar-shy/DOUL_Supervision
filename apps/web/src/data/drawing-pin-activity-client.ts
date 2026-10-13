import type { SupervisionClient } from "./supervision-client";
import type { DrawingPinKind } from "./drawing-sheet-client";

export interface DrawingPinActivity {
  pinId: string; sheetId: string; kind: DrawingPinKind;
  comment: string; x: number; y: number; status: "draft" | "linked";
  recordRef: {objectType:string;objectId:string;version:number} | null;
  createdAt: string; lastActivityAt: string;
  replyCount: number; latestReply: string | null;
  sheetNumber: string; sheetTitle: string; sheetRevision: string;
}
export type DrawingPinIndex = {items: DrawingPinActivity[]; count:number};
export function loadDrawingPinIndex(client: SupervisionClient) {
  return client.request<DrawingPinIndex>(client.path("/drawing-sheets/pin-index"));
}
