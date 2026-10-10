import type { SupervisionClient } from "./supervision-client";
import type { DrawingImpactHistory, DrawingImpactIncident } from "./ui-contract";

export async function listDrawingImpacts(client: SupervisionClient, projectId: string): Promise<DrawingImpactIncident[]> {
  if (client.session?.projectId !== projectId) throw new Error("현재 현장이 일치하지 않습니다.");
  const result = await client.request<{ items: DrawingImpactIncident[] }>(client.path("/parallel/drawing-impacts"));
  return result.items;
}

export async function listDrawingImpactHistory(client: SupervisionClient, projectId: string): Promise<DrawingImpactHistory[]> {
  if (client.session?.projectId !== projectId) throw new Error("현재 현장이 일치하지 않습니다.");
  const result = await client.request<{ items: DrawingImpactHistory[] }>(client.path("/parallel/drawing-impacts/history"));
  return result.items;
}
