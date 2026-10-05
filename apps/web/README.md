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
