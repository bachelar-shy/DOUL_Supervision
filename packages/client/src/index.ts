export type HumanRole = "SUP" | "CON" | "OWN" | "DES" | "ADM";
export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };
export type Fields = Record<string, Json>;
export interface DomainRef {
  objectType: string;
  objectId: string;
  version: number;
}
export interface RecordDTO {
  id: string;
  projectId: string;
  version: number;
  status?: string;
  title?: string;
  workName?: string;
  description?: string;
  subtype?: string;
  evidenceIds?: string[];
  nextWorkAllowed?: boolean;
  holdPoint?: boolean;
  resultStatus?: string;
  correctionCycle?: number;
  fileId?: string;
  fileHash?: string;
  sourceType?: string;
  mediaType?: string;
  locationId?: string;
  packageId?: string;
  discipline?: string;
  responsibleOrganizationId?: string;
  drawingRef?: DomainRef;
  requirementRefs?: DomainRef[];
  inspectionIds?: string[];
  actionIds?: string[];
  report?: {
    facts?: string;
    cause?: string;
    recommendation?: string;
    priority?: string;
    [key: string]: unknown;
  };
  data?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}
export interface Failure {
  code: string;
  message: string;
  currentVersion?: number;
  failedGuards: string[];
}
export interface CommandDescriptor {
  command: string;
  to: string;
  fields: string[];
  authority: string;
  requiresInput: boolean;
  ready: boolean;
  blockedReason?: Failure | null;
  expectedVersion: number;
  requiresEvidence: unknown;
}
export interface WorkItem {
  machine: string;
  record: RecordDTO;
  actions: CommandDescriptor[];
}
export interface IssueCaseReadiness {
  stage: string;
  correctionCycle: number;
  currentActionIds: string[];
  correctionSubmitted: boolean;
  correctionVerified: boolean;
  currentReinspectionId: string | null;
  reinspectionPassed: boolean;
  closeReady: boolean;
  closeBlockedReasons: string[];
  closeoutReportIds: string[];
  ownerReportDraftReady: boolean;
  ownerReportIssuePending: boolean;
  ownerReceiptPending: boolean;
  ownerReceiptConfirmed: boolean;
  ownerReportingComplete: boolean;
}
export interface InspectionIssueCase {
  issue: WorkItem;
  observations: WorkItem[];
  correctiveActions: WorkItem[];
  inspections: WorkItem[];
  ownerReports: WorkItem[];
  readiness: IssueCaseReadiness;
  currentCorrectionCycle: number;
}
export interface InspectionCase {
  caseId: string;
  requestedInspectionId: string;
  projectId: string;
  rootInspection: WorkItem;
  issues: InspectionIssueCase[];
  ownerReports: WorkItem[];
  readiness: {
    openIssueIds: string[];
    ownerReportingPendingIssueIds: string[];
    complete: boolean;
  };
  timeline: {
    id: string;
    command: string;
    at: string;
    beforeState: string;
    afterState: string;
    objectRef: DomainRef;
    [key: string]: unknown;
  }[];
}
export interface IssuePackageInput {
  issueObjectId: string;
  actionObjectId: string;
  observationIds: string[];
  subtype: string;
  title: string;
  actionTitle: string;
  responsiblePartyId: string;
  dueAt: string;
}
export interface IssuePackageResult {
  issue: RecordDTO;
  correctiveAction: RecordDTO;
}
export interface ReinspectionRequestInput {
  reinspectionObjectId: string;
  workName: string;
  requestedInspectionAt: string;
  selfInspectionComplete: true;
  precheck: {
    drawing: boolean;
    material: boolean;
    test: boolean;
    previous: boolean;
    change: boolean;
  };
  evidenceIds: string[];
}
export interface ReinspectionRequestResult {
  issue: RecordDTO;
  reinspection: RecordDTO;
}
export interface OwnerReportDraftInput {
  reportObjectId: string;
  title: string;
  revision: string;
  type: "regular" | "urgent";
  priority: "P1" | "P2" | "P3" | "P4";
  recipientIds: string[];
  facts: string;
  cause?: string;
  impact: Record<string, unknown>;
  immediateActions?: string;
  recommendation: string;
  dueAt: string;
  receiptDueAt: string;
}
export interface OwnerReportDraftResult {
  report: RecordDTO;
}
export type MediaAnalysisMode =
  | "photo"
  | "keyframes"
  | "adaptive"
  | "every_frame"
  | "audio";
