# DOUL Supervision UI Design System v1.0

## 1. 목적

감리앱의 화면을 매번 새로 디자인하지 않고, **토큰 → 공통 컴포넌트 → 화면 템플릿 → 역할별 조합** 순서로 만들기 위한 기준이다.

이 문서는 Presentation / UI 기준이다. 업무 규칙의 우선순위는 기존 계약을 따른다.

1. Domain Model
2. State Machine
3. Authority Matrix
4. Requirement / Gate
5. API Contract
6. UI Contract / Stitch
7. 이 디자인 시스템

UI는 상태, 권한, 승인조건을 새로 만들거나 우회하지 않는다.

---

## 2. 설계 원칙

- **EXPLAIN**: 사용자가 현재 상태와 다음 행동의 이유를 이해할 수 있어야 한다.
- **VERIFY**: 승인·종결·서명 전에는 필요한 근거와 Gate를 화면에서 확인할 수 있어야 한다.
- **RECORD**: 화면 동작은 증빙·이력·원본 버전과 연결되어야 한다.
- 내부 업무화면은 랜딩페이지처럼 꾸미지 않는다.
- 장식용 카드보다 표, 분할패널, 필터, 상태, 증빙 링크를 우선한다.
- DOUL Blue는 브랜드, 선택 상태, 주요 행동에 사용하고 화면 전체를 파랗게 만들지 않는다.
- 상태색은 의미 전달용으로만 사용하며 텍스트 라벨을 함께 표시한다.

---

## 3. Source of Truth

기계 판독용 토큰:

- `design/ui/tokens.json`

웹 적용 토큰/호환 계층:

- `apps/web/src/design-system.css`

React 공통 UI 프리미티브:

- `apps/web/src/ui/index.tsx`

Stitch 화면 설계:

- `design/stitch/`

Stitch는 초안과 시각 설계 도구이며, 최종 구현은 위 토큰과 공통 컴포넌트에 맞춰 정규화한다.

---

## 4. 핵심 토큰

### 색상

| 용도 | 값 |
|---|---|
| Primary | `#0B2E91` |
| Primary Muted | `#33518D` |
| Primary Deep | `#061B5C` |
| Ink | `#030213` |
| Slate 900 | `#0F172A` |
| Slate 700 | `#334155` |
| Slate 500 | `#64748B` |
| Line | `#E2E8F0` |
| Surface | `#FFFFFF` |
| Surface Alt | `#F8FAFC` |
| Success | `#127A4A` |
| Warning | `#B45309` |
| Danger | `#D4183D` |

### 간격

4px 기본 단위를 사용한다.

`4 / 8 / 12 / 16 / 24 / 32 / 48 / 64`

### 형태

- 버튼/입력: 4–6px
- 패널: 6–8px
- 상태 배지: pill 허용
- 운영 화면에서는 과도한 라운드와 큰 그림자를 사용하지 않는다.

### 밀도

- 데스크톱 기본 컨트롤: 40px
- 모바일 터치 컨트롤: 44px 이상
- 관리 테이블 행: 40–56px
- 구조화된 콘텐츠 최대 폭: 1280px

---

## 5. 공통 컴포넌트

1차 공통 프리미티브:

- `ActionButton`
- `Panel`
- `PageHeader`
- `SectionHeader`
- `StatusBadge`
- `KpiCard`
- `EmptyState`

다음 단계에서 업무 컴포넌트로 확장한다.

- `AppShell`
- `ProjectHeader`
- `FilterBar`
- `RegisterTable`
- `IssueDrawer`
- `EvidencePanel`
- `ActionGate`
- `AuditTimeline`
- `ReportPreview`
- `CapturePanel`

업무 컴포넌트는 Domain Object의 Projection만 표시하며 raw state를 직접 수정하지 않는다.

---

## 6. 화면 템플릿

### A. Dashboard

`PageHeader → KPI Strip → Action Required → Recent Activity → Risk / Schedule`

목표: 사용자가 오늘 판단하거나 처리해야 할 일을 첫 화면에서 확인한다.

### B. Register

`PageHeader → FilterBar → RegisterTable → Detail Drawer`

관리대장 29종은 서로 다른 디자인을 만들지 않고 같은 Register 템플릿을 공유한다.

### C. Issue / Inspection Workbench

`List Pane → Detail Pane → Evidence → Gate → Available Commands → Audit`

상태변경 버튼은 서버가 허용한 Command만 노출한다.

### D. Owner Report / Decision

`Decision Summary → Evidence → Impact → Requested Decision → Reply / Closure`

정기보고와 즉시보고, 의사결정 요청, 회신·조치·검증·종결을 한 흐름에서 추적한다.

### E. Mobile Field Capture

`Context → Camera/Video/Voice → Location → Evidence Preview → Submit Queue`

오프라인 원본과 서버 제출 상태를 명확히 구분한다. AI 결과는 Observation Candidate이며 공식 이슈와 구분한다.

---

## 7. 역할별 화면 규칙

- **SUP**: 검측, 증빙, 관찰, 이슈, 시정, 보고가 중심.
- **CON**: 제출, 시정, 재검측 요청과 자기 책임 범위가 중심.
- **OWN**: 보고 수령, 의사결정, 미결 위험과 영향이 중심.
- **DES**: 설계질의, 변경 영향, 참조도서가 중심.
- **ADM**: 배치·권한·자격의 관리가 중심이며 기술 승인권을 자동으로 갖지 않는다.

같은 객체라도 역할에 따라 가능한 Command와 강조 정보가 다르다.

---

## 8. AI / Stitch 사용 규칙

AI에 화면을 요청할 때 자유형 문장만 주지 않고 아래 계약을 같이 준다.

```
Use DOUL Supervision UI Design System v1.0.
Template: Register
Role: SUP
Domain source: Inspection projection
Primary action: create/request inspection
Required visible fields: status, discipline, location, contractor,
deadline, evidence count, hold point, next action.
Use existing tokens and common components.
Do not invent workflow states or commands.
```

Stitch 결과는 다음 순서로 코드화한다.

`Stitch draft → token normalization → common component mapping → API/authority check → responsive QA`

---

## 9. 품질 Gate

화면을 완료로 처리하기 전에 확인한다.

- Domain/State/Authority 계약과 불일치가 없는가
- 현재 상태, 담당, 기한, 증빙, 다음 행동이 보이는가
- Primary Action이 화면당 과도하게 많지 않은가
- 표 헤더와 주요 도구가 긴 목록에서도 유지되는가
- 모바일 터치 영역이 44px 이상인가
- 키보드 focus가 보이는가
- 상태가 색상만으로 표현되지 않는가
- 390px / 768px / 1440px에서 겹침이 없는가
- DOUL Blue가 장식이 아니라 브랜드·선택·행동에 사용되는가
- 실제 업무 데이터가 없는 내용은 초안/예시로 구분되는가

---

## 10. 적용 단계

### v1.0 — 이번 적용

- 공식 토큰 작성
- 기존 MVP CSS와 호환되는 디자인 시스템 계층 추가
- React 공통 프리미티브 추가
- 테이블 sticky header, focus, 상태색, 밀도 기준 정규화
- Stitch와 코드의 역할 분리 명문화

### v1.1

- 기존 `App.tsx`의 반복 UI를 공통 컴포넌트로 실제 치환
- Register / Workbench / Report / Capture 템플릿 컴포넌트화
- 29개 관리대장 화면 생성 규칙 연결

### v1.2

- 컴포넌트 카탈로그 및 시각 회귀 테스트
- 대표 역할별 화면을 390 / 768 / 1440px 기준으로 자동 검증
