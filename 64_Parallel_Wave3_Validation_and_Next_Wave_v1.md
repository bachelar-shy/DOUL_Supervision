# Wave 3 구현·검증 및 다음 작업

2026-10-08 (Asia/Saigon), integration/parallel-test-v1. Luna 담당자가 별도 branch/worktree에서 구현했고 루트가 공통 계약·API·화면을 통합했다. GitHub push 및 main 병합은 하지 않았다.

## 구현
- 정확한 Drawing/PDF binding에 페이지·PDF 좌표 사각형·일반 텍스트 메모를 저장한다. PDF 원본을 변경하지 않는 기술 메타데이터이다. 데모 관리자만 작성하며 읽기는 원본 두 레코드의 권한을 따른다. 4개 모서리를 PDF.js PageViewport로 변환해 확대·회전·CSS 크기에 맞게 표시한다. 역할·프로젝트·원본·페이지·렌더 변경 시 미저장 상태 및 늦은 응답을 무효화한다.
- 주석을 선택하고 같은 Drawing 버전의 실패 원 검측과 확인된 관찰, 담당자·기한을 입력하면 감리자가 확인 후 기존 create_issue_package로 Issue와 시정조치를 생성한다. 기존 업무 권한·범위·증빙·자격 검사를 유지하고 주석 연결과 공식 기록을 하나의 SQLite 트랜잭션으로 저장한다. 취소 시 기록을 만들지 않으며 재검측·발주처 보고·종결은 자동 진행하지 않는다.
- 주석 저장은 동일 입력 재시도에 같은 Idempotency-Key를 유지한다. Issue 생성은 안정된 요청 키·본문으로 재시도하며 현재 결과 읽기 권한을 재검사하고 최초 응답을 그대로 반환한다. 원본 버전 검사, 재시작 후 보존, 중복·잘못된 입력·트랜잭션 실패 rollback을 검증했다.
- 작업함은 전체 후보 존재 여부를 권한 검사로 먼저 판단하고 선택 페이지에만 비용이 큰 명령 사전검증을 수행한다. 기존 callback이 없으면 이전 동작을 유지한다. 모든 인간 역할과 다음 페이지의 응답을 이전 경로와 비교했다. 열지 않은 작업함·알림 초기 조회 및 작업함 진단 목록의 중복 조회를 제거했다.

## 성능
동일한 합성 SQLite DB, 감리 역할, 전체 82건 중 5건 조회를 전후 각각 3회 측정했다. 전후 HTTP JSON 전체가 동일했다.
- 이전: 2382.62 / 2463.80 / 2434.85 ms, 중앙값 2434.85 ms.
- 개선: 212.60 / 184.78 / 185.85 ms, 중앙값 185.85 ms.
- 중앙값 약 13.1배 개선. 이 측정은 해당 조회의 결과이며 동시 사용자·대형 운영 프로젝트·전체 앱 성능 검증은 별도다.

## 검증
- Python 기본 248건, MVP 283건(조건부 skip 35), runtime 5건(환경 의존 skip 4): 실패 0. 총 536건 실행, skip 39.
- 계약 검증: 23 machines / 318 transitions / 160 policies / 29 registers / 36 forms / 307 API operations.
- 웹 typecheck / UI boundary / build / git diff --check 통과. lint 오류 0, 경고 42. React effect/ref 관련 경고와 기본 JS bundle 500 kB 초과 경고는 후속 개선 대상이다.
- 병렬 테스트 전체 18/18 통과, chromium workers=1, 2.2분. 14건 화면 검사와 4건 페이지 없는 좌표·원본 선택·알림 참조 로직 검사이다.
- 새 PDF 주석 및 주석→Issue 검사는 실제 업로드/연결/조회/저장 API와 UI를 사용한다. Issue 검사 fixture는 합성 실패 검측·확인된 관찰을 공식 API로 준비한다. 기존 위치 핀 검사는 연결/PDF 응답 일부를 모킹하므로 모든 기능의 운영 실증으로 해석하지 않는다.
- 전체 npm typecheck는 이 웹 전용 테스트 checkout에 Expo/React Native 의존성이 없어 모바일 workspace에서 실패했다. 모바일 변경은 없으며 웹 workspace typecheck는 통과했다. 모바일 검증은 해당 의존성을 갖춘 별도 환경에서 수행한다.

## Context7 적용
Mozilla PDF.js PageViewport 공식 구현을 기준으로 PDF 좌표↔CSS 좌표를 변환하고 DPR은 캔버스 해상도에만 적용한다. React StrictMode 및 effect cleanup 공식 문서를 기준으로 폐기된 초기 effect의 중복 조회와 늦은 응답 처리를 보완했다.
- https://github.com/mozilla/pdf.js/blob/master/src/display/page_viewport.js
- https://github.com/reactjs/react.dev/blob/main/src/content/reference/react/StrictMode.md
- https://github.com/reactjs/react.dev/blob/main/src/content/learn/synchronizing-with-effects.md

## 테스트 서버
https://automation-macmini.tail0e9ef7.ts.net:10002/#/parallel-test
Tailscale 내부 접속용. 프론트엔드 5191 / API 8801 / 기존 합성 DB 유지. API readiness 및 HTTPS HTTP 200 확인. PDF 주석 작성은 관리자 개발 역할, 주석에서 Issue 생성은 감리 개발 역할로 확인한다.

## 남은 작업
1. 주석 수정·삭제·자유선, 개정 비교·현장사용본 관리: 버전·감사·충돌 계약부터 확정한다.
2. 위치 핀의 모든 API를 실제로 사용하는 브라우저 검사, 역사/다중 binding, 역할 전환·충돌 및 특수 PDF 페이지 좌표 검사를 확장한다.
3. 작업함 외 workspace 전체 조회, SQLite 읽기 직렬 대기, 데이터 누적·동시 사용자 및 Mac mini M4 16 GB 메모리/파일 용량을 측정한다.
4. 알림 SLA·예약·외부 전송, 오프라인 동기화, 운영 인증·백업/복구는 별도 계약과 운영 검증으로 진행한다.
5. 기존 Payment / Compliance / Handover 및 발주처 보고·결정·접수·종결 업무는 기존 계약과 로드맵에 따라 계속 진행한다.
