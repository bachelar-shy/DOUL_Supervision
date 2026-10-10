import { ApiClient, ApiError, newKey } from "@doul/client";
import type {
  DomainRef,
  Fields,
  HumanRole,
  IssuePackageInput,
  IssuePackageResult,
  MediaAnalysisRequestInput,
  MediaAnalysisReview,
  RecordDTO,
  Scope,
  Session,
  WorkItem,
  Workspace,
} from "./ui-contract";
import { MockSupervisionClient } from "./mock-supervision-client";

export { ApiError };

const workflowCollections: Record<string, string> = {
  schedule_baseline: "schedule-baselines",
  schedule_progress: "schedule-progress-updates",
  delay_event: "delay-events",
  recovery_plan: "recovery-plans",
  safety_permit: "safety-permits",
  safety_stop_order: "safety-stop-orders",
  safety_equipment_inspection: "safety-equipment-inspections",
  contract_notice: "contract-notices",
  claim: "claims",
  eot_request: "eot-requests",
  contract_boq: "contract-boqs",
  quantity_measurement: "quantity-measurements",
  payment_claim: "payment-claims",
  commissioning_package: "commissioning-packages",
  handover_package: "handover-packages",
  warranty_claim: "warranty-claims",
};

export interface UploadOptions {
  name: string;
  mime: string;
  hash: string;
  scope: Scope;
  sourcePartyId: string;
  captureId?: string;
  capturedAt?: string;
}

export interface NormalizedScheduleSourceActivity {
  data: Record<string, unknown>;
  predecessorActivityIds?: string[];
  successorActivityIds?: string[];
}

export interface NormalizedScheduleSource {
  schedule: Record<string, unknown>;
  activities: NormalizedScheduleSourceActivity[];
  criticalActivityId: string;
}

export interface ScheduleSourceImportInput {
  clientObjectId: string;
  scope: Omit<Scope, "minimumQualificationRank">;
  title: string;
  sourceEvidenceRef: DomainRef;
  inputMode: string;
  parserVersion: string;
  schedule: Record<string, unknown>;
  activities: Array<NormalizedScheduleSourceActivity & { clientObjectId: string }>;
  criticalActivityId: string;
}

export interface ScheduleSourceImportResult {
  record: RecordDTO;
  sourceScheduleRef: DomainRef;
  activityRefs: DomainRef[];
}

export interface ScheduleSourceImportDetail {
  record: RecordDTO;
  activities: RecordDTO[];
  sourceScheduleRef: DomainRef;
  activityRefs: DomainRef[];
}

export interface SupervisionClient {
  readonly kind: "http" | "mock";
  readonly session: Session | null;
  login(role: HumanRole): Promise<Session>;
  workspace(): Promise<Workspace>;
  execute(
    item: WorkItem,
    command: string,
    payload?: Fields,
    evidenceIds?: string[],
    key?: string,
  ): Promise<{ record: RecordDTO }>;
  create(
    machine: string,
    payload: object,
    clientObjectId?: string,
    key?: string,
  ): Promise<{ record: RecordDTO }>;
  upload(
    bytes: Uint8Array,
    options: UploadOptions,
    progress?: (offset: number, total: number) => void,
  ): Promise<RecordDTO>;
  requestMediaAnalysis(input: MediaAnalysisRequestInput): Promise<RecordDTO>;
  mediaAnalysisReview(runId: string): Promise<MediaAnalysisReview>;
  createMediaIssuePackage(
    runId: string,
    input: Omit<IssuePackageInput, "issueObjectId" | "actionObjectId">,
  ): Promise<IssuePackageResult>;
  importScheduleSource(
    input: ScheduleSourceImportInput,
    key?: string,
  ): Promise<ScheduleSourceImportResult>;
  scheduleSourceImportDetail(objectId: string): Promise<ScheduleSourceImportDetail>;
  render(
    formId: string,
    sourceDomainRefs: DomainRef[],
    data: object,
    final?: boolean,
    language?: string,
    key?: string,
  ): Promise<RecordDTO>;
  documentHtml(documentId: string): Promise<string>;
  evidenceContent(evidenceId: string): Promise<Blob>;
  drawingPdfContent(bindingId: string): Promise<Blob>;
  path(suffix: string): string;
  request<T>(path: string, init?: RequestInit): Promise<T>;
}

class HttpSupervisionClient implements SupervisionClient {
  readonly kind = "http" as const;
  private readonly client: ApiClient;
  private readonly baseUrl: string;

