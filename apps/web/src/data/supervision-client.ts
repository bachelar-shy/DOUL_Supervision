import { ApiClient, ApiError } from "@doul/client";
import type {
  DomainRef,
  Fields,
  HumanRole,
  RecordDTO,
  Scope,
  Session,
  WorkItem,
  Workspace,
} from "./ui-contract";
import { MockSupervisionClient } from "./mock-supervision-client";

export { ApiError };

export interface UploadOptions {
  name: string;
  mime: string;
  hash: string;
  scope: Scope;
  sourcePartyId: string;
  captureId?: string;
  capturedAt?: string;
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
  render(
    formId: string,
    sourceDomainRefs: DomainRef[],
    data: object,
    final?: boolean,
    language?: string,
  ): Promise<RecordDTO>;
  documentHtml(documentId: string): Promise<string>;
  evidenceContent(evidenceId: string): Promise<Blob>;
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
    return this.client.execute(item, command, payload, evidenceIds, key);
  }

  create(machine: string, payload: object, clientObjectId?: string, key?: string) {
    return this.client.create(machine, payload, clientObjectId, key);
  }

  upload(
    bytes: Uint8Array,
    options: UploadOptions,
    progress?: (offset: number, total: number) => void,
  ) {
    return this.client.upload(bytes, options, progress);
  }

  render(
    formId: string,
    sourceDomainRefs: DomainRef[],
    data: object,
    final = false,
    language = "ko",
  ) {
    return this.client.render(formId, sourceDomainRefs, data, final, language);
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
