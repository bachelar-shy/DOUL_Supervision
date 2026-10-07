# DOUL Supervision 병렬개발 — 브랜치·채팅방 운영계획 v1

기준일: 2026-10-07
저장소: https://github.com/bachelar-shy/DOUL_Supervision
시작 기준선: main 223bdfe7806e53c85df7fadbd967a5634e2b9edd
구성: S0 통합관리 채팅방 1개 + S1~S6 구현 채팅방 6개
문서 범위: 브랜치 준비·책임·의존관계·시작 프롬프트·Mac mini 운영 제약. 구현 완료를 선언하는 문서가 아니다.
목표 하드웨어: 개발서버와 추후 운영서버 모두 Mac mini M4·16GB 통합 메모리. 실제 장비 부하검증 전에는 운영 수용량을 확정하지 않는다.

## 1. 목적과 운영 구조

기존 MVP 업무개발을 계속하면서 도면·증빙·위치·업무함·알림을 공통 기반으로 연결한다. 현장 사실과 근거, 이슈·조치·재검증, 발주처 보고·결정의 이력을 추적한다.

채팅방은 개발축별로 분리하고, main 병합·공통계약·공통파일 변경은 S0에서 통합 관리한다. S0는 일곱 번째 구현축이나 main을 대신하는 장기 통합 브랜치가 아니다.

기준서:
- [Product 구현 인계 기준](47_Product_Implementation_Handoff_Backlog_v1.md)
- [Product 변경관리](48_Product_Baseline_Change_Control_v1.md)
- [UI·기능 병렬개발 경계](25_UI_Function_Parallel_Development.md)
- [웹 개발 지침](apps/web/AGENTS.md)
- [구현 단계 관리](54_Implementation_Progress_Stage_Ledger_v1.md)

## 2. 채팅방과 첫 작업용 원격 브랜치

| 개발축 | 권장 채팅방 이름 | 첫 작업용 브랜치 | 첫 목표 |
|---|---|---|---|
| S0 | DOUL S0 — 통합관리 | parallel/s0-integration-control-v1 | 공통계약·접점·통합관리 |
| S1 | DOUL S1 — 도면·문서 | parallel/s1-drawing-document-v1 | 도면 개정·현장사용본 |
| S2 | DOUL S2 — 증빙·미디어 | parallel/s2-evidence-media-v1 | 원본 증빙·RustFS 연결 |
| S3 | DOUL S3 — 위치 | parallel/s3-location-v1 | 위치 조회·선택·연결 |
| S4 | DOUL S4 — 통합 업무함 | parallel/s4-work-inbox-v1 | 실제 업무 기반 통합 목록 |
| S5 | DOUL S5 — 알림·기한 | parallel/s5-notification-deadline-v1 | 실제 이벤트 기반 앱 내 알림 |
| S6 | DOUL S6 — 감리업무 | parallel/s6-business-workflow-v1 | 기존 안전 업무 연결·보완 |

위 브랜치는 모두 같은 시작 기준선에서 만들었다. S0에는 이 운영문서의 후속 커밋이 추가된다. 실제 작업 착수 직전에 main·열린 PR·해당 브랜치를 다시 확인한다.

이 브랜치를 장기 작업 누적 공간으로 사용하지 않는다. 첫 작은 작업을 병합한 뒤 다음 작업은 최신 main에서 새 브랜치를 만든다. 한 개발축이 완성되기까지 여러 작은 PR을 사용한다.

기능 PR과 화면 PR은 기준서 25에 맞춰 분리한다. 각 채팅방은 해당 기능의 저장·API·화면·실제 흐름까지 끝까지 책임진다. 화면 작업은 별도 짧은 브랜치에서 병렬 진행할 수 있으며, 미연결 화면은 명시적 Mock으로만 검증한다. Mock은 공식 승인·업로드·종결을 실행하지 않는다.

후속 이름 예:
- parallel/s1-drawing-ui-v1
- parallel/s2-media-processing-v1
- parallel/s3-location-ui-v1
- parallel/s4-work-inbox-ui-v1
- parallel/s5-notification-ui-v1
- parallel/s6-payment-workflow-v1

후속 브랜치는 필요한 시점의 최신 main에서 생성한다. 이번 준비에서 위 후속 예시 브랜치를 미리 만들지는 않는다.

## 3. 공통 기술스택과 현재 전환 과제

| 영역 | 유지할 기술 | 적용 기준 |
|---|---|---|
| 웹 | React 19·TypeScript·Vite·Tailwind·shadcn/ui·Radix | 기존 DOUL 토큰·컴포넌트와 SupervisionClient 경계 |
| 모바일 | Expo·React Native·SQLite·기기 파일 저장·이미지 선택 | 기기 원본 보관·재시도 기반 재사용, 실제 기기 검증 |
| API | Python·FastAPI·Uvicorn | 기존 업무 엔진·PersistencePort 소비 |
| 데이터 | PostgreSQL 16·Psycopg; SQLite 개발 어댑터 | 현재 전체 스냅샷/직렬화 방식, 정규화 전환은 S0 조율 |
| 파일 | ObjectStoragePort·boto3·RustFS 개발환경 | 실제 업로드 연동, 원본/파생/출력물 구분. 16GB 단일 운영서버의 RustFS 채택은 실측·복구검증 조건부 |
| 작업 처리 | Redis Streams·Python Worker·지속 작업원장/Outbox | Redis는 전달수단, 공식 상태·시도·중복 방지는 DB |
| 인증 | 기존 RS256 JWT 검증·서버 RoleAssignment | 로그인 발급/갱신/철회 연동과 프로젝트 범위 확인 |
| 출력 | python-docx·LibreOffice·Poppler | 선택형 기존 출력 환경 재사용, 원본 Snapshot 보존. ARM64 이미지 검증·동시 변환 제한 |
| 검증 | Python unittest·Playwright·GitHub Actions | 기존 자동 검사와 실제 기능 인수사례 |

추가 기술은 PDF.js/SVG(S1), Pillow·FFmpeg·ffprobe(S2)를 우선 후보로 둔다. 의존성·이미지 변경은 S0에서 한 번 반영한다. 버전은 기존 잠금 파일과 호환 검증을 기준으로 정하며 스트림마다 전체 잠금 파일을 갱신하지 않는다.

중요한 현황:
1. PostgreSQL이 존재해도 현재 전체 스냅샷 저장을 기능별 테이블 저장으로 바꾼 것은 아니다. 각 스트림이 독립 DB 또는 별도 쓰기 경로를 만들지 않는다.
2. 기존 업로드는 개발용 크기 제한과 DB blob 저장을 사용한다. RustFS 운영 업로드는 실제 연결·실패 복구 검증이 필요하다.
3. Worker와 분석 계약은 존재하지만 실제 AI 제공자는 미설정이다. 판독 모델 연결은 별도 작업이다.
4. 단순 알림 읽음은 업무 완료·보고 회신·승인을 뜻하지 않는다.
5. 현재 확인한 Compose에는 서비스별 CPU·메모리 상한이 없고, 컨테이너 CI에는 명시적 ARM64 빌드·실행 검증이 없다. Mac mini 운영 적합성은 아직 입증되지 않았다. 제10절의 하드웨어 검증을 S0 선행 작업에 포함한다.

## 4. 파일 책임과 충돌 관리

기존 파일을 대규모 이동하지 않는다. 아래 신규 모듈 경로는 권장 구획이며 첫 작업에서 기존 확장 지점을 우선 확인한다.

