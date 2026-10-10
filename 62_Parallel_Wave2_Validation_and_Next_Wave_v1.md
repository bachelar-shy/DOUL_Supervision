# Wave 2 구현·검증 및 다음 작업

2026-10-07, integration/parallel-test-v1. main에는 병합하지 않았다. Luna 담당자가 별도 branch/worktree에서 구현하고 루트가 공통 계약, API 등록 및 화면 연결을 통합했다.

## 구현
- 정확한 Drawing InformationItem 버전과 PDF Evidence 버전을 연결하는 데모 관리자 전용 기술 인덱스. 읽기 권한, 프로젝트, 원본 MIME/해시/크기, 중복 및 재시도를 검사한다. 연결별 원본 조회는 역사 Evidence 버전의 파일을 유지한다.
- PDF.js 위치 핀: 클릭 미리보기 후 명시적으로 저장, 기존 Location anchor 보존, expectedVersion 및 Idempotency-Key 사용, 확대·회전 재표시. Location GET의 items와 선택적 drawingAnchors 계약을 적용했다.
- 검측 사례 그래프: 원 검측, 이슈, 시정조치, 재검측, 발주자 보고 및 서버 준비상태. 기존 확인창에서 현재 버전의 명령을 연다.
- 알림 원본 이동: 정확한 ID/버전 일치만 원본 이동으로 표시하고 과거 참조는 현재 버전 별도 보기로 구분한다.
- 안전 작업중지 원본의 현재 버전 명령: 증빙 입력을 포함한 확인/취소 및 서버 재개 요청 차단을 검증했다.

## 검증
Python 기본 245개 PASS; MVP 277개 실행, 실패 0, 기존 조건부 skip 35; runtime 5개 실행, 실패 0, 기존 환경 의존 skip 4.
계약 검증: 23 machines, 318 transitions, 160 policies, 29 registers, 36 forms, 307 API operations.
웹 UI boundary/typecheck/build PASS. lint 오류 0, 경고 34; 기본 JS bundle 500 kB 초과 경고가 남는다.
브라우저 최종 전체 실행: 15/15 PASS (1.9분), chromium, workers=1, 실제 테스트 서버 5191/8801. 이 중 좌표/원본선택/알림 resolver 4건은 페이지 없이 수행하는 로직 검사이며 나머지 11건은 브라우저 화면 검사다.

연결 등록 UI 검사는 합성 응답을 사용한다. 핀 검사는 연결 목록·PDF 응답을 모킹하고 실제 PDF 업로드와 Location GET/PUT·저장 후 재조회·새로고침을 검증한다. 별도 백엔드 검사는 실제 SQLite 저장소에서 연결·권한·역사 버전 원본·재시도·재시작을 검증한다. 운영 현장 데이터나 대량 부하 검증을 완료한 것으로 간주하지 않는다.

Context7의 Mozilla PDF.js PageViewport 공식 구현에 따라 convertToPdfPoint / convertToViewportPoint를 사용한다. DPR은 렌더링 해상도에만 적용하고 PDF 좌표에는 곱하지 않는다.

## 테스트 서버
https://automation-macmini.tail0e9ef7.ts.net:10002/#/parallel-test
프론트엔드 5191 / API 8801 / 합성 SQLite DB를 유지한다. Tailscale 내부 접속용이다. 저장·핀 등록은 관리자 개발 역할에서 확인한다.

## 다음 작업
1. Mac mini M4 16 GB 성능: 작업함 중복 조회, 전체 엔진 복사 기반 명령 사전검증, 테스트 기록 누적에 따른 조회시간을 측정하고 페이지 단위 계산을 개선한다. 일부 작업함 API 응답은 약 2초이며 동시 조회로 브라우저 기본 5초 대기를 초과했다. 테스트 대기를 15초로 늘렸으며 이를 성능 해결로 간주하지 않는다.
2. PDF 연결/핀의 실제 전체 API 브라우저 fixture, 역사 버전·다중 연결·역할 전환·409 충돌 검사를 확장한다.
3. 도면 주석, 도면에서 이슈 생성 및 증빙·위치 연결, 현장사용본/개정 비교를 작은 기능 단위로 진행한다.
4. 계약 기한/SLA, 예약·외부 알림, 오프라인 동기화 및 운영 인증·백업은 별도 계약과 검증으로 진행한다.
5. 발주처 보고·결정·접수·종결은 기존 계약을 따르며 자동 발송/자동 종결로 대체하지 않는다.

성능 로그 보충: 작업함 133건 HTTP 200, 중앙값 210 ms, p90 2.02초, 최대 3.31초. 5초 UI 대기 초과는 초기 진단 조회 4개와 작업함·검측 사례 조회가 SQLite snapshot 읽기에서 직렬 대기하는 영향으로 추정된다. 성능 개선은 후속 작업이다.
