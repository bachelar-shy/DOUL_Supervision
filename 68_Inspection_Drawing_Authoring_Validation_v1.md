# 68. 검측 작성 · 도면 연결 검증 v1

검증일: 2026-10-08 (Asia/Bangkok)
브랜치: `integration/parallel-test-v1`
환경: Mac mini, API 8801 / Vite 5191, `.local/parallel-demo.sqlite3`, Playwright workers=1.

## 결과

- 서버 테스트 16개 통과: 검측 작성 5, 도면 원본·사용 Gate 5, 기존 검측 사례 HTTP 6.
- 브라우저 테스트 4개 통과 (1.4분): 실제 자료 선택·초안 저장 1, 기존 검측 사례 및 공식 명령 확인 1, 이전 역할의 지연 성공/실패 응답 2.
- web typecheck / UI boundary / build 통과.
- lint: 오류 0, 경고 59. 기존 58개 경고에 비동기 조회의 로딩 상태 동기화 관련 React 경고 1개가 추가되었다. 빌드는 기존 500kB 초과 청크 경고를 유지한다.
- `git diff --check` 및 새 Python 모듈 컴파일 통과.
- 테스트 프런트엔드 Tailscale HTTPS 응답 200.

## 확인한 동작

- 예시 자동 작성 대신 실제 도면·위치·기준·증빙을 선택해 canonical Inspection draft를 생성한다.
- 자체검측 완료·사전 확인은 자동 체크하지 않으며 다음 공정 허용은 false다.
- 새 canonical Drawing은 작업공간 InformationItem 목록에 없어도 정확한 버전으로 조회된다. 서버 테스트에서 원본 등록·기술 승인 후 발행/수령 fixture를 부여하고 선택·저장을 검증했다. superseded로 바뀌면 새 저장을 차단한다.
- 오래된 증빙 버전·범위 밖 위치·기준·시공사 외 작성은 차단되며 실패 시 새 Inspection이 남지 않는다.
- 같은 키의 재시도는 기존 결과, 다른 내용은 충돌로 처리한다.
- 기존 검측→Issue→시정조치 조회와 명령 모달 동작을 유지한다.
- 현재 역할을 다시 선택하면 작업공간을 초기화하지 않는다. 이 수정 전 기존 검측 사례 브라우저 테스트에서 로딩이 종료되지 않는 문제가 재현되었다.
- 초기 화면의 비동기 로딩에만 역할 회귀 테스트의 준비 대기를 30초로 조정했다. 지연 응답 해제 후 역할/작업공간 검증 조건은 유지했다.

## 검증 명령

```bash
.venv/bin/python -m unittest tests_mvp.test_inspection_authoring tests_mvp.test_wave4_drawing_sources tests_mvp.test_inspection_case_http -q
npm run typecheck --workspace apps/web
npm run check:ui-boundary
npm run lint --workspace apps/web
npm run web:build
npx playwright test --config playwright.parallel.config.ts tests_browser/inspection-authoring.spec.ts tests_browser/inspection-case-flow.spec.ts tests_browser/role-refresh-race.spec.ts
```

이번 검증은 관련 기능에 집중했다. 전체 병렬 브라우저/전체 MVP 테스트를 다시 실행한 결과로 표현하지 않는다. 신규 원본의 현장 발행·수령 자체는 이전 도면 기능 검증에 해당하며 이번 새 원본 선택 테스트는 서버 fixture를 사용한다. 운영 인증·전자서명·부하 인증·도면 개정 영향 통지는 이번 범위가 아니다.
