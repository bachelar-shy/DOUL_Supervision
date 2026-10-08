import type { SupervisionClient } from "./supervision-client";
import type { DrawingImpactIncident } from "./ui-contract";

export async function listDrawingImpacts(client: SupervisionClient, projectId: string): Promise<DrawingImpactIncident[]> {
  if (client.session?.projectId !== projectId) throw new Error("현재 프로젝트가 일치하지 않습니다.");
  const result = await client.request<{ items: DrawingImpactIncident[] }>(client.path("/parallel/drawing-impacts"));
  return result.items;
}
