import type {
  DomainRef,
  Fields,
  HumanRole,
  RecordDTO,
  Session,
  WorkItem,
  Workspace,
} from "./ui-contract";
import type { SupervisionClient, UploadOptions } from "./supervision-client";
import { createMockWorkspace } from "./mock-workspace";

const previewOnly = () =>
  Promise.reject(
    new Error("UI Mock Preview입니다. 실제 업무 명령은 실행하지 않습니다."),
  );

export class MockSupervisionClient implements SupervisionClient {
  readonly kind = "mock" as const;
  session: Session | null = null;
  private role: HumanRole = "SUP";

  async login(role: HumanRole): Promise<Session> {
    this.role = role;
    this.session = {
      accessToken: "ui-mock-preview",
      projectId: "UI-MOCK",
      actor: {
        partyId: `P-${role}`,
        roleAssignmentId: `ROLE-${role}`,
        name: `${role} UI Preview`,
        actorGroup: role,
      },
      mode: "ui-mock-preview",
    };
    return this.session;
  }

  async workspace(): Promise<Workspace> {
    return createMockWorkspace(this.role);
  }

  execute(
    _item: WorkItem,
    _command: string,
    _payload: Fields = {},
    _evidenceIds?: string[],
    _key?: string,
  ): Promise<{ record: RecordDTO }> {
    return previewOnly();
  }

  create(
    _machine: string,
    _payload: object,
    _clientObjectId?: string,
    _key?: string,
  ): Promise<{ record: RecordDTO }> {
    return previewOnly();
  }

  upload(
    _bytes: Uint8Array,
    _options: UploadOptions,
    _progress?: (offset: number, total: number) => void,
  ): Promise<RecordDTO> {
    return previewOnly();
  }

  render(
    _formId: string,
    _sourceDomainRefs: DomainRef[],
    _data: object,
    _final = false,
    _language = "ko",
  ): Promise<RecordDTO> {
    return previewOnly();
  }

  documentHtml(_documentId: string): Promise<string> {
    return previewOnly();
  }

  path(suffix: string) {
    return `/projects/UI-MOCK${suffix}`;
  }

  async request<T>(_path: string, _init: RequestInit = {}): Promise<T> {
    if (_path.endsWith("/roles")) return [] as T;
    throw new Error("UI Mock Preview에서 지원하지 않는 조회입니다.");
  }
}
