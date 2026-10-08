# DOUL Supervision Wave 1 검증 결과 및 후속 개발

## 현재 실행 위치
- 개발 기준선: main 6dbf11c를 포함한 integration/parallel-test-v1.
- 실행 서버: Mac mini M4 16GB, API 127.0.0.1:8801, 웹 127.0.0.1:5191, 합성 데모 SQLite.
- 접속: https://automation-macmini.tail0e9ef7.ts.net:10002/#/parallel-test (Tailscale 내부 HTTPS).
- main에 병합하지 않았으며 기존 다른 Tailscale 서비스 설정을 변경하지 않았다.
- 6개 Luna 작업 에이전트가 분리된 브랜치/워크트리에서 개발하고 통합 브랜치에서 검증했다.

## 첫 실행 범위
| Stream | 개발 브랜치 | 현재 테스트할 수 있는 기능 |
|---|---|---|
| S1 | parallel/s1-pdf-viewer-v1 | PDF 증빙 업로드/원본 조회, 페이지 이동, 확대/축소/회전, 제한된 텍스트 검색, 손상 PDF 오류 |
| S2 | parallel/s2-evidence-registration-v1 | 사진/PDF 공식 Evidence 업로드, 내 격리 원본의 hash/MIME/권한 확인 후 등록, 업무 명령용 증빙 선택 |
| S3 | parallel/s3-location-edit-anchor-v1 | 위치 계층 조회, 데모 관리자 생성/이름 수정/이동, 정확한 도면 참조와 pdf_points 앵커 입력 |
| S4 | parallel/s4-inbox-actions-v1 | 역할별 작업함, 서버 명령 후보/실행 조건, 기존 명령 확인창과 실행 연결, 페이지 이동 |
| S5 | parallel/s5-notification-events-v1 | 본인 감사 이벤트 기반 앱 알림, 별도 읽음 저장, 현재 원본 권한 검사, 역할 변경 시 이전 화면 무효화 |
| S6 | parallel/s6-safety-connected-v1 | 선택한 작업중지 원본 버전의 작업허가/Issue/조치/재검증/발주자 보고 연결 조회 |

## 검증 결과
- 계약 검증: 23 machines, 318 transitions, 160 policies, 29 registers, 36 forms, 307 API operations.
- tests: 245개 통과.
- tests_mvp: 267개 실행, 실패 0, 35개 skip (미설정 외부 연동 등; 운영 연동 검증 완료를 뜻하지 않음).
- tests_runtime: 5개 실행, 실패 0, 4개 skip.
- UI 경계 검사 / 웹 typecheck / lint / build 통과. lint 경고와 500kB 초과 기본 번들 경고는 남아 있으며 PDF 뷰어는 별도 chunk로 분리했다.
- 브라우저 설정 playwright.parallel.config.ts: 7/7 통과 (실제 브라우저 시나리오 6개 + PDF 출처/version helper 검사 1개).
- 실제 PDF 2페이지 업로드/그리기/이동/확대와 손상 PDF 오류를 검사했다.
- 위치 생성/수정/새로고침 후 저장 유지, 알림 읽음의 새로고침 후 유지 및 공식 queued 상태 보존을 검사했다.
- Safety 테스트는 기존 데모 API로 신규 합성 permit/stop을 만들고 연결 조회를 검증한다. 기존 기록은 바꾸지 않으며 UI 조회 중 명령 실행이 없음을 검사한다.
- 작업함 브라우저 검사는 후보를 열고 취소했을 때 명령을 보내지 않는 것을 검사한다. 모든 업무 전이에 대한 UI 실행 검증은 포함하지 않는다.

## 운영 적용 전 제약
- PDF 업로드는 20 MiB, canvas 최대 8M pixels, DPR 2, 텍스트 검색 최대 80페이지. HTTP Range 대형 PDF, OCR, 썸네일 전체 생성, 마크업/핀, 오프라인은 아직 구현하지 않았다.
- Evidence PDF를 본다고 Drawing 발행 또는 현장사용본 확정이 되는 것은 아니다. drawingRef의 ID와 버전이 정확히 일치할 때만 연결된 도면으로 표시한다.
- 위치 편집의 정식 관리 권한은 matrix에 없다. 현재는 명시적으로 demo ADM/project_admin/render_document에서만 허용한다.
- 알림 dueAt는 감사 이벤트 발생 시각이며 법정/계약 기한이 아니다. 전달/푸시/이메일/SLA 재시도는 미구현이다.
- Mac 테스트 Python 환경은 기존 FastAPI 의존성을 읽기 전용으로 공유하고 requirements.mac-test.lock을 추가한다. production requirements.lock 재현과 실제 PostgreSQL/Redis/외부 어댑터 검증을 대신하지 않는다.
- 서버 RSS의 단일 유휴 관찰은 API 약 60MiB, Vite 약 530MiB였다. 동시 사용자와 대형 문서의 부하 용량을 보장하는 측정이 아니다.
- 일부 source branch push가 자동 승인 검토의 원격 저장소 검증 문제로 거절됐다. 통합 초기 변경은 업로드됐지만 최종 보완 커밋 일부는 Mac 로컬 Git에 있다.

## 다음 Wave의 순서
1. S0: 정식 Location 관리 권한과 변경 계약, PDF Drawing 등록/원본 링크 계약, 생산 환경 의존성 및 백업/복원 기준을 먼저 확정한다.
2. S1: 정확한 Drawing revision ↔ PDF 원본 연결, 화면 클릭 좌표와 pdf_points 변환, 버전별 핀/마크업. 발표/현장사용본은 기존 도면 업무 계약과 분리하지 않는다.
3. S2: 선택 증빙을 검측/Issue/Action 기존 명령에 연결하는 실제 UI 시나리오와 재시도. 큰 영상 업로드와 장기 보관은 별도 용량 설계 후 진행한다.
4. S3: 위치 트리 ↔ 도면 핀 연결 UI. 승인된 관리 권한이 생기기 전 운영 쓰기 기능을 열지 않는다.
5. S4: Issue → Action → 재검증 → 종결 전체 브라우저 흐름, 담당자/기한은 기존 공식 명령 또는 새 계약이 허용하는 필드만 사용한다.
6. S5: 명시적 SLA intent 기반 수신자/기한/중복/재시도 계약과 예약 작업. 이벤트 발생 시각을 업무 기한으로 재사용하지 않는다.
7. S6: Safety 정식 전이의 증빙/재개 gate UI 검증. Payment/Compliance/Handover는 최신 main의 실제 구현을 다시 확인하고 남은 UI·통합 작업을 분리한다.

각 후속 작업은 현재 통합 기준선에서 새 branch/worktree를 만들고 작은 API/UI 검증 단위로 진행한다. 이 문서는 전체 감리앱 또는 운영 배포가 완성됐다는 선언이 아니다.
