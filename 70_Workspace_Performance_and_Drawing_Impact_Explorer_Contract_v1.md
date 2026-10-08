# 작업공간 조회 성능 · 도면 영향 업무 탐색 계약 v1

2026-10-08, integration/parallel-test-v1, 기준 cec45c8.

## 작업 경계
- 서버 성능: 별도 feature/workspace-preflight-performance 작업 폴더에서 개발한다.
- 화면: 별도 feature/drawing-impact-explorer 작업 폴더에서 개발한다.
- 통합: 본 작업 폴더에서 커밋을 취합하여 실제 API/브라우저를 검증한다.

## 서버 성능 계약
- workspace 응답의 기록, 실행 가능 명령, 실패 사유, 순서, 권한 및 버전 조건을 유지한다.
- 권한·명령 사전검증을 생략하거나 사용자/프로젝트 간 결과를 재사용하지 않는다.
- 조회 중 사용하는 복제 작업의 비용을 먼저 측정한다. 상태를 공유해 승인/업무 기록을 변경할 수 있는 방식은 사용하지 않는다.
- 같은 자료와 같은 역할로 개선 전후 응답을 대조한다. 최소 감리·시공사·설계자·발주처·관리자의 결과를 확인한다.
- 측정 범위와 합성자료/실제자료 여부를 기록한다. 동시 사용자·운영 부하 인증으로 과장하지 않는다.

## 도면 영향 탐색 계약
- 알림의 정확한 drawingRef를 기준으로 서버의 drawing-impacts 응답에서 영향 사건과 미완료 업무를 표시한다.
- 권한·상태 판단은 기존 서버가 수행한다. 화면에서는 승인·기한·공정 허용·업무 상태를 변경하지 않는다.
- 연결 업무는 Inspection/Issue/Action의 명시적 유형과 버전, 현재 프로젝트가 모두 일치할 때 원본으로 이동한다.
- 과거 버전은 과거임을 표시하고 현재 버전으로 암묵적으로 바꾸지 않는다. 원본/사건을 볼 수 없거나 영향이 해소된 경우 이를 구분해 표시한다.
- 도면은 정확한 버전의 PDF 연결을 확인해 보여준다. 같은 번호/최신 제목만으로 다른 도면을 대신 열지 않는다.
- 화면 조회는 data 어댑터, 형식은 ui-contract를 사용한다. 역할·프로젝트·선택 변경 후 늦게 도착한 응답을 폐기한다.

## Context7
React 공식 useEffect 문서의 비동기 조회 cleanup/ignore 처리와 exhaustive-deps 기준을 적용한다.
https://github.com/reactjs/react.dev/blob/main/src/content/reference/react/useEffect.md
https://github.com/reactjs/react.dev/blob/main/src/content/learn/synchronizing-with-effects.md

## 완료 기준
서버 결과 동일성·상태 불변 검증, 성능 측정, 화면 권한/버전/역할 전환 검사, 실제 도면 회수→알림→영향 업무 탐색 검사, web 형식/경계/lint/build 검증 후 커밋·푸시한다. main 병합은 별도이다.
