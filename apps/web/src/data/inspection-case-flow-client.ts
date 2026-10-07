import type { InspectionCase } from "@doul/client";
import type { SupervisionClient } from "./supervision-client";

/** Read the server-built, explicitly linked inspection case graph. */
export function getInspectionCase(client: SupervisionClient, inspectionId: string): Promise<InspectionCase> {
  return client.request<InspectionCase>(client.path(`/inspection-cases/${encodeURIComponent(inspectionId)}`));
}
