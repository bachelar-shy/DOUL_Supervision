import type { HumanRole, UiRoute } from "../data/ui-contract";

export const routes: readonly UiRoute[] = [
  { id: "today", label: "오늘", icon: "home" },
  { id: "inspections", label: "검측·검수", icon: "check" },
  { id: "capture", label: "현장·증빙", icon: "camera" },
  { id: "observations", label: "관찰 후보", icon: "eye" },
  { id: "issues", label: "부적합·이슈", icon: "flag" },
  { id: "actions", label: "시정조치", icon: "tool" },
  { id: "schedule", label: "공정·지연·회복", icon: "layers" },
  { id: "contract", label: "계약통지·클레임·EOT", icon: "report" },
  { id: "safety", label: "안전·작업허가", icon: "shield" },
  { id: "owner", label: "발주처 보고·결정", icon: "report" },
  { id: "documents", label: "문서 작성", icon: "document" },
  { id: "registers", label: "관리대장", icon: "table" },
  { id: "rfis", label: "설계질의", icon: "layers" },
  { id: "admin", label: "배치·권한", icon: "users" },
  { id: "parallel-test", label: "병렬 기능 테스트", icon: "layers" },
];

const allRouteIds = routes.map((route) => route.id);

export interface MobileRouteSpec {
  id: string;
  label: string;
  icon: string;
}

export const mobileRoutes: Record<HumanRole, readonly MobileRouteSpec[]> = {
  SUP: [
    { id: "today", label: "오늘", icon: "home" },
    { id: "inspections", label: "검측", icon: "check" },
    { id: "capture", label: "촬영", icon: "camera" },
    { id: "safety", label: "안전", icon: "shield" },
  ],
  CON: [
    { id: "today", label: "오늘", icon: "home" },
    { id: "inspections", label: "검측", icon: "check" },
    { id: "capture", label: "촬영", icon: "camera" },
    { id: "safety", label: "안전", icon: "shield" },
  ],
  OWN: [
    { id: "today", label: "오늘", icon: "home" },
    { id: "owner", label: "결정", icon: "report" },
    { id: "issues", label: "이슈", icon: "flag" },
    { id: "documents", label: "문서", icon: "document" },
  ],
  DES: [
    { id: "today", label: "오늘", icon: "home" },
    { id: "rfis", label: "설계질의", icon: "layers" },
    { id: "capture", label: "촬영", icon: "camera" },
    { id: "documents", label: "문서", icon: "document" },
  ],
  ADM: [
    { id: "today", label: "오늘", icon: "home" },
    { id: "registers", label: "대장", icon: "table" },
    { id: "documents", label: "문서", icon: "document" },
    { id: "admin", label: "권한", icon: "users" },
  ],
};

export const roleRoutes: Record<HumanRole, readonly string[]> = {
  SUP: allRouteIds.filter((id) => id !== "admin"),
  CON: [
    "today",
    "inspections",
    "capture",
    "issues",
    "actions",
    "safety",
    "schedule",
    "contract",
    "rfis",
    "documents",
    "registers",
  ],
  OWN: ["today", "schedule", "contract", "owner", "issues", "documents", "registers"],
  DES: ["today", "rfis", "capture", "documents", "registers"],
  ADM: allRouteIds,
};

export const machineLabels: Record<string, string> = {
  schedule_baseline: "기준공정",
  schedule_progress: "진도기록",
  delay_event: "지연사건",
  recovery_plan: "회복계획",
  contract_notice: "계약통지",
  claim: "클레임",
  eot_request: "공기연장(EOT)",
  inspection: "검측",
  observation: "관찰",
  issue: "이슈",
  action: "시정조치",
  safety_permit: "작업허가",
  safety_stop_order: "작업중지",
  safety_equipment_inspection: "장비 안전검사",
  report: "보고",
  decision: "의사결정",
  rfi: "설계질의",
  document: "문서",
  evidence: "증빙",
};

export const machineForRoute: Record<string, readonly string[]> = {
  inspections: ["inspection"],
  observations: ["observation"],
  issues: ["issue"],
  actions: ["action"],
  contract: ["contract_notice", "claim", "eot_request"],
  owner: ["report", "decision"],
  rfis: ["rfi"],
};
