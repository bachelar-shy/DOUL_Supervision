import type { HumanRole, Workspace } from "./ui-contract";

const scope = {
  discipline: "ARCH",
  packageId: "PKG-UI-MOCK",
  locationId: "L02-ZONE-A",
  responsibleOrganizationId: "ORG-CON",
  minimumQualificationRank: 1,
};

export function createMockWorkspace(role: HumanRole): Workspace {
  return {
    project: { id: "UI-MOCK", name: "DOUL UI Preview Project" },
    role: {
      id: "ROLE-UI-MOCK",
      actorGroup: role,
      roleCode: role,
    },
    context: {
      projectId: "UI-MOCK",
      scope,
      requirementRef: {
        objectType: "Requirement",
        objectId: "REQ-UI-001",
        version: 1,
      },
      drawingRef: {
        objectType: "Drawing",
        objectId: "DWG-A-201",
        version: 3,
      },
      evidenceId: "EVD-UI-001",
    },
    participants: [
      { partyId: "P-SUP", name: "감리 담당자", actorGroup: "SUP" },
      { partyId: "P-CON", name: "시공 담당자", actorGroup: "CON" },
      { partyId: "P-OWN", name: "발주처 담당자", actorGroup: "OWN" },
      { partyId: "P-DES", name: "설계 담당자", actorGroup: "DES" },
    ],
    formSchemas: {
      "FM-09": { scalar_fields: {}, tables: [], signature_roles: [] },
      "FM-12": { scalar_fields: {}, tables: [], signature_roles: [] },
      "FM-19": { scalar_fields: {}, tables: [], signature_roles: [] },
      "FM-20": { scalar_fields: {}, tables: [], signature_roles: [] },
      "FM-21": { scalar_fields: {}, tables: [], signature_roles: [] },
    },
    audit: [
      {
        id: "AUD-UI-001",
        command: "UI_PREVIEW",
        at: "2026-10-06T02:00:00+07:00",
        afterState: "preview",
      },
    ],
    items: [
      {
        machine: "inspection",
        record: {
          id: "INS-UI-001",
          projectId: "UI-MOCK",
          version: 4,
          status: "scheduled",
          workName: "경량벽체 은폐 전 검측",
          discipline: "ARCH",
          locationId: "L02-ZONE-A",
          evidenceIds: ["EVD-UI-001", "EVD-UI-002"],
          holdPoint: true,
          nextWorkAllowed: false,
        },
        actions: [],
      },
      {
        machine: "issue",
        record: {
          id: "ISS-UI-001",
          projectId: "UI-MOCK",
          version: 2,
          status: "corrective_action",
          title: "천장 내부 배관 간섭 확인",
          discipline: "MEP",
          locationId: "L03-ZONE-B",
          evidenceIds: ["EVD-UI-003"],
          correctionCycle: 1,
        },
        actions: [],
      },
      {
        machine: "observation",
        record: {
          id: "OBS-UI-001",
          projectId: "UI-MOCK",
          version: 1,
          status: "pending_review",
          title: "사진 분석 관찰 후보",
          discipline: "ARCH",
          locationId: "L01-LOBBY",
          evidenceIds: ["EVD-UI-004"],
        },
        actions: [],
      },
      {
        machine: "action",
        record: {
          id: "ACT-UI-001",
          projectId: "UI-MOCK",
          version: 3,
          status: "submitted",
          title: "NCR 시정조치 확인",
          locationId: "L03-ZONE-B",
          evidenceIds: ["EVD-UI-005"],
        },
        actions: [],
      },
      {
        machine: "report",
        record: {
          id: "RPT-UI-001",
          projectId: "UI-MOCK",
          version: 2,
          status: "issued",
          title: "주간 감리보고",
          report: {
            facts: "UI 검토용 Mock Data",
            recommendation: "발주처 결정 대기",
            priority: "high",
          },
        },
        actions: [],
      },
      {
        machine: "decision",
        record: {
          id: "DEC-UI-001",
          projectId: "UI-MOCK",
          version: 1,
          status: "requested",
          title: "마감재 변경 결정요청",
        },
        actions: [],
      },
      {
        machine: "rfi",
        record: {
          id: "RFI-UI-001",
          projectId: "UI-MOCK",
          version: 1,
          status: "submitted",
          title: "천장 상세 접합부 질의",
          locationId: "L02-ZONE-C",
        },
        actions: [],
      },
    ],
    demo: true,
  };
}
