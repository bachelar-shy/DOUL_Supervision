import type { HumanRole } from "../data/ui-contract";

export interface RegisterNavigationGroupSpec {
  id: string;
  label: string;
  description: string;
  registerIds: readonly string[];
}

export interface RoleRegisterEntrySpec {
  label: string;
  description: string;
  defaultRegisterId: string;
  recommendedRegisterIds: readonly string[];
}

// Presentation-only grouping. The authoritative 29-register contract remains the
// generated projection catalog; these groups only improve findability.
export const registerNavigationGroups: readonly RegisterNavigationGroupSpec[] = [
  {
    id: "governance",
    label: "기준·계약·조직",
    description: "법령, 계약범위, 인력·자격, 보험, 감사와 경험기록",
    registerIds: ["01", "02", "03", "27", "28", "29"],
  },
  {
    id: "design-submittal",
    label: "설계·제출·승인",
    description: "도면, 송수신, 시공사 제출, 상세도, 자재승인, 질의와 설계변경",
    registerIds: ["04", "05", "06", "07", "08", "13", "14"],
  },
  {
    id: "quality",
    label: "품질·검측·시정",
    description: "자재반입, 시험·계측, 검측, 부적합과 현장지시",
    registerIds: ["09", "10", "11", "12", "15"],
  },
  {
    id: "schedule-cost",
    label: "공정·비용·계약관리",
    description: "공정·지연, 물량·기성, 계약통지·클레임·공기연장",
    registerIds: ["16", "17", "26"],
  },
  {
    id: "hse",
    label: "안전·환경·법정검사",
    description: "고위험작업, 장비·기계, 소방, 환경, 위험·기회",
    registerIds: ["18", "19", "20", "21", "25"],
  },
  {
    id: "report-closeout",
    label: "보고·기록·준공",
    description: "발주처 보고·결정, 일일기록·사진증빙, 준공·인수·하자",
    registerIds: ["22", "23", "24"],
  },
];

// These are convenience recommendations, not access-control rules. The server
// continues to filter projection rows by the authenticated role and readability.
export const roleRegisterEntries: Record<HumanRole, RoleRegisterEntrySpec> = {
  SUP: {
    label: "감리",
    description: "검측·부적합·현장조치·안전·보고 중심으로 우선 배치합니다.",
    defaultRegisterId: "11",
    recommendedRegisterIds: ["11", "12", "15", "18", "22", "23"],
  },
  CON: {
    label: "시공사",
    description: "제출·검측요청·시정조치·공정·현장기록 중심으로 우선 배치합니다.",
    defaultRegisterId: "11",
    recommendedRegisterIds: ["11", "06", "12", "16", "23", "13"],
  },
  OWN: {
    label: "발주처",
    description: "보고·결정·공정·기성·변경·계약 리스크 중심으로 우선 배치합니다.",
    defaultRegisterId: "22",
    recommendedRegisterIds: ["22", "16", "17", "14", "26", "24"],
  },
  DES: {
    label: "설계자",
    description: "도면·기술질의·설계변경·승인자료 중심으로 우선 배치합니다.",
    defaultRegisterId: "13",
    recommendedRegisterIds: ["13", "04", "14", "07", "08", "24"],
  },
  ADM: {
    label: "관리자",
    description: "인력·기준·계약·문서·감사·경험기록 중심으로 우선 배치합니다.",
    defaultRegisterId: "03",
    recommendedRegisterIds: ["03", "01", "02", "05", "28", "29"],
  },
};
