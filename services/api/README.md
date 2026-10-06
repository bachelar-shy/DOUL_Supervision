# DOUL local-development API

`python -m services.api --demo`로만 실행한다. loopback 8791 포트와 합성자료를 사용한다.

- 기존 PR #2 `Engine`과 `Documents` 계약 재사용
- SQLite는 개발용 JSON snapshot adapter이며 normalized PostgreSQL 구현이 아니다.
- HTTP Application은 `PersistencePort`에만 의존하고, 현재 기본 구현은 `SQLiteSnapshotAdapter`다. `create_app(..., persistence=...)`로 어댑터를 주입할 수 있어 다음 단계의 PostgreSQL 구현이 Application/업무 Contract를 다시 정의하지 않도록 경계를 분리했다.
- Dev session은 실제 사용자 인증이 아니다.
- 실제 AI 모델 공급자 호출, 전자서명, DOCX/PDF 어댑터는 아직 연결하지 않았다. Generic `analysis-runs` 생성은 계속 HTTP 501이며, 대신 아래의 정규화된 Media Analysis Application Service와 demo-only Worker ingress로 계약을 검증한다.
- 모든 증빙·업무 조회와 명령에 프로젝트 배치·유효기간·범위 검증 적용
- `GET /projects/{id}/inspection-cases/{inspectionId}`는 검측을 루트로 Issue · Corrective Action · Reinspection · Owner Report · Audit을 명시적 도메인 링크만 따라 묶는 응용 조회 모델이다. 위치/공종이 같다는 이유로 관계를 추론하지 않는다. Issue별로 현재 시정주기, 시정조치 제출·검증, 재검측 합격, Issue 종결 가능 여부, 종결보고 초안·발행·발주처 수령·보고 폐쇄 상태를 `readiness`로 반환한다.
- `POST /projects/{id}/inspection-cases/{inspectionId}/issues`는 실패 판정된 원 검측에서 공식 Issue와 최초 Corrective Action을 생성·배정한다. 중간 단계가 실패하면 전체 트랜잭션을 되돌린다.
- `POST /projects/{id}/inspection-cases/{inspectionId}/issues/{issueId}/reinspections`는 시정조치 제출 후 재검측을 생성·요청하고 Issue에 연결한다. 직전 검측, 시정주기, 도면·요구사항 기준선을 서버가 상속한다.
- `POST /projects/{id}/inspection-cases/{inspectionId}/issues/{issueId}/owner-reports`는 공식 종결된 Issue에 대해서만 발주처 종결보고 **draft**를 만든다. 서버가 원검측·Issue·Observation·시정조치·재검측의 정확한 버전 참조를 `sourceDomainRefs`로 보존한다. 보고의 `submit → issue → acknowledge → dispatch → verify → close`는 기존 독립 권한·감사 상태전이를 그대로 사용하며 자동 실행하지 않는다.
- `POST /projects/{id}/media-analysis-runs`는 SUP가 서버가 고정한 모델·프롬프트·정책 프로파일로 AnalysisRun을 대기열에 등록한다. 선택한 `inspectionId`가 있으면 서버가 요청시점 `inspectionRef`를 보존하고 미디어 범위와 검측 범위가 일치하는지 확인한다. 호출자가 모델 버전이나 Inspection 버전을 주입할 수 없다.
- `GET /projects/{id}/media-analysis-runs/{runId}`는 SUP/ADM Human Review용으로 원본, 처리범위, 프레임, 원문/번역 transcript, AI candidate, 현재 연결 Inspection, Issue 준비상태를 반환한다. OWN/CON/DES에는 내부 AnalysisRun을 노출하지 않는다.
- `POST /projects/{id}/media-analysis-runs/{runId}/issues`는 해당 run의 명시적 Inspection 연결과 SUP가 확정한 같은 run의 후보만 사용해 공식 Issue + Corrective Action을 생성한다. 현재 Inspection이 실패 판정 상태가 아니거나 다른 run 후보를 섞으면 거부한다.
- `/dev/media-worker/...` 경로는 로컬 합성자료에서만 사용하는 정규화 Worker ingress다. SYSTEM이 미디어 인덱싱·작업 실행·파생 프레임·완료/실패를 기록하고 AI가 candidate Observation만 작성한다. 실제 모델 제공자나 운영 Worker 인증 구현을 뜻하지 않는다.
- 영상은 trusted `durationMs/frameCount/framePtsMs` 인덱스가 없으면 분석을 시작할 수 없고, every-frame 완료는 전체 VFR PTS와 파생 Evidence가 정확히 연결되어야 한다. 음성 transcript는 원문·언어·전역 시간범위를 보존한다.
- `photo_result:no_findings`는 모델 분석 결과일 뿐 검측 합격이나 공식 판정으로 변환하지 않는다. Candidate는 SUP의 `begin_review → confirm/reject`를 반드시 거친다.
- 위 Application Service는 기존 Domain Engine의 권한·상태전이·증빙·버전 검증을 우회하지 않으며, 동일 Idempotency-Key 재호출은 같은 결과를 반환한다.

상세는 `23_MVP_Code_Skeleton_and_Stitch.md` 참조.