  constructor(baseUrl = "/api") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.client = new ApiClient(baseUrl);
  }

  get session() {
    return this.client.session;
  }

  login(role: HumanRole) {
    return this.client.login(role);
  }

  workspace() {
    return this.client.workspace();
  }

  execute(
    item: WorkItem,
    command: string,
    payload: Fields = {},
    evidenceIds?: string[],
    key?: string,
  ) {
    const collection = workflowCollections[item.machine];
    if (!collection) {
      return this.client.execute(item, command, payload, evidenceIds, key);
    }
    const session = this.client.session;
    if (!session) throw new Error("로그인이 필요합니다.");
    return this.client.request<{ record: RecordDTO }>(
      this.client.path(
        `/${collection}/${item.record.id}/${command.replace(/_/g, "-")}`,
      ),
      {
        method: "POST",
        headers: { "Idempotency-Key": key || newKey() },
        body: JSON.stringify({
          roleAssignmentId: session.actor.roleAssignmentId,
          expectedVersion: item.record.version,
          payload,
          evidenceIds: evidenceIds ?? [],
        }),
      },
    );
  }

  create(machine: string, payload: object, clientObjectId?: string, key?: string) {
    const collection = workflowCollections[machine];
    if (!collection) return this.client.create(machine, payload, clientObjectId, key);
    const session = this.client.session;
    if (!session) throw new Error("로그인이 필요합니다.");
    return this.client.request<{ record: RecordDTO }>(this.client.path(`/${collection}`), {
      method: "POST",
      headers: { "Idempotency-Key": key || newKey() },
      body: JSON.stringify({ roleAssignmentId: session.actor.roleAssignmentId,
        clientObjectId: clientObjectId || newKey(), payload }),
    });
  }

  upload(
    bytes: Uint8Array,
    options: UploadOptions,
    progress?: (offset: number, total: number) => void,
  ) {
    return this.client.upload(bytes, options, progress);
  }

  requestMediaAnalysis(input: MediaAnalysisRequestInput) {
    return this.client.requestMediaAnalysis(input);
  }

  mediaAnalysisReview(runId: string) {
    return this.client.mediaAnalysisReview(runId);
  }

  createMediaIssuePackage(
    runId: string,
    input: Omit<IssuePackageInput, "issueObjectId" | "actionObjectId">,
  ) {
    return this.client.createMediaIssuePackage(runId, {
      ...input,
      issueObjectId: newKey(),
      actionObjectId: newKey(),
    });
  }

  importScheduleSource(input: ScheduleSourceImportInput, key?: string) {
    const session = this.client.session;
    if (!session) throw new Error("로그인이 필요합니다.");
    return this.client.request<ScheduleSourceImportResult>(
      this.client.path("/schedule-source-imports"),
      {
        method: "POST",
        headers: { "Idempotency-Key": key || newKey() },
        body: JSON.stringify({
          roleAssignmentId: session.actor.roleAssignmentId,
          ...input,
        }),
      },
    );
  }

  scheduleSourceImportDetail(objectId: string) {
    return this.client.request<ScheduleSourceImportDetail>(
      this.client.path(`/schedule-source-imports/${objectId}`),
    );
  }

  render(
    formId: string,
    sourceDomainRefs: DomainRef[],
    data: object,
    final = false,
    language = "ko",
    key?: string,
  ) {
    return this.client.render(formId, sourceDomainRefs, data, final, language, key);
  }

  documentHtml(documentId: string) {
    return this.client.documentHtml(documentId);
  }

  async evidenceContent(evidenceId: string) {
    const session = this.client.session;
    if (!session) throw new Error("로그인이 필요합니다.");
    const response = await fetch(
      this.baseUrl + this.client.path(`/evidence/${evidenceId}/content`),
      {
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          "X-RoleAssignment-Id": session.actor.roleAssignmentId,
        },
      },
    );
    if (!response.ok) {
      throw new Error(`증빙 원본을 불러오지 못했습니다. (${response.status})`);
    }
    return response.blob();
  }

  async drawingPdfContent(bindingId: string): Promise<Blob> {
    const session = this.client.session;
    if (!session) throw new Error("로그인이 필요합니다.");
    const response = await fetch(
      this.baseUrl + this.client.path(`/parallel/drawing-pdf-bindings/${encodeURIComponent(bindingId)}/content`),
      {
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          "X-RoleAssignment-Id": session.actor.roleAssignmentId,
        },
        signal: AbortSignal.timeout(30000),
      },
    );
    if (!response.ok) throw new Error(`연결된 PDF 원본을 불러오지 못했습니다. (${response.status})`);
    const blob = await response.blob();
    if (blob.size > 20 * 1024 * 1024 || blob.type !== "application/pdf") {
      throw new Error("연결된 원본의 PDF 형식 또는 20 MiB 제한을 확인하십시오.");
    }
    return blob;
  }

  path(suffix: string) {
    return this.client.path(suffix);
  }

  request<T>(path: string, init: RequestInit = {}) {
    return this.client.request<T>(path, init);
  }
}

export function createSupervisionClient(): SupervisionClient {
  if (
    import.meta.env.MODE === "ui-mock" ||
    import.meta.env.VITE_SUPERVISION_ADAPTER === "mock"
  ) {
    return new MockSupervisionClient();
  }
  return new HttpSupervisionClient("/api");
}
