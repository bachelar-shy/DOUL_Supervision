import type { HumanRole, UiRoute } from "../data/ui-contract";

export const routes: readonly UiRoute[] = [
  { id: "today", label: "오늘", icon: "home" },
  { id: "inspections", label: "검측·검수", icon: "check" },
  { id: "capture", label: "현장·증빙", icon: "camera" },
  { id: "observations", label: "관찰 후보", icon: "eye" },
  { id: "issues", label: "부적합·이슈", icon: "flag" },
  { id: "actions", label: "시정조치", icon: "tool" },
  { id: "owner", label: "발주처 보고·결정", icon: "report" },
  { id: "documents", label: "문서 작성", icon: "document" },
  { id: "registers", label: "관리대장", icon: "table" },
  { id: "rfis", label: "설계질의", icon: "layers" },
  { id: "admin", label: "배치·권한", icon: "users" },
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
    { id: "issues", label: "이슈", icon: "flag" },
  ],
  CON: [
    { id: "today", label: "오늘", icon: "home" },
    { id: "inspections", label: "검측", icon: "check" },
    { id: "capture", label: "촬영", icon: "camera" },
    { id: "issues", label: "이슈", icon: "flag" },
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
    "rfis",
    "documents",
    "registers",
  ],
  OWN: ["today", "owner", "issues", "documents", "registers"],
  DES: ["today", "rfis", "capture", "documents", "registers"],
  ADM: allRouteIds,
};

export const machineLabels: Record<string, string> = {
  inspection: "검측",
  observation: "관찰",
  issue: "이슈",
  action: "시정조치",
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
  owner: ["report", "decision"],
  rfis: ["rfi"],
};
