import type { HumanRole, WorkItem, Workspace } from "./ui-contract";

const scope = {
  discipline: "ARCH",
  packageId: "PKG-UI-MOCK",
  locationId: "L02-ZONE-A",
  responsibleOrganizationId: "ORG-CON",
  minimumQualificationRank: 1,
};


function action(
  command: string,
  to: string,
  authority: string,
  fields: string[] = [],
  options: {
    ready?: boolean;
    requiresEvidence?: boolean;
    blockedCode?: string;
  } = {},
) {
  return {
    command,
    to,
    authority,
    fields,
    requiresEvidence: options.requiresEvidence ?? false,
    ready: options.ready ?? true,
    requiresInput: fields.length > 0,
    blockedReason: options.blockedCode
      ? {
          code: options.blockedCode,
          message: options.blockedCode,
          failedGuards: [options.blockedCode],
        }
      : null,
    expectedVersion: 1,
  };
}

function safetyPreviewItems(role: HumanRole): WorkItem[] {
  const readiness = {
    methodStatementCurrent: true,
    riskAssessmentCurrent: true,
    personnelQualified: true,
    equipmentReady: true,
    controlMeasuresReady: true,
    emergencyReady: true,
    environmentalConditionsReady: true,
    noBlockingSafetyIssue: true,
  };
  const resumeGate = {
    causeIdentified: true,
    correctiveActionComplete: true,
    correctiveEvidencePresent: true,
    issueActionsVerified: true,
    reinspectionPassed: true,
    permitValid: true,
    methodStatementCurrent: true,
    riskAssessmentCurrent: true,
    equipmentReady: true,
    personnelQualified: true,
    controlMeasuresReady: true,
    environmentalConditionsReady: false,
    reportingObligationsSatisfied: true,
  };

  return [
    {
      machine: "safety_permit",
      record: {
        id: "SP-UI-001",
        projectId: "UI-MOCK",
        version: 6,
        subtype: "SafetyPermit",
        status: "suspended",
        title: "화기작업 허가 · A동 2층",
        discipline: "ARCH",
        packageId: scope.packageId,
        locationId: scope.locationId,
        responsibleOrganizationId: scope.responsibleOrganizationId,
        evidenceIds: ["EVD-UI-001"],
        data: {
          permitNo: "PTW-UI-001",
          workType: "Hot Work",
          riskLevel: "high",
          workAuthorized: false,
          validFrom: "2026-10-06T08:00:00+07:00",
          validTo: "2026-10-06T22:00:00+07:00",
          readiness,
          blockedReasons: ["SAFETY_STOP_OPEN"],
          stopOrderRefs: [
            {
              objectType: "WorkItem",
              objectId: "STOP-UI-001",
              version: 4,
            },
          ],
          suspendedAt: "2026-10-06T13:10:00+07:00",
        },
      },
      actions:
        role === "CON"
          ? [
              action(
                "request_resume",
                "resume_review",
                "safety.resume.request",
                ["readiness", "blockedReasons"],
                {
                  ready: false,
                  requiresEvidence: true,
                  blockedCode: "STOP_RESUME_REQUEST_READY",
                },
              ),
            ]
          : [],
    },
    {
      machine: "safety_permit",
      record: {
        id: "SP-UI-002",
        projectId: "UI-MOCK",
        version: 8,
        subtype: "SafetyPermit",
        status: "resume_review",
        title: "고소작업 허가 · B동 외벽",
        discipline: "ARCH",
        packageId: scope.packageId,
        locationId: "L04-ZONE-B",
        responsibleOrganizationId: scope.responsibleOrganizationId,
        evidenceIds: ["EVD-UI-001"],
        data: {
          permitNo: "PTW-UI-002",
          workType: "Work at Height",
          riskLevel: "high",
          workAuthorized: false,
          validFrom: "2026-10-06T08:00:00+07:00",
          validTo: "2026-10-07T18:00:00+07:00",
          readiness,
          blockedReasons: [],
          stopOrderRefs: [],
          resumeRequestAt: "2026-10-06T14:20:00+07:00",
        },
      },
      actions:
        role === "SUP"
          ? [
              action(
                "approve_resume",
                "active",
                "safety.resume.approve",
                ["resumeApprovalRef", "readiness", "blockedReasons"],
                { requiresEvidence: true },
              ),
              action(
                "return_resume",
                "suspended",
                "safety.permit.review",
                ["reason", "blockedReasons"],
              ),
            ]
          : [],
    },
    {
      machine: "safety_stop_order",
      record: {
        id: "STOP-UI-001",
        projectId: "UI-MOCK",
        version: 4,
        subtype: "SafetyStopOrder",
        status: "verification",
        title: "추락방지시설 보완 작업중지",
        discipline: "ARCH",
        packageId: scope.packageId,
        locationId: scope.locationId,
        responsibleOrganizationId: scope.responsibleOrganizationId,
        evidenceIds: ["EVD-UI-001"],
        data: {
          stopOrderNo: "STOP-UI-001",
          stopScopeType: "permit",
          stopReason: "추락방지 난간 미설치",
          observedAt: "2026-10-06T13:05:00+07:00",
          effectiveAt: "2026-10-06T13:10:00+07:00",
          affectedPermitRefs: [
            {
              objectType: "WorkItem",
              objectId: "SP-UI-001",
              version: 6,
            },
          ],
          correctiveActionRefs: [
            { objectType: "Action", objectId: "ACT-UI-001", version: 3 },
          ],
          resumeVerificationRefs: [
            { objectType: "Inspection", objectId: "INS-UI-001", version: 4 },
          ],
          resumeRequestAt: "2026-10-06T14:10:00+07:00",
          resumeGate,
        },
      },
      actions:
        role === "SUP"
          ? [
              action("lift_stop", "lifted", "safety.stop_lift", [], {
                ready: false,
                requiresEvidence: true,
                blockedCode: "SAFETY_RESUME_GATE_SATISFIED",
              }),
            ]
          : [],
    },
    {
      machine: "safety_equipment_inspection",
      record: {
        id: "SEI-UI-001",
        projectId: "UI-MOCK",
        version: 3,
        subtype: "SafetyEquipmentInspection",
        status: "result_pending",
        title: "고소작업대 사용 전 안전검사",
        discipline: "ARCH",
        packageId: scope.packageId,
        locationId: scope.locationId,
        responsibleOrganizationId: scope.responsibleOrganizationId,
        evidenceIds: ["EVD-UI-001"],
        data: {
          inspectionKind: "pre-use",
          resultSummary: "점검 완료 · 판정 대기",
          equipmentAvailable: false,
          validFrom: "2026-10-06T09:00:00+07:00",
          validTo: "2026-11-06T09:00:00+07:00",
          certificateRefs: [],
          calibrationRefs: [],
          blockedReasons: [],
        },
      },
      actions:
        role === "SUP"
          ? [
              action("pass", "passed", "safety.equipment.judge", ["blockedReasons"], {
                requiresEvidence: true,
              }),
              action(
                "fail",
                "failed",
                "safety.equipment.judge",
                ["failureReason", "blockedReasons"],
                { requiresEvidence: true },
              ),
              action(
                "restrict",
                "restricted",
                "safety.equipment.judge",
                ["restrictionConditions", "blockedReasons"],
                { requiresEvidence: true },
              ),
            ]
          : [],
    },
  ];
}

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
      ...safetyPreviewItems(role),
      {
        machine: "evidence",
        record: {
          id: "EVD-UI-001",
          projectId: "UI-MOCK",
          version: 1,
          sourceType: "original",
          mediaType: "photo",
          fileId: "FILE-EVD-UI-001",
          fileHash:
            "1111111111111111111111111111111111111111111111111111111111111111",
          sourcePartyId: "P-CON",
          submittedBy: "P-CON",
          capturedAt: "2026-10-06T01:42:00+07:00",
          uploadedAt: "2026-10-06T01:45:00+07:00",
          createdAt: "2026-10-06T01:45:00+07:00",
          updatedAt: "2026-10-06T01:45:00+07:00",
          createdBy: "P-CON",
          discipline: "ARCH",
          packageId: scope.packageId,
          locationId: scope.locationId,
          responsibleOrganizationId: scope.responsibleOrganizationId,
          metadata: {
            name: "2F_WALL_INSPECTION_001.jpg",
            mimeType: "image/svg+xml",
            byteCount: 2481200,
            captureMethod: "device_camera",
          },
        },
        actions: [],
      },
      {
        machine: "evidence",
        record: {
          id: "EVD-UI-002",
          projectId: "UI-MOCK",
          version: 1,
          sourceType: "derived",
          mediaType: "photo",
          fileId: "FILE-EVD-UI-002",
          fileHash:
            "2222222222222222222222222222222222222222222222222222222222222222",
          sourcePartyId: "P-CON",
          submittedBy: "P-SUP",
          uploadedAt: "2026-10-06T01:47:00+07:00",
          createdAt: "2026-10-06T01:47:00+07:00",
          updatedAt: "2026-10-06T01:47:00+07:00",
          createdBy: "P-SUP",
          discipline: "ARCH",
          packageId: scope.packageId,
          locationId: scope.locationId,
          responsibleOrganizationId: scope.responsibleOrganizationId,
          originalEvidenceId: "EVD-UI-001",
          sourceRange: {
            startMs: 6200,
            endMs: 6200,
            frameIndex: 186,
            ptsMs: 6200,
          },
          derivationRunId: "RUN-UI-001",
          metadata: {
            name: "frame_000186.jpg",
            mimeType: "image/svg+xml",
            byteCount: 418320,
          },
        },
        actions: [],
      },
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
