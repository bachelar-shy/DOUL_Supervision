# Workspace 성능 및 도면 영향 탐색 통합 검증 v1

검증일: 2026-10-08. 브랜치: integration/parallel-test-v1.
기준: cec45c8. 병렬 구현 통합: 89e5b29 (서버), 34f4b0c (화면).

## 구현
- preflight는 매 명령 실행마다 런타임 데이터를 독립 복사한다. 읽기 전용 상태전이·정책·스키마 정의만 deepcopy memo에 등록하여 반복 복사를 줄인다. 결과 캐시를 만들지 않는다.
- 알림과 현장 도면에서 정확한 drawingRef의 영향 업무를 조회한다. 사건 ID, 도면 버전 및 현재 권한으로 필터링한다.
- 미완료 Inspection/Issue/Action과 해당 버전 PDF를 읽기 전용으로 표시한다. 과거 업무는 현재 업무와 구분하고, 접근 불가 원본은 명시한다.
- 역할·프로젝트·선택 변경 시 이전 성공/실패 응답을 무시한다. PDF 객체 URL은 정리하며 다시 열 때 이전 URL 표시를 초기화한다.
- 기존 canonical 업무의 상태나 도면 참조를 자동 수정하지 않는다.

## 검증 결과
- Python unittest 34건 PASS: command_preview, parallel_workspace_api, drawing_impacts, inspection_authoring, wave4_drawing_field_control, wave1_notification_events, wave3_drawing_markups.
- Playwright 12건 PASS (4.1분): 실제 등록·승인·배포·확인·회수 → 알림 → 영향 API/화면 → exact PDF → 검측 원본 이동; historical ref 유지; 이전 역할의 늦은 성공/실패 차단; 알림 읽음 상태 유지; canonical/past/unknown/mismatched 원본 이동.
- 실제 회수 E2E는 API와 UI를 mock하지 않는다. 버전·역할 race 등의 별도 사례만 응답을 제어한다.
- 웹 typecheck, UI boundary, lint, web build, git diff --check PASS. 마지막 PDF 표시 초기화 수정 후 typecheck/build도 다시 PASS.
- 린트 기존 59 warnings / 0 errors. 빌드 기존 500kB 초과 청크 경고 유지.
- 기존 테스트 URL HTTP 200: https://automation-macmini.tail0e9ef7.ts.net:10002/#/parallel-test

## 통합 코드 성능 재측정
동일 합성 SQLite snapshot에 초기 업무 기록당 10개 복제, 역할별 3회 중앙값. FastAPI TestClient GET workspace 전체 호출 시간으로 비교하며 legacy deepcopy를 같은 코드에 주입한다.

| 역할 | 항목 수 | 기존 ms | 개선 ms | 배율 |
|---|---:|---:|---:|---:|
| SUP | 81 | 961.06 | 425.50 | 2.26 |
| CON | 70 | 376.35 | 174.12 | 2.16 |
| OWN | 70 | 38.83 | 27.32 | 1.42 |
| DES | 70 | 137.60 | 66.11 | 2.08 |
| ADM | 81 | 147.50 | 70.14 | 2.10 |

모든 역할에서 JSON responseEqual=true, stateUnchanged=true. 재현: .venv/bin/python scripts/benchmark_workspace_preflight.py --copies 10 --repeats 3.
합성 자료의 비교 측정이며 운영 부하·네트워크 지연·동시 사용자 용량 인증은 아니다.

## Context7 참고
- React 공식 useEffect 및 synchronizing-with-effects: 비동기 결과 무시 cleanup, 명시적 loading.
- Python 공식 copy 문서: deepcopy memo의 복사 공유 동작.
https://github.com/reactjs/react.dev/blob/main/src/content/reference/react/useEffect.md
https://github.com/reactjs/react.dev/blob/main/src/content/learn/synchronizing-with-effects.md
https://docs.python.org/3/library/copy.html

main 병합은 이 작업 범위에 포함하지 않는다.