| 파일/경계 | 기본 조율 책임 | 작업 방식 |
|---|---|---|
| app/schema/** 및 업무 의미를 정의하는 Product 기준서 | S0 내 Product/Functional | 변경등급·영향·인수사례를 먼저 확정 |
| app/reference/engine.py·documents.py·projections.py·validation.py | S0 | 각 스트림의 최소 변경 요청을 별도 공통 PR로 반영 |
| services/api/main.py·application.py·persistence.py·store.py·postgres_store.py | S0 | 공통 등록/저장 경계 변경은 단일 담당 PR |
| app/api/openapi.yaml·app/types/**·packages/client/src/index.ts | S0 | 계약 원본에서 갱신, 생성물을 임의 편집하지 않음 |
| apps/web/src/data/ui-contract.ts·supervision-client.ts·공통 Mock | S0 | UI/기능 양쪽을 확인하고 호환성을 유지 |
| AppShell.tsx·routes.ts·register-navigation.ts·공통 CommandModal | S0 | 화면 등록·공통 명령 UI 접점 요청을 모아서 처리 |
| 공유 UI wrappers·components/ui·디자인 토큰·전역 CSS | S0 | 필요한 공통 변경만 수행, 화면은 기존 컴포넌트 소비 |
| package.json·package-lock.json·공유 Python lock·Compose·CI·DB migration | S0 | 전체 갱신 중복 방지, 한 변경에 한 책임자 |
| 도면 전용 모듈·DocumentPage의 도면 기능 | S1 | 다른 업무/출력 경계에 영향이 있으면 S0에 요청 |
| 증빙/미디어 전용 모듈·CapturePage·EvidenceDetailPreview·mobile capture.ts | S2 | 공통 Worker/모바일 앱 Shell 변경은 S0에 요청 |
| 위치 전용 모듈·신규 위치 화면/선택기 | S3 | 공통 Location 계약 재사용 |
| 업무함 조회·Today/Workbench 목록 | S4 | 업무 명령은 원래 업무로 위임 |
| 알림 전용 모듈·신규 알림 화면/작업 | S5 | 헤더/라우터 연결은 S0에 요청 |
| 업무별 실행 모듈·Safety/Schedule/Contract/Owner 및 후속 업무 화면 | S6 | 필요한 업무만 변경, S1~S5 원본 기능 복제 금지 |
| 스트림별 새 시험 파일 | 각 스트림 | test_s1_*, test_s2_* 등 독립 이름 사용 |

권장 신규 구획은 services/api/modules/<기능>/, packages/client/src/modules/<기능>/, apps/web/src/data/streams/<기능>/ 등이다. 현 구조에 더 작은 확장 지점이 있으면 이를 우선 사용한다. pages/app/ui 계층은 직접 fetch()나 @doul/client 호출을 추가하지 않고 data/supervision-client.ts와 ui-contract.ts 경계를 따른다.

S0는 모든 공통 변경을 혼자 작성해야 하는 역할이 아니다. 공통 파일은 PR별로 단일 구현 담당을 지정할 수 있다. 두 채팅방이 같은 파일의 같은 영역을 동시에 수정하지 않도록 담당·대상·기간·PR을 기록한다.

공통 변경 요청 최소 정보:
- 필요한 동작·이유·개발축
- 대상 파일과 계약/DTO/API
- 호환성 및 다른 개발축 영향
- 필요한 인수사례
- 선행 PR·제안 담당·우선순위

## 5. 의존관계와 단계별 병합

| 단계 | 진행 내용 | 병합 기준 |
|---|---|---|
| W0 | S0가 최소 계약·공통 접점·담당·저장소 전환 범위를 정리. S1~S6는 기존 구현 점검과 모듈/화면 작업을 시작 | 전체 기반 완성을 기다리지 않고 필요한 최소 공통 PR부터 병합 |
| W1-A | 도면 개정 메타데이터·원본 증빙 저장·위치 조회의 독립 작은 기능 | 각 PR의 실제 저장·권한·참조 검증 |
| W1-B | S6 기존 안전 업무와 공통 참조 연결. S4 실제 업무함 조회·S5 실제 이벤트 알림 연결 | 합성 화면만이 아니라 실제 API·저장소로 동작 |
| W1-C | 역할을 바꾸어 통합 업무 흐름 검증 | 근거·버전·권한·재시도·보고/결정 조건 보존 |
| W2 | 기성·법규준수·인계와 보고/결정 흐름 확장 | 현재 main 미완료 범위와 공식 인계순서를 기준으로 선택 |
| W3 | 사진/영상 판독·음성 전사·현장 통신 대응 확대 | 원본/시간/처리범위 추적, 감리자 검토, 실제 현장 표본 검증 |

단계 표는 모든 PR을 일렬로 기다리게 하는 지시가 아니다. 코드 작업은 병렬로 진행하고, 병합만 해당 PR의 실제 선행 의존관계에 맞춘다.

최소 연결:
- S1은 S2의 파일 참조·저장 기능과 S3의 위치 참조를 소비한다.
- S4는 S6의 기존 실제 업무 조회를 먼저 소비할 수 있다.
- S5는 S6의 기존 실제 업무 이벤트 하나로 시작할 수 있다.
- S6는 S1~S3에서 제공한 최소 참조부터 연결하며 전체 모듈 완성을 기다리지 않는다.
- S2 미디어/AI 작업과 S5 알림 작업은 다른 큐 이름 공간/스트림을 사용한다.

현재 main에 안전·공정·계약 기능이 존재하므로 전부 다시 만들지 않는다. 착수 시 열린 PR를 확인하여 다른 채팅방에서 진행 중인 동일 업무를 중복 구현하지 않는다.

## 6. Git/worktree와 PR 규칙

1. 각 채팅방은 저장소 remote와 현재 작업 상태를 먼저 확인한다.
2. 같은 로컬 checkout에서 다른 채팅방의 브랜치로 전환하지 않는다. 별도 worktree를 사용하고 기존 변경을 임의로 stash/reset/delete하지 않는다.
3. 로컬 저장소가 없으면 독립 경로에 저장소를 준비한다. 로컬 저장소가 있으면 원래 checkout을 보존하고 원격의 담당 브랜치를 별도 worktree로 연결한다.
4. 작업 착수 전과 PR 준비 전에 origin/main을 확인하고 자기 브랜치에만 필요한 최신 기준선을 반영한다. 공유 브랜치의 이력을 강제로 변경하지 않는다.
5. 작은 기능 단위로 커밋·푸시·PR을 만든다. 계약/공통 준비 → 기능 API → UI 연결처럼 작은 PR로 나누되 담당 채팅방이 전체 흐름을 완성한다.
6. 구현 채팅방은 구현·검증·커밋·푸시·작은 PR 준비까지 담당한다. main 병합은 S0에서 의존관계·검증·사용자 지시를 확인하여 관리한다.
7. 첫 PR 이후 다음 작업은 최신 main에서 새 짧은 브랜치를 만든다. 이미 병합된 브랜치에 후속 작업을 누적하지 않는다.
8. PR에는 문제·결과 동작·범위·변경 파일·선행 PR·검증·남은 연결을 적는다. 실패를 PASS로 표시하지 않는다.
9. main만 통합 기준선으로 사용한다. 스트림 간 전체 브랜치를 서로 병합해 비공식 기준선을 만들지 않는다.

같은 로컬 저장소에서 준비하는 예시는 아래와 같다. REPO_PATH는 해당 저장소의 절대 경로로 지정한다. 이미 로컬 브랜치/worktree가 있으면 상태를 확인해 재사용하며 명령을 무조건 반복하지 않는다.

```bash
git -C "$REPO_PATH" fetch origin
git -C "$REPO_PATH" worktree add --track -b parallel/s1-drawing-document-v1 ../doul-s1-drawing origin/parallel/s1-drawing-document-v1
```

권장 로컬 작업경로: ../doul-s0-integration, ../doul-s1-drawing, ../doul-s2-evidence, ../doul-s3-location, ../doul-s4-inbox, ../doul-s5-notification, ../doul-s6-business. 경로가 존재하면 덮어쓰지 말고 해당 worktree 정보를 확인한다. 문서 준비 단계에서 로컬 worktree를 생성했다는 의미는 아니다.

## 7. 실제 완료 기준

각 개발축: 계약 소비·저장·API·화면 연결·역할별 실제 흐름과 실패 처리를 확인한다. 해당 변경에 맞는 계약/서버 시험, UI 경계검사·타입·린트·빌드·Playwright, 실제 PostgreSQL/RustFS/Redis 인수사례를 수행한다. 모바일은 실제 기기에서 촬영·원본 보관·통신 중단·재시도를 확인한다.

통합 시나리오:
- 위치·당시 도면 개정본·증빙을 연결한 현장기록
- 이슈·시정조치·재검증 및 종결 준비상태
- 필요한 즉시보고·결정 요청·회신·실행 확인
- 역할별 업무함·알림 및 기한 변경
- 프로젝트 권한 차단·버전 충돌·재시도·장애 복구

안전·계약·기성 등 업무별로 보고/결정/재개 시점이 다르므로 하나의 고정 순서로 강제하지 않는다. 기반기능 존재, Mock 화면, 컨테이너 기동만으로 기능 구현/통합/현장검증 단계를 상향하지 않는다.

## 8. 공통 진행상황 인계 형식

각 채팅방의 작업 종료/PR 준비 시 다음을 남긴다.

```text
개발축 / 작업명:
브랜치 / HEAD:
기준 main:
변경 내용·대상 파일:
계약·DTO·API 변경과 S0 요청:
의존 PR / 병합 가능한 조건:
검증 결과와 근거:
Mac M4/16GB 검증: ARM64 실행 여부·최대 메모리·동시 작업 수·응답/대기시간·복구 결과 또는 미검증 사유:
완료 범위 / 실제 미연결 범위:
다음 최소 작업:
```

## 9. 채팅방별 시작 프롬프트

각 프롬프트는 해당 채팅방에 그대로 붙여 넣어 사용한다.

### S0 — 통합관리

```text
이 채팅방은 DOUL Supervision S0 — 통합관리 전담 개발 채팅방이다.

저장소: https://github.com/bachelar-shy/DOUL_Supervision
첫 작업용 원격 브랜치: parallel/s0-integration-control-v1
준비 시점 기준 main: 223bdfe7806e53c85df7fadbd967a5634e2b9edd
운영계획: https://github.com/bachelar-shy/DOUL_Supervision/blob/parallel/s0-integration-control-v1/55_Parallel_Development_Branches_and_Chat_Handoff_v1.md

최초 작업:
1. main의 동일 경로 운영계획을 우선 읽고 아직 병합되지 않았으면 위 S0 문서 URL을 읽어라. 해당 경로의 AGENTS.md와 최신 main·열린 PR·브랜치/로컬 변경 상태도 확인하라.
2. 기존 작업을 보존한 별도 worktree에서 담당 브랜치를 사용하라. 다른 채팅방의 checkout이나 이력을 바꾸지 마라.
3. 기존 구현을 재사용하고 이번 최소 기능의 범위·선행 의존관계를 정리한 뒤 구현·검증·커밋·푸시·작은 PR 준비까지 진행하라. main 병합은 S0 통합관리 채팅방에서 관리한다.

담당 목표:
통합관리·Product 계약 조율·공통 접점

첫 구현 작업:
현재 main과 열린 PR를 다시 확인하고, 공통 계약·파일 담당·최소 연결 접점을 정리한다. 기존 API/클라이언트/화면 경계를 보존하는 작은 통합 준비 PR를 만든다. M4/16GB 실행 프로필·ARM64 이미지 검증·자원 제한·무거운 작업 동시 실행 통제·재부팅 복구의 최소 준비 작업도 조율한다.

수정 책임:
공통 계약, 저장소·DB 변경, API 등록부, 공유 DTO/Facade, 라우팅·공통 디자인, 의존성 잠금 파일, 공통 CI/Compose. 직접 구현하거나 해당 PR에 한해 단일 담당을 지정한다.

기술스택:
OpenAPI·JSON Schema·공유 TypeScript 클라이언트·기존 권한 엔진·PostgreSQL/Psycopg·Redis Streams·GitHub Actions·Docker Compose.

완료 기준:
도면 개정본·증빙·위치 참조, 업무함 조회, 이벤트·알림의 최소 규격이 명확하고 각 개발축에 첫 통합 가능 경로가 있다. 공유 변경 후 기존 업무 회귀검증이 유지된다.

특별 지침:
기존 Product 기준서 47·48, UI 경계 기준서 25와 apps/web/AGENTS.md를 따른다. S0 브랜치는 main을 대신하는 장기 통합 브랜치가 아니다. 다른 개발축의 전체 변경을 한 브랜치에 모으지 않는다. 공통파일 변경 요청을 작은 PR 단위로 조율하고 병합 관리는 이 채팅방에서 수행한다. 병합은 사용자가 허용한 범위에서 진행하고 같은 허가를 반복해서 묻지 않는다.

하드웨어 제약:
개발서버와 추후 운영서버는 Mac mini M4·16GB 통합 메모리다. 운영계획 제10절을 읽고 이 제약을 구현·검증·인계에 반영하라. Linux 컨테이너는 ARM64로 빌드·실행 검증하고 amd64 에뮬레이션 통과만으로 완료 처리하지 마라. 병렬 채팅방/브랜치 수만큼 전체 서버 환경을 복제하지 마라. 개발용 공통 서비스는 공유하되 DB·객체 경로·큐·시험 데이터를 개발축별로 구분하라. 실제 운영 데이터와 개발 데이터를 섞지 마라. AI·영상 변환·문서 변환의 무거운 작업은 장비 전체에서 초기 동시 1건으로 제한하고 실측 후 조정하라. 업무 알림 처리는 무거운 작업과 분리해 지연을 검증하라. GPU 가속은 macOS 별도 서비스 또는 명시적으로 지원되는 실행기를 검증해야 하며 일반 Linux Worker 컨테이너가 Metal을 직접 사용한다고 가정하지 마라. RustFS는 개발용으로 연결하되 16GB 단일 서버 운영 채택은 부하·장애·복구 검증 조건부다. 공통 실행환경/의존성/자원 제한 변경은 S0와 조율하고 실측하지 않은 운영 성능을 보장하지 마라.

공통 규칙:
- main이 유일한 통합 기준선이다. 첫 작업 이후 새 작은 작업은 최신 main에서 새 브랜치를 만든다.
- app/schema, 공통 Engine/Persistence, main.py, OpenAPI/공유 타입/Facade, 라우터, 전역 스타일, 잠금 파일, Compose/CI/DB 변경은 S0에 변경 요청을 남기고 PR별 단일 담당을 정한다.
- Product 상태·권한·Gate·판정·종결 의미는 해당 채팅방에서 임의 변경하지 않는다. 기준서 48에 따라 S0의 Product/Functional 책임으로 먼저 확정한다.
- 기능 PR과 화면 PR은 기준서 25에 맞춰 작게 분리하되, 이 채팅방이 실제 화면 연결까지 책임진다.
- 웹의 pages/app/ui는 직접 fetch 또는 @doul/client 호출을 추가하지 않는다. SupervisionClient·ui-contract 경계를 따른다.
- 공통 의존성이 아직 병합되지 않았으면 독립 모듈·시험·명시적 Mock 화면 개발을 계속하되 실제 통합 완료로 표시하지 않는다.
- 의미 있는 변경 범위에 맞는 검증을 수행하고, 실제 사용하지 않은 저장소/판독/승인/현장검증을 완료로 선언하지 않는다.
- 브랜치·HEAD·변경 파일·의존 PR·검증·미연결 범위·S0 요청·다음 작업을 종료 보고에 남겨라.
```

### S1 — 도면·문서

```text
이 채팅방은 DOUL Supervision S1 — 도면·문서 전담 개발 채팅방이다.

저장소: https://github.com/bachelar-shy/DOUL_Supervision
첫 작업용 원격 브랜치: parallel/s1-drawing-document-v1
준비 시점 기준 main: 223bdfe7806e53c85df7fadbd967a5634e2b9edd
운영계획: https://github.com/bachelar-shy/DOUL_Supervision/blob/parallel/s0-integration-control-v1/55_Parallel_Development_Branches_and_Chat_Handoff_v1.md

최초 작업:
1. main의 동일 경로 운영계획을 우선 읽고 아직 병합되지 않았으면 위 S0 문서 URL을 읽어라. 해당 경로의 AGENTS.md와 최신 main·열린 PR·브랜치/로컬 변경 상태도 확인하라.
2. 기존 작업을 보존한 별도 worktree에서 담당 브랜치를 사용하라. 다른 채팅방의 checkout이나 이력을 바꾸지 마라.
3. 기존 구현을 재사용하고 이번 최소 기능의 범위·선행 의존관계를 정리한 뒤 구현·검증·커밋·푸시·작은 PR 준비까지 진행하라. main 병합은 S0 통합관리 채팅방에서 관리한다.

담당 목표:
도면·개정·현장사용본·문서 배포

첫 구현 작업:
43_Drawing_Revision_Field_Distribution_Functional_Contract.md와 기존 도면 구현을 확인한 뒤, 도면 개정본 등록·조회·현장사용본 표시의 최소 기능을 재사용·확장한다. 화면 연결은 별도 작은 UI PR로 진행한다.

수정 책임:
도면·문서 전용 서비스/클라이언트 모듈, DocumentPage.tsx의 관련 기능, 도면 전용 화면·시험. 범용 문서출력 환경은 공통 담당과 협의한다.

기술스택:
React·TypeScript·FastAPI·기존 PersistencePort·PostgreSQL·RustFS; PDF.js와 SVG 표시층은 S0 의존성 조율 후 추가.

완료 기준:
승인·배포·현재 사용 상태를 구분하며 과거 현장기록이 정확한 개정본을 계속 참조한다. 확대·회전 후에도 PDF 페이지 좌표의 마킹 위치가 유지된다.

특별 지침:
S2의 파일 저장 인터페이스를 소비하고 업로드 엔진을 복제하지 않는다. PDF 뷰어를 우선 대상으로 하며 DWG/BIM 처리까지 첫 PR에 확대하지 않는다. 일반 문서와 도면의 승인·배포 의미를 혼합하지 않는다.

하드웨어 제약:
개발서버와 추후 운영서버는 Mac mini M4·16GB 통합 메모리다. 운영계획 제10절을 읽고 이 제약을 구현·검증·인계에 반영하라. Linux 컨테이너는 ARM64로 빌드·실행 검증하고 amd64 에뮬레이션 통과만으로 완료 처리하지 마라. 병렬 채팅방/브랜치 수만큼 전체 서버 환경을 복제하지 마라. 개발용 공통 서비스는 공유하되 DB·객체 경로·큐·시험 데이터를 개발축별로 구분하라. 실제 운영 데이터와 개발 데이터를 섞지 마라. AI·영상 변환·문서 변환의 무거운 작업은 장비 전체에서 초기 동시 1건으로 제한하고 실측 후 조정하라. 업무 알림 처리는 무거운 작업과 분리해 지연을 검증하라. GPU 가속은 macOS 별도 서비스 또는 명시적으로 지원되는 실행기를 검증해야 하며 일반 Linux Worker 컨테이너가 Metal을 직접 사용한다고 가정하지 마라. RustFS는 개발용으로 연결하되 16GB 단일 서버 운영 채택은 부하·장애·복구 검증 조건부다. 공통 실행환경/의존성/자원 제한 변경은 S0와 조율하고 실측하지 않은 운영 성능을 보장하지 마라.

공통 규칙:
- main이 유일한 통합 기준선이다. 첫 작업 이후 새 작은 작업은 최신 main에서 새 브랜치를 만든다.
- app/schema, 공통 Engine/Persistence, main.py, OpenAPI/공유 타입/Facade, 라우터, 전역 스타일, 잠금 파일, Compose/CI/DB 변경은 S0에 변경 요청을 남기고 PR별 단일 담당을 정한다.
- Product 상태·권한·Gate·판정·종결 의미는 해당 채팅방에서 임의 변경하지 않는다. 기준서 48에 따라 S0의 Product/Functional 책임으로 먼저 확정한다.
- 기능 PR과 화면 PR은 기준서 25에 맞춰 작게 분리하되, 이 채팅방이 실제 화면 연결까지 책임진다.
- 웹의 pages/app/ui는 직접 fetch 또는 @doul/client 호출을 추가하지 않는다. SupervisionClient·ui-contract 경계를 따른다.
- 공통 의존성이 아직 병합되지 않았으면 독립 모듈·시험·명시적 Mock 화면 개발을 계속하되 실제 통합 완료로 표시하지 않는다.
- 의미 있는 변경 범위에 맞는 검증을 수행하고, 실제 사용하지 않은 저장소/판독/승인/현장검증을 완료로 선언하지 않는다.
- 브랜치·HEAD·변경 파일·의존 PR·검증·미연결 범위·S0 요청·다음 작업을 종료 보고에 남겨라.
```

### S2 — 증빙·미디어

```text
이 채팅방은 DOUL Supervision S2 — 증빙·미디어 전담 개발 채팅방이다.

저장소: https://github.com/bachelar-shy/DOUL_Supervision
첫 작업용 원격 브랜치: parallel/s2-evidence-media-v1
준비 시점 기준 main: 223bdfe7806e53c85df7fadbd967a5634e2b9edd
운영계획: https://github.com/bachelar-shy/DOUL_Supervision/blob/parallel/s0-integration-control-v1/55_Parallel_Development_Branches_and_Chat_Handoff_v1.md

최초 작업:
1. main의 동일 경로 운영계획을 우선 읽고 아직 병합되지 않았으면 위 S0 문서 URL을 읽어라. 해당 경로의 AGENTS.md와 최신 main·열린 PR·브랜치/로컬 변경 상태도 확인하라.
2. 기존 작업을 보존한 별도 worktree에서 담당 브랜치를 사용하라. 다른 채팅방의 checkout이나 이력을 바꾸지 마라.
3. 기존 구현을 재사용하고 이번 최소 기능의 범위·선행 의존관계를 정리한 뒤 구현·검증·커밋·푸시·작은 PR 준비까지 진행하라. main 병합은 S0 통합관리 채팅방에서 관리한다.

담당 목표:
현장 증빙·파일 저장·미디어 처리

첫 구현 작업:
기존 분할업로드 API, 모바일 capture.ts와 Worker를 확인하고, 원본 증빙을 RustFS에 실제 저장·조회하는 최소 연결부터 진행한다. 기존 64MiB 제한, DB blob 저장, 재시도·해시 동작을 확인해 전환 범위를 정한다. 서버의 누적 blob 복사와 모바일의 전체 파일 메모리 읽기를 확인하고, 파일 크기에 비례해 메모리를 계속 늘리지 않는 분할·스트리밍 전환을 우선한다.

수정 책임:
증빙 전용 서비스/클라이언트, CapturePage.tsx·EvidenceDetailPreview.tsx, apps/mobile/src/capture.ts, 미디어 제공자/전처리 모듈과 관련 시험. Worker/큐 공통 기반은 S0와 조율한다.

기술스택:
Expo·React Native·expo-sqlite·expo-file-system·expo-image-picker·FastAPI·boto3/RustFS·기존 Python Worker; Pillow·FFmpeg·ffprobe는 단계별 추가.

완료 기준:
원본 바이트·해시·작성자·위치·개정본 참조가 보존되고 중단·재시도·중복 요청에서도 공식 증빙이 중복 생성되지 않는다. 다른 프로젝트 파일 접근을 거부하고 DB와 객체 저장소 간 실패를 복구한다.

특별 지침:
RustFS와 DB 쓰기를 단일 원자 트랜잭션으로 가정하지 않는다. 임시 업로드·객체 검증·완료 확인·불일치 복구를 설계한다. AI 모델은 현재 미연결이므로 업로드 완료를 판독 완료로 표시하지 않는다. 판독 단계는 ProviderPort로 분리하고 감리자의 후보 검토 절차를 유지한다. 영상의 실제 프레임 표시시각과 분석 범위를 보존한다. WhisperKit은 macOS 별도 처리 서비스의 검증 후보이며 모델 채택 완료로 간주하지 않는다.

하드웨어 제약:
개발서버와 추후 운영서버는 Mac mini M4·16GB 통합 메모리다. 운영계획 제10절을 읽고 이 제약을 구현·검증·인계에 반영하라. Linux 컨테이너는 ARM64로 빌드·실행 검증하고 amd64 에뮬레이션 통과만으로 완료 처리하지 마라. 병렬 채팅방/브랜치 수만큼 전체 서버 환경을 복제하지 마라. 개발용 공통 서비스는 공유하되 DB·객체 경로·큐·시험 데이터를 개발축별로 구분하라. 실제 운영 데이터와 개발 데이터를 섞지 마라. AI·영상 변환·문서 변환의 무거운 작업은 장비 전체에서 초기 동시 1건으로 제한하고 실측 후 조정하라. 업무 알림 처리는 무거운 작업과 분리해 지연을 검증하라. GPU 가속은 macOS 별도 서비스 또는 명시적으로 지원되는 실행기를 검증해야 하며 일반 Linux Worker 컨테이너가 Metal을 직접 사용한다고 가정하지 마라. RustFS는 개발용으로 연결하되 16GB 단일 서버 운영 채택은 부하·장애·복구 검증 조건부다. 공통 실행환경/의존성/자원 제한 변경은 S0와 조율하고 실측하지 않은 운영 성능을 보장하지 마라.

공통 규칙:
- main이 유일한 통합 기준선이다. 첫 작업 이후 새 작은 작업은 최신 main에서 새 브랜치를 만든다.
- app/schema, 공통 Engine/Persistence, main.py, OpenAPI/공유 타입/Facade, 라우터, 전역 스타일, 잠금 파일, Compose/CI/DB 변경은 S0에 변경 요청을 남기고 PR별 단일 담당을 정한다.
- Product 상태·권한·Gate·판정·종결 의미는 해당 채팅방에서 임의 변경하지 않는다. 기준서 48에 따라 S0의 Product/Functional 책임으로 먼저 확정한다.
- 기능 PR과 화면 PR은 기준서 25에 맞춰 작게 분리하되, 이 채팅방이 실제 화면 연결까지 책임진다.
- 웹의 pages/app/ui는 직접 fetch 또는 @doul/client 호출을 추가하지 않는다. SupervisionClient·ui-contract 경계를 따른다.
- 공통 의존성이 아직 병합되지 않았으면 독립 모듈·시험·명시적 Mock 화면 개발을 계속하되 실제 통합 완료로 표시하지 않는다.
- 의미 있는 변경 범위에 맞는 검증을 수행하고, 실제 사용하지 않은 저장소/판독/승인/현장검증을 완료로 선언하지 않는다.
- 브랜치·HEAD·변경 파일·의존 PR·검증·미연결 범위·S0 요청·다음 작업을 종료 보고에 남겨라.
```

### S3 — 위치

```text
이 채팅방은 DOUL Supervision S3 — 위치 전담 개발 채팅방이다.

저장소: https://github.com/bachelar-shy/DOUL_Supervision
첫 작업용 원격 브랜치: parallel/s3-location-v1
준비 시점 기준 main: 223bdfe7806e53c85df7fadbd967a5634e2b9edd
운영계획: https://github.com/bachelar-shy/DOUL_Supervision/blob/parallel/s0-integration-control-v1/55_Parallel_Development_Branches_and_Chat_Handoff_v1.md

최초 작업:
1. main의 동일 경로 운영계획을 우선 읽고 아직 병합되지 않았으면 위 S0 문서 URL을 읽어라. 해당 경로의 AGENTS.md와 최신 main·열린 PR·브랜치/로컬 변경 상태도 확인하라.
2. 기존 작업을 보존한 별도 worktree에서 담당 브랜치를 사용하라. 다른 채팅방의 checkout이나 이력을 바꾸지 마라.
3. 기존 구현을 재사용하고 이번 최소 기능의 범위·선행 의존관계를 정리한 뒤 구현·검증·커밋·푸시·작은 PR 준비까지 진행하라. main 병합은 S0 통합관리 채팅방에서 관리한다.

담당 목표:
공통 위치 계층과 공간 참조

첫 구현 작업:
기존 Location·scope 계약을 확인하고 위치 계층 조회·선택·업무 연결의 최소 기능부터 구현한다. 위치 생성/수정 권한이 계약에 없으면 S0의 Product 계약 결정 후 쓰기 기능을 연결한다.

수정 책임:
위치 전용 서비스/클라이언트 모듈, 신규 LocationPage·위치 선택 컴포넌트, 위치 전용 시험.

기술스택:
React·TypeScript·FastAPI·기존 PersistencePort·PostgreSQL. 부모·자식 관계와 재귀 조회는 정규화 저장 전환 단계에서 적용.

완료 기준:
프로젝트에 맞는 현장·동·층·구역·부재 계층을 지원하며 순환·타 프로젝트 연결을 거부한다. 위치 이동·이름 변경·보관 처리 후에도 기존 기록의 위치 의미가 유지된다.

특별 지침:
위치 ID는 공통계약을 재사용한다. 사진 GPS와 실내 위치는 별개의 정보로 다룬다. GPS/AR/QR/BIM은 초기 필수범위에 포함하지 않는다. 새 DB 테이블을 기존 스냅샷과 독립적으로 쓰지 말고 S0 저장소 전환 경계에 맞춘다.

하드웨어 제약:
개발서버와 추후 운영서버는 Mac mini M4·16GB 통합 메모리다. 운영계획 제10절을 읽고 이 제약을 구현·검증·인계에 반영하라. Linux 컨테이너는 ARM64로 빌드·실행 검증하고 amd64 에뮬레이션 통과만으로 완료 처리하지 마라. 병렬 채팅방/브랜치 수만큼 전체 서버 환경을 복제하지 마라. 개발용 공통 서비스는 공유하되 DB·객체 경로·큐·시험 데이터를 개발축별로 구분하라. 실제 운영 데이터와 개발 데이터를 섞지 마라. AI·영상 변환·문서 변환의 무거운 작업은 장비 전체에서 초기 동시 1건으로 제한하고 실측 후 조정하라. 업무 알림 처리는 무거운 작업과 분리해 지연을 검증하라. GPU 가속은 macOS 별도 서비스 또는 명시적으로 지원되는 실행기를 검증해야 하며 일반 Linux Worker 컨테이너가 Metal을 직접 사용한다고 가정하지 마라. RustFS는 개발용으로 연결하되 16GB 단일 서버 운영 채택은 부하·장애·복구 검증 조건부다. 공통 실행환경/의존성/자원 제한 변경은 S0와 조율하고 실측하지 않은 운영 성능을 보장하지 마라.

공통 규칙:
- main이 유일한 통합 기준선이다. 첫 작업 이후 새 작은 작업은 최신 main에서 새 브랜치를 만든다.
- app/schema, 공통 Engine/Persistence, main.py, OpenAPI/공유 타입/Facade, 라우터, 전역 스타일, 잠금 파일, Compose/CI/DB 변경은 S0에 변경 요청을 남기고 PR별 단일 담당을 정한다.
- Product 상태·권한·Gate·판정·종결 의미는 해당 채팅방에서 임의 변경하지 않는다. 기준서 48에 따라 S0의 Product/Functional 책임으로 먼저 확정한다.
- 기능 PR과 화면 PR은 기준서 25에 맞춰 작게 분리하되, 이 채팅방이 실제 화면 연결까지 책임진다.
- 웹의 pages/app/ui는 직접 fetch 또는 @doul/client 호출을 추가하지 않는다. SupervisionClient·ui-contract 경계를 따른다.
- 공통 의존성이 아직 병합되지 않았으면 독립 모듈·시험·명시적 Mock 화면 개발을 계속하되 실제 통합 완료로 표시하지 않는다.
- 의미 있는 변경 범위에 맞는 검증을 수행하고, 실제 사용하지 않은 저장소/판독/승인/현장검증을 완료로 선언하지 않는다.
- 브랜치·HEAD·변경 파일·의존 PR·검증·미연결 범위·S0 요청·다음 작업을 종료 보고에 남겨라.
```

### S4 — 통합 업무함

```text
이 채팅방은 DOUL Supervision S4 — 통합 업무함 전담 개발 채팅방이다.

저장소: https://github.com/bachelar-shy/DOUL_Supervision
첫 작업용 원격 브랜치: parallel/s4-work-inbox-v1
준비 시점 기준 main: 223bdfe7806e53c85df7fadbd967a5634e2b9edd
운영계획: https://github.com/bachelar-shy/DOUL_Supervision/blob/parallel/s0-integration-control-v1/55_Parallel_Development_Branches_and_Chat_Handoff_v1.md

최초 작업:
1. main의 동일 경로 운영계획을 우선 읽고 아직 병합되지 않았으면 위 S0 문서 URL을 읽어라. 해당 경로의 AGENTS.md와 최신 main·열린 PR·브랜치/로컬 변경 상태도 확인하라.
2. 기존 작업을 보존한 별도 worktree에서 담당 브랜치를 사용하라. 다른 채팅방의 checkout이나 이력을 바꾸지 마라.
3. 기존 구현을 재사용하고 이번 최소 기능의 범위·선행 의존관계를 정리한 뒤 구현·검증·커밋·푸시·작은 PR 준비까지 진행하라. main 병합은 S0 통합관리 채팅방에서 관리한다.

담당 목표:
역할별 통합 업무함

첫 구현 작업:
기존 실제 Safety·검측·시정·발주처 요청의 API를 확인하고, 담당자·기한·처리 상태를 모아 보여주는 읽기 전용 통합 업무함부터 구현한다. 화면은 기존 Today·Workbench를 재사용한다.

수정 책임:
업무함 조회 모듈, 업무함 전용 클라이언트, TodayPage.tsx·WorkbenchPage.tsx의 목록 기능, 목록 전용 시험.

기술스택:
React·TypeScript·기존 SupervisionClient·FastAPI·업무 Projection/조회 모델·PostgreSQL.

완료 기준:
사용자에게 허용된 프로젝트·역할·업무만 표시하고 항목 선택 시 원래 업무·정확한 명령 화면으로 이동한다. 원래 업무가 바뀌면 목록도 일관되게 갱신된다.

특별 지침:
업무함 자체에 Issue/Action/승인 상태기계를 만들지 않는다. 담당자·기한·완료 조건은 원래 업무가 관리한다. 알림의 읽음 상태를 업무 완료로 사용하지 않는다. 공통 CommandModal·라우터·Facade 변경은 S0에 요청한다.

하드웨어 제약:
개발서버와 추후 운영서버는 Mac mini M4·16GB 통합 메모리다. 운영계획 제10절을 읽고 이 제약을 구현·검증·인계에 반영하라. Linux 컨테이너는 ARM64로 빌드·실행 검증하고 amd64 에뮬레이션 통과만으로 완료 처리하지 마라. 병렬 채팅방/브랜치 수만큼 전체 서버 환경을 복제하지 마라. 개발용 공통 서비스는 공유하되 DB·객체 경로·큐·시험 데이터를 개발축별로 구분하라. 실제 운영 데이터와 개발 데이터를 섞지 마라. AI·영상 변환·문서 변환의 무거운 작업은 장비 전체에서 초기 동시 1건으로 제한하고 실측 후 조정하라. 업무 알림 처리는 무거운 작업과 분리해 지연을 검증하라. GPU 가속은 macOS 별도 서비스 또는 명시적으로 지원되는 실행기를 검증해야 하며 일반 Linux Worker 컨테이너가 Metal을 직접 사용한다고 가정하지 마라. RustFS는 개발용으로 연결하되 16GB 단일 서버 운영 채택은 부하·장애·복구 검증 조건부다. 공통 실행환경/의존성/자원 제한 변경은 S0와 조율하고 실측하지 않은 운영 성능을 보장하지 마라.

공통 규칙:
- main이 유일한 통합 기준선이다. 첫 작업 이후 새 작은 작업은 최신 main에서 새 브랜치를 만든다.
- app/schema, 공통 Engine/Persistence, main.py, OpenAPI/공유 타입/Facade, 라우터, 전역 스타일, 잠금 파일, Compose/CI/DB 변경은 S0에 변경 요청을 남기고 PR별 단일 담당을 정한다.
- Product 상태·권한·Gate·판정·종결 의미는 해당 채팅방에서 임의 변경하지 않는다. 기준서 48에 따라 S0의 Product/Functional 책임으로 먼저 확정한다.
- 기능 PR과 화면 PR은 기준서 25에 맞춰 작게 분리하되, 이 채팅방이 실제 화면 연결까지 책임진다.
- 웹의 pages/app/ui는 직접 fetch 또는 @doul/client 호출을 추가하지 않는다. SupervisionClient·ui-contract 경계를 따른다.
- 공통 의존성이 아직 병합되지 않았으면 독립 모듈·시험·명시적 Mock 화면 개발을 계속하되 실제 통합 완료로 표시하지 않는다.
- 의미 있는 변경 범위에 맞는 검증을 수행하고, 실제 사용하지 않은 저장소/판독/승인/현장검증을 완료로 선언하지 않는다.
- 브랜치·HEAD·변경 파일·의존 PR·검증·미연결 범위·S0 요청·다음 작업을 종료 보고에 남겨라.
```

### S5 — 알림·기한

```text
이 채팅방은 DOUL Supervision S5 — 알림·기한 전담 개발 채팅방이다.

저장소: https://github.com/bachelar-shy/DOUL_Supervision
첫 작업용 원격 브랜치: parallel/s5-notification-deadline-v1
준비 시점 기준 main: 223bdfe7806e53c85df7fadbd967a5634e2b9edd
운영계획: https://github.com/bachelar-shy/DOUL_Supervision/blob/parallel/s0-integration-control-v1/55_Parallel_Development_Branches_and_Chat_Handoff_v1.md

최초 작업:
1. main의 동일 경로 운영계획을 우선 읽고 아직 병합되지 않았으면 위 S0 문서 URL을 읽어라. 해당 경로의 AGENTS.md와 최신 main·열린 PR·브랜치/로컬 변경 상태도 확인하라.
2. 기존 작업을 보존한 별도 worktree에서 담당 브랜치를 사용하라. 다른 채팅방의 checkout이나 이력을 바꾸지 마라.
3. 기존 구현을 재사용하고 이번 최소 기능의 범위·선행 의존관계를 정리한 뒤 구현·검증·커밋·푸시·작은 PR 준비까지 진행하라. main 병합은 S0 통합관리 채팅방에서 관리한다.

담당 목표:
앱 내 알림·기한 점검·전달 재시도

첫 구현 작업:
기존 알림 기록·기한 규칙과 Outbox/Worker를 확인하고 실제 업무 이벤트 하나의 알림 생성·조회·읽음 처리부터 구현한다. 기한 알림은 지속 저장되는 별도 주기 작업으로 연결한다.

수정 책임:
알림 전용 서비스/클라이언트, 신규 NotificationPage, 알림 전용 작업 처리와 시험.

기술스택:
FastAPI·PostgreSQL의 이벤트/작업원장·Outbox·Redis Streams·Python Worker·React.

완료 기준:
업무 저장과 전달 이벤트가 일관되며 서버/Redis 재시작과 중복 전달에서도 동일 알림이 중복 생성되지 않는다. 알림 수신자 권한과 원래 업무 접근권한을 확인한다.

특별 지침:
미디어와 알림은 별도 큐 이름 공간/스트림으로 구분한다. 알림 추가 때문에 기존 미디어 전달·삭제 의미를 바꾸지 않는다. 기한을 임의 생성하거나 계약상 기한을 재해석하지 않는다. 도래·초과 알림은 원래 업무의 공식 상태를 자동 변경하지 않는다. 기술 장애 경보와 사용자 업무 알림을 구분한다. 첫 범위는 앱 내 알림이며 이메일/푸시는 후속 채널이다.

하드웨어 제약:
개발서버와 추후 운영서버는 Mac mini M4·16GB 통합 메모리다. 운영계획 제10절을 읽고 이 제약을 구현·검증·인계에 반영하라. Linux 컨테이너는 ARM64로 빌드·실행 검증하고 amd64 에뮬레이션 통과만으로 완료 처리하지 마라. 병렬 채팅방/브랜치 수만큼 전체 서버 환경을 복제하지 마라. 개발용 공통 서비스는 공유하되 DB·객체 경로·큐·시험 데이터를 개발축별로 구분하라. 실제 운영 데이터와 개발 데이터를 섞지 마라. AI·영상 변환·문서 변환의 무거운 작업은 장비 전체에서 초기 동시 1건으로 제한하고 실측 후 조정하라. 업무 알림 처리는 무거운 작업과 분리해 지연을 검증하라. GPU 가속은 macOS 별도 서비스 또는 명시적으로 지원되는 실행기를 검증해야 하며 일반 Linux Worker 컨테이너가 Metal을 직접 사용한다고 가정하지 마라. RustFS는 개발용으로 연결하되 16GB 단일 서버 운영 채택은 부하·장애·복구 검증 조건부다. 공통 실행환경/의존성/자원 제한 변경은 S0와 조율하고 실측하지 않은 운영 성능을 보장하지 마라.

공통 규칙:
- main이 유일한 통합 기준선이다. 첫 작업 이후 새 작은 작업은 최신 main에서 새 브랜치를 만든다.
- app/schema, 공통 Engine/Persistence, main.py, OpenAPI/공유 타입/Facade, 라우터, 전역 스타일, 잠금 파일, Compose/CI/DB 변경은 S0에 변경 요청을 남기고 PR별 단일 담당을 정한다.
- Product 상태·권한·Gate·판정·종결 의미는 해당 채팅방에서 임의 변경하지 않는다. 기준서 48에 따라 S0의 Product/Functional 책임으로 먼저 확정한다.
- 기능 PR과 화면 PR은 기준서 25에 맞춰 작게 분리하되, 이 채팅방이 실제 화면 연결까지 책임진다.
- 웹의 pages/app/ui는 직접 fetch 또는 @doul/client 호출을 추가하지 않는다. SupervisionClient·ui-contract 경계를 따른다.
- 공통 의존성이 아직 병합되지 않았으면 독립 모듈·시험·명시적 Mock 화면 개발을 계속하되 실제 통합 완료로 표시하지 않는다.
- 의미 있는 변경 범위에 맞는 검증을 수행하고, 실제 사용하지 않은 저장소/판독/승인/현장검증을 완료로 선언하지 않는다.
- 브랜치·HEAD·변경 파일·의존 PR·검증·미연결 범위·S0 요청·다음 작업을 종료 보고에 남겨라.
```

### S6 — 감리업무

```text
이 채팅방은 DOUL Supervision S6 — 감리업무 전담 개발 채팅방이다.

저장소: https://github.com/bachelar-shy/DOUL_Supervision
첫 작업용 원격 브랜치: parallel/s6-business-workflow-v1
준비 시점 기준 main: 223bdfe7806e53c85df7fadbd967a5634e2b9edd
운영계획: https://github.com/bachelar-shy/DOUL_Supervision/blob/parallel/s0-integration-control-v1/55_Parallel_Development_Branches_and_Chat_Handoff_v1.md

최초 작업:
1. main의 동일 경로 운영계획을 우선 읽고 아직 병합되지 않았으면 위 S0 문서 URL을 읽어라. 해당 경로의 AGENTS.md와 최신 main·열린 PR·브랜치/로컬 변경 상태도 확인하라.
2. 기존 작업을 보존한 별도 worktree에서 담당 브랜치를 사용하라. 다른 채팅방의 checkout이나 이력을 바꾸지 마라.
3. 기존 구현을 재사용하고 이번 최소 기능의 범위·선행 의존관계를 정리한 뒤 구현·검증·커밋·푸시·작은 PR 준비까지 진행하라. main 병합은 S0 통합관리 채팅방에서 관리한다.

담당 목표:
기존 MVP 감리업무·발주처 보고/결정

첫 구현 작업:
main에 있는 Safety·Schedule·Contract와 열린 PR를 확인해 기존 개발의 중복을 피한다. 첫 작업은 기존 안전 업무에서 도면·위치·증빙·업무함·알림 연결의 누락을 보완하는 것으로 잡고, 이후 공식 인계 순서와 실제 미완료 범위에 따라 기성·법규준수·인계를 진행한다.

수정 책임:
업무 전용 실행 서비스/클라이언트/화면/시험. SafetyPage·SchedulePage·ContractPage·OwnerGovernancePage는 필요한 변경만 수행하고 새 기성·법규준수·인계 화면은 별도 모듈로 추가한다.

기술스택:
기존 Domain/State/Authority 엔진·FastAPI·PersistencePort·PostgreSQL·React·공유 클라이언트·기존 문서출력 환경.

완료 기준:
안전 허가·중지·조치·명시적 재개가 기존 계약대로 동작하고 공통 증빙/위치/도면/업무함/알림과 연결된다. 필요한 발주처 보고·결정·회신·실행 확인을 추적하고 해당 종결 조건을 충족한다.

특별 지침:
안전 기능을 새로 복제하지 않는다. 발주처 보고는 독립 핵심 업무영역이며 정기보고·즉시보고·결정 요청·회신 추적을 포함한다. 보고의 읽음/수령과 승인/결정을 구분한다. 기성 금액은 Decimal string 계약을 사용하고 claimed/verified/recommended/ownerApproved/paid를 합치지 않는다. 업무 의미 변경은 S0 안의 Product/Functional 책임으로 먼저 회수한다.

하드웨어 제약:
개발서버와 추후 운영서버는 Mac mini M4·16GB 통합 메모리다. 운영계획 제10절을 읽고 이 제약을 구현·검증·인계에 반영하라. Linux 컨테이너는 ARM64로 빌드·실행 검증하고 amd64 에뮬레이션 통과만으로 완료 처리하지 마라. 병렬 채팅방/브랜치 수만큼 전체 서버 환경을 복제하지 마라. 개발용 공통 서비스는 공유하되 DB·객체 경로·큐·시험 데이터를 개발축별로 구분하라. 실제 운영 데이터와 개발 데이터를 섞지 마라. AI·영상 변환·문서 변환의 무거운 작업은 장비 전체에서 초기 동시 1건으로 제한하고 실측 후 조정하라. 업무 알림 처리는 무거운 작업과 분리해 지연을 검증하라. GPU 가속은 macOS 별도 서비스 또는 명시적으로 지원되는 실행기를 검증해야 하며 일반 Linux Worker 컨테이너가 Metal을 직접 사용한다고 가정하지 마라. RustFS는 개발용으로 연결하되 16GB 단일 서버 운영 채택은 부하·장애·복구 검증 조건부다. 공통 실행환경/의존성/자원 제한 변경은 S0와 조율하고 실측하지 않은 운영 성능을 보장하지 마라.

공통 규칙:
- main이 유일한 통합 기준선이다. 첫 작업 이후 새 작은 작업은 최신 main에서 새 브랜치를 만든다.
- app/schema, 공통 Engine/Persistence, main.py, OpenAPI/공유 타입/Facade, 라우터, 전역 스타일, 잠금 파일, Compose/CI/DB 변경은 S0에 변경 요청을 남기고 PR별 단일 담당을 정한다.
- Product 상태·권한·Gate·판정·종결 의미는 해당 채팅방에서 임의 변경하지 않는다. 기준서 48에 따라 S0의 Product/Functional 책임으로 먼저 확정한다.
- 기능 PR과 화면 PR은 기준서 25에 맞춰 작게 분리하되, 이 채팅방이 실제 화면 연결까지 책임진다.
- 웹의 pages/app/ui는 직접 fetch 또는 @doul/client 호출을 추가하지 않는다. SupervisionClient·ui-contract 경계를 따른다.
- 공통 의존성이 아직 병합되지 않았으면 독립 모듈·시험·명시적 Mock 화면 개발을 계속하되 실제 통합 완료로 표시하지 않는다.
- 의미 있는 변경 범위에 맞는 검증을 수행하고, 실제 사용하지 않은 저장소/판독/승인/현장검증을 완료로 선언하지 않는다.
- 브랜치·HEAD·변경 파일·의존 PR·검증·미연결 범위·S0 요청·다음 작업을 종료 보고에 남겨라.
```


## 10. Mac mini M4·16GB 기술스택 및 실행 기준

### 10.1 판단과 범위

기본 업무앱 스택은 유지한다. React 정적 웹·FastAPI·PostgreSQL·Redis를 중심으로 개발과 초기 시범운영 후보를 구성할 수 있다. 다만 현재 저장소를 확인한 결과와 공식 문서만으로 실제 Mac mini의 처리량·동시 사용자 수·운영 안정성을 보장하지 않는다. 장비와 실제 업무 표본으로 부하·재시작·백업 복원 검증을 수행한 뒤 운영 범위를 정한다.

개발서버와 운영서버가 각각 별도 Mac mini라면 실행환경과 데이터를 분리한다. 한 대를 함께 사용하는 경우, DB 이름이나 Compose 프로젝트 분리만으로 CPU·메모리 경합이 해결되지는 않는다. 운영 요청 처리 중 전체 빌드·Browser E2E·대량 AI 실험을 함께 실행하지 않는 작업시간 정책이 필요하다.

### 10.2 기능별 스택과 하드웨어 책임

| 개발축 | 기술스택 | M4·16GB 적용 기준 |
|---|---|---|
| S0 통합관리 | 기존 Docker Compose·GitHub Actions·경량 로그/상태 점검 | ARM64 빌드/실행, 자원 상한, 공통 개발 서비스, 재기동·복구를 조율 |
| S1 도면·문서 | React·PDF.js·SVG·FastAPI·PostgreSQL·파일 저장 Port | 도면 표시는 사용자 브라우저에서 수행. 큰 도면의 전체 페이지 동시 렌더·서버 일괄 래스터화를 피하고 지연 로딩을 검증 |
| S2 증빙·미디어 | Expo/React Native·SQLite·FastAPI·boto3·RustFS 개발환경·Pillow·FFmpeg/ffprobe·기존 Worker | 원본 업로드/해시를 분할·스트리밍 처리. 미디어 변환 동시 1건부터 시작. macOS 가속과 AI는 별도 제공자 경계 |
| S3 위치 | 기존 React·FastAPI·PersistencePort·PostgreSQL | 초기 위치 트리에는 별도 GIS/BIM 서버를 추가하지 않음. 계층 규모에 맞는 부분 조회·프로젝트 범위 검증 |
| S4 통합 업무함 | 기존 UI/Facade·FastAPI·조회 Projection·PostgreSQL | 페이지 단위 조회·불필요한 전체 업무 재계산/빈번한 폴링 제한. 공식 상태는 원래 업무가 소유 |
| S5 알림·기한 | PostgreSQL 작업원장/Outbox·별도 Redis Streams·경량 Python Worker | 미디어 큐와 분리. 제한된 배치·재시도·보관 정책. 무거운 작업 중에도 기한 알림 지연을 확인 |
| S6 감리업무·보고 | 기존 업무 엔진·FastAPI·PostgreSQL·React·python-docx/LibreOffice/Poppler | 보고 생성/변환을 제한된 작업으로 처리. 기존 API 안의 출력환경을 곧바로 병렬 확장하지 말고 응답 영향·시간제한·복구를 검증 |

초기에 Kubernetes·Kafka·별도 검색 클러스터를 필수 구성으로 추가하지 않는다. 기능별 채팅방 분리는 소스코드 책임 분리이며 마이크로서비스 6개 또는 전체 서버 환경 6세트를 뜻하지 않는다.

### 10.3 공통 실행 프로필

- 웹 운영은 사전 빌드한 정적 파일을 기존 Nginx 이미지로 제공한다. Vite 개발서버·전체 빌드·테스트 브라우저를 운영 상시 프로세스로 두지 않는다.
- API는 단일 프로세스부터 시작한다. 현재 전체 스냅샷/쓰기 직렬화 저장 방식의 일관성·메모리·잠금 대기를 먼저 측정하고, 프로세스 수를 늘리기 전에 S0가 저장 경계를 확인한다.
- 개발용 PostgreSQL·Redis·객체 저장소는 하나의 공통 서비스 구성을 우선 사용한다. 각 개발축은 독립 DB/시험 데이터·객체 경로 또는 버킷·큐 이름 공간·API 포트를 배정받아 서로의 시험 상태를 덮어쓰지 않는다. 이는 개발환경 격리이며 기능별 운영 DB를 새로 만드는 지시가 아니다.
- 통합환경에서 전체 서버를 사용하는 E2E·migration·복구 검증은 예약하여 한 번에 한 개발축이 실행한다. 독립 단위시험·코드 작성은 병렬로 계속한다.
- 전체 빌드와 Browser E2E는 초기 동시 1건, 필요하면 실측 후 2건으로 조정한다. 무거운 CI는 기존 원격 CI를 활용하되 최종 ARM64 실행검증을 생략하지 않는다.
- AI 추론·영상 변환·문서 변환은 장비 전체에서 초기 동시 1건부터 시작한다. 각 큐에 concurrency=1을 따로 설정하면 서로 다른 큐의 무거운 작업이 동시에 실행될 수 있으므로 공통 실행 허가/임대 경계를 S0가 정한다. 경량 업무 알림은 별도 처리한다.
- Docker Desktop VM 메모리는 6~8GB 범위를 최초 실험값으로 삼을 수 있다. 이는 측정된 요구량이나 운영 확정값이 아니다. macOS·브라우저·편집기·네이티브 모델의 메모리도 함께 측정하고 VM/서비스별 CPU·메모리/DB 연결 상한을 조정한다.
- 기존 Worker 실행은 직렬 루프다. 환경변수 값을 변경하는 것만으로 병렬 Worker가 구현되었다고 간주하지 말고 실제 실행 수·lease·재시도 동작을 확인한다.

Docker 공식 문서상 macOS의 Linux 컨테이너는 VM 자원을 사용하고 기본 메모리 설정은 호스트 메모리의 50%다. Apple Silicon의 CPU/GPU는 통합 메모리를 공유하므로 16GB에 별도 GPU 메모리가 추가된 것으로 예산을 계산하지 않는다.

### 10.4 미디어·AI와 객체 저장소

AI는 현재 실제 제공자가 미연결이다. ProviderPort를 유지하면서 macOS 네이티브 WhisperKit/MLX 또는 적합성이 검증된 실행기를 후보로 검증한다. 음성 전사와 이미지 판독 모델을 모두 상시 적재하는 구성을 기본값으로 삼지 않는다. 모델 크기·양자화·문맥/입력 크기·최대 메모리·한국어/현장 표본 정확도를 함께 확인한다. 무거운 영상 판독은 비동기 대기열로 처리하며 검증 없이 실시간 처리 시간을 약속하지 않는다. 외부 제공자를 선택하는 경우에는 프로젝트 데이터 반출 조건과 비용을 확인한 뒤 같은 Port에 연결한다.

일반 Docker Linux 컨테이너의 GPU passthrough를 macOS Metal 지원으로 해석하지 않는다. Docker Model Runner는 Apple Silicon을 지원하지만 macOS에서 추론 엔진은 Linux 컨테이너 안이 아닌 호스트의 격리 환경에서 동작한다. 채택 시 제공 모델·보안 경계·자원 통제의 별도 검증이 필요하다. 현재 Worker가 자동으로 해당 실행기를 사용한다는 뜻은 아니다.

FFmpeg는 Linux ARM64 CPU 처리부터 검증할 수 있다. VideoToolbox 가속을 사용할 때는 macOS 네이티브 실행을 별도 서비스/어댑터로 연결하고 배포·재시작을 관리한다. 처리 동시성·스레드 수·출력 해상도를 제한하되 원본·실제 프레임 표시시각·분석 범위는 보존한다. 일부 프레임 분석을 전체 프레임 분석으로 표시하지 않는다.

RustFS는 개발/시험환경에서 유지한다. 공식 하드웨어 문서는 시험환경에 ARM·1GB 이상·1노드를, 운영환경에 64GB 이상·4노드 이상·Linux 권장을 제시한다. 따라서 16GB 단일 Mac mini를 해당 운영 권장 구성으로 간주하지 않는다. 이 표가 모든 단일 노드가 항상 64GB를 소비한다는 뜻도 아니다.

운영 RustFS 채택은 실제 사진/영상 크기·동시 업로드·다운로드·프로세스 강제종료·재시작·백업 복원에서 메모리와 원본 무결성을 확인한 후 결정한다. 조건을 충족하지 못하면 같은 ObjectStoragePort를 통해 별도 저장장치/저장서버 또는 외부 S3 호환 저장소로 옮길 수 있게 유지한다. NAS 파일 저장은 S3와 동일한 API가 아니므로 별도 어댑터와 권한/원본 검증이 필요하다. 단일 서버·단일 디스크는 고가용성 구성이 아니며 향후 확장 시 데이터 이동 계획을 둔다.

### 10.5 운영 적합성 검증과 저장

현재 확인한 operational Compose에는 서비스별 CPU·메모리 상한이 없으며, 컨테이너 CI에는 명시적인 ARM64 빌드·실행 단계가 없다. Linux CI 성공만으로 Mac mini 적합성을 선언하지 않는다. S0의 작은 기반 PR로 다음을 검증한다.

1. API·Worker·PostgreSQL·Redis·RustFS·웹·문서출력 이미지와 Python native dependency가 linux/arm64로 빌드·실행된다. digest로 고정한 이미지도 실제 선택된 manifest의 아키텍처를 확인한다. 실행 중 amd64 에뮬레이션에 의존하는지 기록한다.
2. 실제 업무 데이터 규모·도면 페이지/크기·사진 크기·영상 길이/해상도·목표 동시 사용자/업로드 수를 먼저 정한다. 이 값 없이 임의의 수용 사용자 수를 선언하지 않는다.
3. 해당 표본으로 평상시 업무와 무거운 작업을 함께 실행하고 호스트/VM/각 프로세스의 최대 메모리·메모리 압력·swap 증가·API 응답시간·잠금 대기·작업/알림 대기시간을 기록한다. 무거운 작업의 대기·타임아웃·실패 복구도 확인한다.
4. 원본·DB·파생물·모델·로그·임시 출력물의 디스크 사용과 증가량을 측정한다. 내장 SSD 용량은 아직 확인되지 않았으므로 영상 보관 가능 기간을 확정하지 않는다. 작업 종료 후 임시파일 정리와 안전한 파생물 보관 정책을 검증한다.
5. Mac 재부팅·전원 복구 후 VM/컨테이너·네이티브 서비스·DB·큐 작업이 복구되는지 확인한다. 절전·자동시작·네트워크/TLS 조건도 실제 운영환경에서 확인한다.
6. DB와 원본 객체를 별도 장치/위치에 백업하고 복원 시험을 수행한다. 같은 물리 디스크의 다른 폴더는 장애 대비 백업으로 간주하지 않는다. 단일 서버 장애 시 중단을 수용할 수 있는지와 복구 목표를 운영 범위에 기록한다.

이 검증은 목표 운영 범위를 확정하기 위한 것이며 현재 문서 수정으로 서버 설정·모델 연결·운영 배포가 완료된 것은 아니다.

### 10.6 공식 근거

검토일: 2026-10-07. Docker·RustFS·MLX는 Context7 공식 문서 조회와 원문을 함께 확인했다.

- [Docker Desktop 자원 설정](https://docs.docker.com/desktop/settings-and-maintenance/settings/)
- [Compose 서비스별 mem_limit·cpus](https://docs.docker.com/reference/compose-file/services/)
- [Docker multi-platform 및 에뮬레이션](https://docs.docker.com/build/building/multi-platform/)
- [Docker Linux 컨테이너 GPU passthrough 범위](https://docs.docker.com/desktop/features/gpu/)
- [Docker Model Runner의 Apple Silicon 지원·macOS 실행환경](https://docs.docker.com/ai/model-runner/)
- [MLX 통합 메모리](https://ml-explore.github.io/mlx/build/html/usage/unified_memory.html)
- [RustFS 하드웨어 선택](https://rustfs.org/installation/checklists/hardware-selection)
- [FFmpeg VideoToolbox](https://ffmpeg.org/ffmpeg-all.html)
- [WhisperKit 공식 저장소](https://github.com/argmaxinc/argmax-oss-swift)