export type MediaAnalysisLanguage = "ko" | "vi" | "en" | "auto";
export interface MediaAnalysisRequestInput {
  clientObjectId: string;
  sourceEvidenceIds: string[];
  mode: MediaAnalysisMode;
  languages: MediaAnalysisLanguage[];
  inspectionId?: string;
  retryOfId?: string;
}
export interface MediaIssueReadiness {
  ready: boolean;
  confirmedObservationIds: string[];
  issueEligibleObservationIds: string[];
  blockedReasons: string[];
}
export interface MediaAnalysisReview {
  run: WorkItem;
  sources: RecordDTO[];
  candidates: WorkItem[];
  targetInspection: WorkItem | null;
  issueReadiness: MediaIssueReadiness;
  transcripts: Record<string, unknown>[];
  frames: Record<string, unknown>[];
  photoResults: Record<string, unknown>[];
  coverage: Record<string, unknown>;
}
export interface Scope {
  discipline: string;
  packageId: string;
  locationId: string;
  responsibleOrganizationId: string;
  minimumQualificationRank: number;
}
export interface Actor {
  partyId: string;
  roleAssignmentId: string;
  name: string;
  actorGroup: HumanRole;
}
export interface Session {
  accessToken: string;
  projectId: string;
  actor: Actor;
  mode: string;
}
export interface FormSchema {
  scalar_fields: Record<string, { type: string; required: boolean }>;
  tables: { path: string; type: string; columns: string[] }[];
  signature_roles: string[];
}
export interface Workspace {
  project: { id: string; name: string };
  role: { id: string; actorGroup: HumanRole; roleCode: string };
  items: WorkItem[];
  audit: { id: string; command: string; at: string; afterState: string }[];
  context: {
    projectId: string;
    scope: Scope;
    requirementRef: DomainRef;
    drawingRef: DomainRef;
    evidenceId: string;
  };
  participants: { partyId: string; name: string; actorGroup: HumanRole }[];
  formSchemas: Record<string, FormSchema>;
  demo: boolean;
}
export const collections: Record<string, string> = {
  inspection: "inspections",
  observation: "observations",
  issue: "issues",
  action: "actions",
  rfi: "rfis",
  change: "changes",
  approval: "approvals",
  report: "owner-reports",
  decision: "owner-decisions",
  analysis_run: "analysis-runs",
};
export class ApiError extends Error {
  detail: Failure;
  status: number;
  constructor(detail: Failure, status: number) {
    super(detail.message);
    this.detail = detail;
    this.status = status;
  }
}
export class ApiClient {
  session: Session | null = null;
  private loginGeneration = 0;
  baseUrl: string;
  constructor(baseUrl = "/api") {
    this.baseUrl = baseUrl;
  }
  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    if (this.session) {
      headers.set("Authorization", `Bearer ${this.session.accessToken}`);
      headers.set("X-RoleAssignment-Id", this.session.actor.roleAssignmentId);
    }
    if (typeof init.body === "string")
      headers.set("Content-Type", "application/json");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(this.baseUrl.replace(/\/$/, "") + path, {
        ...init,
        headers,
        signal: init.signal || controller.signal,
      });
      if (!response.ok) {
        const detail = await response
          .json()
          .catch(() => ({
            code: "HTTP_ERROR",
            message: response.statusText,
            failedGuards: [],
          }));
        throw new ApiError(detail, response.status);
      }
      return (await response.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }
  async login(actorGroup: HumanRole): Promise<Session> {
    const generation = ++this.loginGeneration;
    const session = await this.request<Session>("/dev/sessions", {
      method: "POST",
      body: JSON.stringify({ actorGroup }),
    });
    if (generation === this.loginGeneration) this.session = session;
    return session;
  }
  path(suffix: string): string {
    if (!this.session) throw new Error("로그인이 필요합니다.");
    return `/projects/${this.session.projectId}${suffix}`;
  }
  workspace(): Promise<Workspace> {
    return this.request(this.path("/workspace"));
  }
  requestMediaAnalysis(
    input: MediaAnalysisRequestInput,
    key = newKey(),
  ): Promise<RecordDTO> {
    return this.request(this.path("/media-analysis-runs"), {
      method: "POST",
      headers: { "Idempotency-Key": key },
      body: JSON.stringify({
        roleAssignmentId: this.session!.actor.roleAssignmentId,
        ...input,
      }),
    });
  }
  mediaAnalysisReview(runId: string): Promise<MediaAnalysisReview> {
    return this.request(this.path(`/media-analysis-runs/${runId}`));
  }
  createMediaIssuePackage(
    runId: string,
    input: IssuePackageInput,
    key = newKey(),
  ): Promise<IssuePackageResult> {
    return this.request(this.path(`/media-analysis-runs/${runId}/issues`), {
      method: "POST",
      headers: { "Idempotency-Key": key },
      body: JSON.stringify({
        roleAssignmentId: this.session!.actor.roleAssignmentId,
        ...input,
      }),
    });
  }
  inspectionCase(inspectionId: string): Promise<InspectionCase> {
    return this.request(this.path(`/inspection-cases/${inspectionId}`));
  }
  createIssuePackage(
    inspectionId: string,
    input: IssuePackageInput,
    key = newKey(),
  ): Promise<IssuePackageResult> {
    return this.request(this.path(`/inspection-cases/${inspectionId}/issues`), {
      method: "POST",
      headers: { "Idempotency-Key": key },
      body: JSON.stringify({
        roleAssignmentId: this.session!.actor.roleAssignmentId,
        ...input,
      }),
    });
  }
  requestReinspection(
    inspectionId: string,
    issueId: string,
    input: ReinspectionRequestInput,
    key = newKey(),
  ): Promise<ReinspectionRequestResult> {
    return this.request(
      this.path(
        `/inspection-cases/${inspectionId}/issues/${issueId}/reinspections`,
      ),
      {
        method: "POST",
        headers: { "Idempotency-Key": key },
        body: JSON.stringify({
          roleAssignmentId: this.session!.actor.roleAssignmentId,
          ...input,
        }),
      },
    );
  }
  createCaseOwnerReport(
    inspectionId: string,
    issueId: string,
    input: OwnerReportDraftInput,
    key = newKey(),
  ): Promise<OwnerReportDraftResult> {
    return this.request(
      this.path(
        `/inspection-cases/${inspectionId}/issues/${issueId}/owner-reports`,
      ),
      {
        method: "POST",
        headers: { "Idempotency-Key": key },
        body: JSON.stringify({
          roleAssignmentId: this.session!.actor.roleAssignmentId,
          ...input,
        }),
      },
    );
  }
  execute(
    item: WorkItem,
    command: string,
    payload: Fields = {},
    evidenceIds?: string[],
    key?: string,
  ) {
    if (!this.session) throw new Error("로그인이 필요합니다.");
    return this.request<{ record: RecordDTO }>(
      this.path(
        `/${collections[item.machine]}/${item.record.id}/${command.replace(/_/g, "-")}`,
      ),
      {
        method: "POST",
        headers: { "Idempotency-Key": key || newKey() },
        body: JSON.stringify({
          roleAssignmentId: this.session.actor.roleAssignmentId,
          expectedVersion: item.record.version,
          payload,
          evidenceIds: evidenceIds ?? item.record.evidenceIds ?? [],
        }),
      },
    );
  }
  create(
    machine: string,
    payload: object,
    clientObjectId = newKey(),
    key = newKey(),
  ) {
    return this.request<{ record: RecordDTO }>(
      this.path(`/${collections[machine]}`),
      {
        method: "POST",
        headers: { "Idempotency-Key": key },
        body: JSON.stringify({
          roleAssignmentId: this.session!.actor.roleAssignmentId,
          clientObjectId,
          payload,
        }),
      },
    );
  }
  async upload(
    bytes: Uint8Array,
    options: {
      name: string;
      mime: string;
      hash: string;
      scope: Scope;
      sourcePartyId: string;
      captureId?: string;
      capturedAt?: string;
    },
    progress?: (offset: number, total: number) => void,
  ): Promise<RecordDTO> {
    const captureId = options.captureId || newKey();
    const mediaType = options.mime.startsWith("image/")
      ? "photo"
      : options.mime.startsWith("video/")
        ? "video"
        : options.mime.startsWith("audio/")
          ? "audio"
          : "document";
    const body = {
      roleAssignmentId: this.session!.actor.roleAssignmentId,
      captureId,
      fileName: options.name,
      mimeType: options.mime,
      byteCount: bytes.length,
      expectedHash: options.hash,
      sourcePartyId: options.sourcePartyId,
      mediaType,
      discipline: options.scope.discipline,
      packageId: options.scope.packageId,
      locationId: options.scope.locationId,
      ...(options.capturedAt ? { capturedAt: options.capturedAt } : {}),
    };
    const upload = await this.request<{ id: string; offset: number }>(
      this.path("/uploads"),
      {
        method: "POST",
        headers: { "Idempotency-Key": captureId },
        body: JSON.stringify(body),
      },
    );
    let offset = upload.offset;
    while (offset < bytes.length) {
      const part = bytes.slice(offset, offset + 1024 * 1024);
      const next = await this.request<{ offset: number }>(
        this.path(`/uploads/${upload.id}/chunks`),
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/octet-stream",
            "Upload-Offset": String(offset),
            "Idempotency-Key": `${captureId}-${offset}`,
          },
          body: part.buffer as ArrayBuffer,
        },
      );
      offset = next.offset;
      progress?.(offset, bytes.length);
    }
    return this.request(this.path(`/uploads/${upload.id}/complete`), {
      method: "POST",
      headers: { "Idempotency-Key": `${captureId}-complete` },
      body: JSON.stringify({
        roleAssignmentId: this.session!.actor.roleAssignmentId,
        expectedHash: options.hash,
      }),
    });
  }
  render(
    formId: string,
    sourceDomainRefs: DomainRef[],
    data: object,
    final = false,
    language = "ko",
  ) {
    return this.request<RecordDTO>(
      this.path(`/forms/${formId}/${final ? "render" : "preview"}`),
      {
        method: "POST",
        headers: { "Idempotency-Key": newKey() },
        body: JSON.stringify({
          roleAssignmentId: this.session!.actor.roleAssignmentId,
          sourceDomainRefs,
          data,
          language,
          output: "html_a4",
        }),
      },
    );
  }
  async documentHtml(documentId: string): Promise<string> {
    const response = await fetch(
      this.baseUrl + this.path(`/documents/${documentId}/content`),
      {
        headers: {
          Authorization: `Bearer ${this.session!.accessToken}`,
          "X-RoleAssignment-Id": this.session!.actor.roleAssignmentId,
        },
      },
    );
    if (!response.ok) throw new Error("문서를 가져오지 못했습니다.");
    return response.text();
  }
}
/** Native callers should install Expo Crypto's global crypto polyfill if needed. */
let suppliedKeyFactory: (() => string) | undefined;
export function configureKeyFactory(factory: () => string) {
  suppliedKeyFactory = factory;
}
export function newKey(): string {
  if (suppliedKeyFactory) return suppliedKeyFactory();
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  throw new Error("Secure random UUID provider is required.");
}
export interface DraftCommand {
  id: string;
  projectId: string;
  roleAssignmentId: string;
  objectId: string;
  expectedVersion: number;
  command: string;
  payload: Fields;
  state: "pending_review" | "conflict";
}
export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}
/** No implicit execution. A person must review/re-submit pending or conflicting work. */
export class CommandOutbox {
  private storage: KeyValueStore;
  private namespace: string;
  constructor(storage: KeyValueStore, namespace: string) {
    this.storage = storage;
    this.namespace = namespace;
  }
  async list(): Promise<DraftCommand[]> {
    return JSON.parse(
      (await this.storage.getItem(this.namespace)) || "[]",
    ) as DraftCommand[];
  }
  async stage(command: DraftCommand) {
    const all = await this.list();
    await this.storage.setItem(
      this.namespace,
      JSON.stringify([...all.filter((x) => x.id !== command.id), command]),
    );
  }
  async conflict(id: string) {
    const all = await this.list();
    await this.storage.setItem(
      this.namespace,
      JSON.stringify(
        all.map((x) => (x.id === id ? { ...x, state: "conflict" } : x)),
      ),
    );
  }
}
