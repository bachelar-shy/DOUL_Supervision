import type {
  DomainRef,
  Fields,
  HumanRole,
  IssuePackageInput,
  IssuePackageResult,
  MediaAnalysisRequestInput,
  MediaAnalysisReview,
  RecordDTO,
  RegisterProjectionRow,
  Session,
  WorkItem,
  Workspace,
} from "./ui-contract";
import type { ScheduleSourceImportDetail, ScheduleSourceImportInput, ScheduleSourceImportResult, SupervisionClient, UploadOptions } from "./supervision-client";
import { createMockWorkspace } from "./mock-workspace";
import { registerProjectionCatalog } from "./register-projection-catalog.generated";

const previewOnly = () =>
  Promise.reject(
    new Error("화면 미리보기입니다. 실제 업무는 처리하지 않습니다."),
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

  async loginPassword(_username: string, _password: string): Promise<Session> {
    throw new Error("비밀번호 로그인은 실제 운영 API에서만 지원합니다.");
  }
  async logout(): Promise<void> { this.session = null; }

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

  requestMediaAnalysis(_input: MediaAnalysisRequestInput, _key?: string): Promise<RecordDTO> {
    return previewOnly();
  }

  mediaAnalysisReview(_runId: string): Promise<MediaAnalysisReview> {
    return previewOnly();
  }

  createMediaIssuePackage(
    _runId: string,
    _input: IssuePackageInput,
    _key?: string,
  ): Promise<IssuePackageResult> {
    return previewOnly();
  }

  importScheduleSource(
    _input: ScheduleSourceImportInput,
    _key?: string,
  ): Promise<ScheduleSourceImportResult> {
    return previewOnly();
  }

  scheduleSourceImportDetail(_objectId: string): Promise<ScheduleSourceImportDetail> {
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

  async drawingPdfContent(_bindingId: string): Promise<Blob> {
    throw new Error("화면 미리보기에서는 도면 PDF 원본 연결을 제공하지 않습니다.");
  }

  async evidenceContent(evidenceId: string): Promise<Blob> {
    if (!evidenceId.startsWith("EVD-UI-")) {
      throw new Error("화면 미리보기에서 찾을 수 없는 증빙입니다.");
    }
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">
        <rect width="1200" height="800" fill="#f3f5f7"/>
        <rect x="120" y="120" width="960" height="560" fill="#ffffff" stroke="#cbd5e1" stroke-width="3"/>
        <path d="M210 560 L410 350 L560 490 L720 300 L990 560" fill="none" stroke="#64748b" stroke-width="14"/>
        <circle cx="845" cy="260" r="56" fill="#cbd5e1"/>
        <text x="160" y="185" font-family="sans-serif" font-size="34" fill="#0f172a">DOUL Evidence UI Preview</text>
        <text x="160" y="635" font-family="monospace" font-size="24" fill="#64748b">${evidenceId}</text>
      </svg>`;
    return new Blob([svg], { type: "image/svg+xml" });
  }

  path(suffix: string) {
    return `/projects/UI-MOCK${suffix}`;
  }

  async request<T>(_path: string, _init: RequestInit = {}): Promise<T> {
    if (_path.endsWith("/roles")) return [] as T;
    const registerMatch = _path.match(/\/registers\/(\d{2})$/);
    if (registerMatch) {
      const definition = registerProjectionCatalog.find(
        (item) => item.id === registerMatch[1],
      );
      if (!definition) return [] as T;
      const source = definition.sources[0];
      const calculated = Object.fromEntries(
        definition.calculatedFields.map((field) => [field, null]),
      );
      const rows: RegisterProjectionRow[] = [
        {
          sourceDomainRefs: [
            {
              objectType: source.objectType,
              objectId: `REG-${definition.id}-UI-MOCK`,
              version: 1,
            },
          ],
          data: {
            id: `REG-${definition.id}-UI-MOCK`,
            projectId: "UI-MOCK",
            version: 1,
            status: "preview",
            title: `${definition.name} 예시 기록`,
            subtype: source.subtype ?? undefined,
            discipline: "ARCH",
            locationId: "L02-ZONE-A",
            packageId: "PKG-UI-MOCK",
          },
          calculated,
          unavailableFields: [...definition.calculatedFields],
        },
      ];
      return rows as T;
    }
    throw new Error("화면 미리보기에서 지원하지 않는 조회입니다.");
  }
}
