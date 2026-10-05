# 25. UI · 기능 병렬개발 경계

## 1. 목적

UI/UX 개발과 기능·백엔드 개발을 동시에 진행하되 같은 파일과 동일한 책임을 서로 수정하지 않도록 경계를 고정한다.

업무규칙의 우선순위는 기존과 동일하다.

`Domain → State → Authority → Requirement/Gate → API Contract → UI Contract → Presentation`

UI는 업무상태·권한·승인조건을 새로 만들지 않는다. 기능 개발은 화면 배치·색상·컴포넌트 표현을 결정하지 않는다.

## 2. 코드 경계

### UI 소유

- `apps/web/src/ui/**`
- `apps/web/src/pages/**`
- `apps/web/src/app/routes.ts`
- `apps/web/src/design-system.css`
- `apps/web/src/App.css`
- `design/ui/**`

담당:
- 화면구조
- 정보위계
- 컴포넌트
- 반응형
- 접근성
- Loading / Empty / Error / Disabled 표현
- Mock 화면 데이터
- Visual Regression

### 기능·통합 소유

- `app/**`
- `services/**`
- `packages/client/**`
- `app/api/openapi.yaml`
- `app/schema/**`
- DB·인증·파일·AI·알림·전자서명 구현

담당:
- Domain
- State Machine
- Authority
- Gate
- API
- 저장·동시성
- 실제 명령 실행

### 공유 경계

- `apps/web/src/data/ui-contract.ts`
- `apps/web/src/data/supervision-client.ts`
- `apps/web/src/app/AppShell.tsx`

공유 경계 변경은 UI와 기능 양쪽에 영향을 주므로 작은 PR로 처리한다.

## 3. 런타임 구조

```
Backend / Domain
      ↓
packages/client
      ↓
SupervisionClient facade
      ↓
AppShell
      ↓
Pages
      ↓
UI Components
```

`AppShell`, `pages`, `ui`에서 `ApiClient`를 직접 생성하거나 `fetch()`를 호출하지 않는다.

실제 API 변경은 `SupervisionClient` 내부에서 흡수한다.

## 4. Mock 개발

UI 개발은 실제 기능 완료를 기다리지 않는다.

```bash
npm run web:mock
```

Mock 모드는 화면·상태·레이아웃 확인용이다.

- 실제 승인·종결을 실행하지 않는다.
- 실제 파일 업로드를 실행하지 않는다.
- Mock 데이터는 법적·현장 기록이 아니다.
- 실제 업무 명령 호출 시 Preview 전용 오류를 반환한다.

기본값은 기존 HTTP 개발 API다.

## 5. 브랜치 규칙

UI 예시:

```
ui/navigation-v2
ui/register-workspace
ui/mobile-capture
```

기능 예시:

```
func/auth
func/evidence-upload
func/inspection-workflow
func/media-worker
```

각 작업은 최신 `main`에서 시작하고 오래 유지되는 대형 브랜치를 피한다.

## 6. 병합 규칙

1. UI PR은 Domain/State/API 구현을 변경하지 않는다.
2. 기능 PR은 `ui/**`, 디자인토큰, 페이지 레이아웃을 불필요하게 수정하지 않는다.
3. API Contract 변경 시 먼저 공유 DTO/Facade를 갱신한다.
4. UI는 서버가 제공하는 `availableCommands`를 표시하며 자체 권한 규칙을 만들지 않는다.
5. 상태명·권한·Gate를 UI에서 임의 추론하지 않는다.
6. Mock 상태와 실제 서버 상태를 명확히 구분한다.

## 7. 자동 경계검사

`scripts/check_ui_boundary.py`가 다음을 검사한다.

- app/pages/ui의 직접 `@doul/client` 의존
- app/pages/ui의 직접 `fetch()`
- UI 계층의 `new ApiClient()`
- backend/reference 구현 경로 의존
- Composition Root가 `AppShell + SupervisionClient` 구조를 유지하는지

CI `mvp-development`에서 매 PR마다 실행한다.

## 8. 현재 전환상태

이번 단계에서 완료:

- `App.tsx`를 9줄 Composition Root로 축소
- `app/AppShell.tsx`는 로그인·라우팅·선택상태·명령 연결을 담당하는 조정계층으로 축소
- Navigation 정의를 `app/routes.ts`로 분리
- Today / Workbench / Capture / Document / Admin을 각각 `pages/**` 실제 Page 컴포넌트로 분리
- 공통 표시요소와 Record 변환 유틸리티를 Page 구현에서 분리
- HTTP 구현을 `SupervisionClient` 뒤로 격리
- UI Mock Adapter 및 `npm run web:mock` 실행모드 추가
- CI 경계검사 추가

이후 UI 작업은 원칙적으로 `pages/**`, `ui/**`, `design-system.css`에서 진행한다. 기능 개발이 API를 변경하더라도 `SupervisionClient`가 기존 UI Contract를 유지하면 Page 수정은 필요하지 않다.
