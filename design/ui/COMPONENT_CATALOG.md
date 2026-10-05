# DOUL Supervision UI Component Catalog v1

## 목적

감리업무 화면의 반복 UI를 shadcn primitive 위에 DOUL 업무 컴포넌트로 표준화한다. 이 계층은 표시와 상호작용만 담당하며 Domain / State / Authority / Gate / API 규칙을 새로 만들지 않는다.

## 구현 계층

```
DOUL Tokens
    ↓
Tailwind CSS v4 semantic theme
    ↓
shadcn/ui owned source
    ↓
DOUL primitive
    ↓
DOUL supervision component
    ↓
Page / Template
```

소스 위치:

- shadcn owned source: `apps/web/src/components/ui/**`
- DOUL primitive: `apps/web/src/ui/index.tsx`
- 업무 컴포넌트: `apps/web/src/ui/catalog.tsx`
- 화면 템플릿: `apps/web/src/ui/templates.tsx`

## v1 컴포넌트

| 컴포넌트 | 역할 | 현재 적용 |
|---|---|---|
| `NavigationList` | 역할별 주 메뉴와 활성 상태, 배지 | Desktop AppShell |
| `FilterBar` | 검색·필터·도구의 표준 행 | 준비 완료, 관리대장 연결 대기 |
| `RegisterTable` | 관리대장 공통 표, sticky header | Admin 역할배정 |
| `DetailPane` | Workbench 상세영역 | Inspection / Issue / Action / Owner / RFI |
| `DetailDrawer` | 좁은 화면 및 관리대장 상세 Sheet | 준비 완료, Projection 연결 대기 |
| `EvidenceViewer` | 서버 증빙 목록 | Capture |
| `AuditTimeline` | 서버 처리이력 | Today |
| `ActionGate` | 서버가 허용한 Command 표시 | Workbench |
| `DecisionPanel` | 판단·선행조건 강조 | Today |

## 컴포넌트 계약

### NavigationList

입력:
- route id
- 표시명
- icon
- 선택 상태
- 선택적으로 badge

금지:
- 역할별 권한을 컴포넌트 내부에서 계산
- 접근 가능한 route를 자체 생성

권한 필터는 AppShell / UI Contract가 제공한다.

### FilterBar

입력:
- 검색 문자열
- 검색 변경 handler
- 업무별 filter control
- 우측 action

FilterBar 자체는 검색 결과를 계산하지 않는다.

### RegisterTable

입력:
- rows
- column projection
- row key

표는 Projection 결과만 렌더링한다. raw state 수정, 승인, 종결 Command는 표 내부에서 직접 수행하지 않는다.

Sticky Header의 스크롤 기준은 외부 `table-scroll` 하나로 유지한다. shadcn Table 내부 컨테이너는 RegisterTable에서 `overflow-visible`로 바꾼다.

### DetailPane / DetailDrawer

두 컴포넌트는 같은 상세 Projection을 다른 배치 방식으로 보여주기 위한 껍데기다.

- Desktop: DetailPane
- 좁은 관리대장/보조 상세: DetailDrawer

업무 상태 변경은 별도 ActionGate 또는 Page command handler를 사용한다.

### EvidenceViewer

원본/서버 증빙의 제목과 메타데이터를 표시한다. 업로드 완료 여부, AI 분석 결과의 공식성 등 업무 의미를 자체 추론하지 않는다.

### AuditTimeline

서버가 제공한 감사/처리 이력을 시간순으로 표시한다. 클라이언트 임의 이벤트를 공식 이력으로 승격하지 않는다.

### ActionGate

서버가 제공한 action descriptor를 표시한다.

- `ready`
- `requiresInput`
- `blockedReason`
- online/offline 조건

을 Page가 해석해 props로 전달한다. UI 컴포넌트는 새로운 Command를 만들지 않는다.

### DecisionPanel

사용자가 결정을 내리기 전에 반드시 확인해야 할 선행조건, 영향, 경고를 강조한다. 실제 승인 여부는 서버 Gate가 결정한다.

## 스타일 원칙

- DOUL Blue는 브랜드·선택·주요 행동에 제한적으로 사용
- 업무화면 radius 4–8px
- Desktop control 40px
- Mobile touch target 44px 이상
- 표/분할패널 우선, 장식성 카드 최소화
- 상태는 색상과 텍스트를 함께 사용
- shadcn 기본 SaaS 외형을 제품 디자인으로 직접 사용하지 않음

## Legacy CSS 이전 규칙

1. 새 컴포넌트에서 Tailwind utility 또는 DOUL semantic token으로 스타일을 옮긴다.
2. 실제 화면을 공통 컴포넌트로 치환한다.
3. 390 / 768 / 1440px 회귀시험을 통과시킨다.
4. 기존 selector가 더 이상 제품 스타일을 담당하지 않을 때만 삭제한다.
5. 테스트 locator로 사용하는 selector는 테스트 전환 전까지 호환 class를 유지할 수 있다.

v1 첫 이전 범위:
- Timeline
- Command Grid
- 기본 Table typography / spacing / overflow

기존 App.css에서 73줄을 제거했다.

## 다음 연결

- 29개 관리대장 Projection Map → `RegisterTemplate + FilterBar + RegisterTable + DetailDrawer`
- Mobile Bottom Navigation 표준화
- Evidence 상세 Preview
- Owner Decision 전용 panel
- 시각 회귀 기준 이미지 정리
