# DOUL web

실행·구현범위·미연결 기능은 [MVP 구현기준](../../23_MVP_Code_Skeleton_and_Stitch.md)을 따른다.

이 디렉터리는 실제 운영 배포가 아닌 개발 골격이다.

## UI / 기능 병렬개발 구조

자세한 경계와 브랜치 규칙은 [UI · 기능 병렬개발 경계](../../25_UI_Function_Parallel_Development.md)를 따른다.

```
src/App.tsx
  └─ Composition Root
      ├─ app/AppShell.tsx
      ├─ app/routes.ts
      ├─ pages/**
      ├─ ui/**
      └─ data/supervision-client.ts
          ├─ HTTP Adapter
          └─ Mock Adapter
```

UI 계층은 `ApiClient`와 `fetch()`를 직접 호출하지 않는다. 실제 기능은 `SupervisionClient` 경계를 통해 연결한다.

### 기본 개발 API

```bash
npm run web
```

### UI Mock Preview

```bash
npm run web:mock
```

Mock 모드는 UI 검토용이며 실제 승인·종결·업로드·문서발행을 실행하지 않는다.

### 경계검사

```bash
npm run check:ui-boundary
```


## UI 기술 계층

현재 Web UI는 다음 순서로 구성한다.

```
DOUL Design Tokens
        ↓
Tailwind CSS v4 Theme
        ↓
shadcn/ui owned source (Radix + Lucide)
        ↓
DOUL UI Primitive
        ↓
DOUL Supervision Component / Template
        ↓
Page
```

- Tailwind는 스타일 표현 수단이며 DOUL Token이 디자인의 Source of Truth다.
- shadcn 생성 코드는 `src/components/ui/**`에 저장되는 소유 코드다.
- shadcn 기본 색상·폰트·큰 radius를 그대로 사용하지 않고 DOUL semantic theme에 매핑한다.
- 기존 `App.css`와 `design-system.css`는 점진적으로 제거하며 한 번에 전면 교체하지 않는다.
- 업무 화면은 가능하면 `src/ui/**`의 DOUL Wrapper를 사용한다.
- 업무 컴포넌트 계약과 적용 현황은 `design/ui/COMPONENT_CATALOG.md`를 따른다.

### shadcn component 추가

```bash
npx shadcn@latest add <component> -c apps/web
```

현재 기반 컴포넌트:

`Button / Badge / Input / Textarea / Label / Select / Checkbox / Dialog / Sheet / Tabs / Tooltip / Dropdown Menu / Table / Separator`
