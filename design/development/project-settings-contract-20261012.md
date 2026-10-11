# 프로젝트 설정 · C1 호환 확장

사용자 요청: “프로젝트 설정화면 구현해”, “moc 데이타가 쓰인 테스트 프로젝트를 넣어놔”, “관리자/감리자/발주처/시공사 이렇게 4가지”. 교육자료와 다국어 전수 검토는 이번 범위에서 진행하지 않는다.

## 기능과 권한

- 관리자 설정 화면은 기본정보, 참여회사·담당자, 작업범위, 업무배정, 로그인계정 다섯 탭이다.
- `GET /projects/{projectId}/settings`와 `POST /projects/{projectId}/settings/commands/{command}`는 현재 사용자·기간·프로젝트 배정을 재검증하고 기존 `manage_project_roles` 권한과 명시적 프로젝트 전체 범위를 요구한다.
- 등록/선택 역할은 관리자 ADM/project_admin, 감리자 SUP/chief_supervisor, 발주처 OWN/owner_decision_maker, 시공사 CON/contractor_technical_lead다. 기존 DES 기록·감사·공식 참조는 보존하고 신규 선택에서는 제외한다.
- 회사/담당자 추가, 기본정보, 공사범위/구역, 기본 업무범위와 다른 담당자의 배정만 변경한다. 워크플로·공식 승인·기존 자격증·종결조건을 변경하지 않는다. 신규 담당자의 `qualificationIds`는 빈 배열이다.
- 공종·공사범위·구역은 해당 프로젝트에 등록된 값만 배정한다. ADM에만 명시적 `*`를 허용하며 접속한 관리자 본인의 배정은 HTTP에서 변경하지 못한다.
- 현장 시간대의 시작일/종료일을 서버 시간 범위로 저장한다. 자격 등급 1이 가장 엄격하며 기존 공종/전체 규칙을 완화할 수 없다.
- 모든 설정 명령은 Project expectedVersion과 Idempotency-Key를 사용한다. Project와 수정된 객체의 이력·감사 및 결과 재시도를 한 트랜잭션에 저장한다. 미허용 필드는 거부한다.

## 프로젝트 전환과 합성 자료

- `/auth/projects`는 현재 계정의 승인된 활성 프로젝트 배정만 반환한다. `/auth/project-session`은 projectId만 받고 서버의 승인 membership으로 새 JWT를 발급한다. 브라우저가 Party·Role·권한을 지정하지 못한다.
- 이전 토큰은 폐기하고 프로젝트/사용자 경계를 재검증한다. 이전 401 및 지연 로그아웃이 새 세션을 지우지 않게 방어한다.
- 운영자 `scripts/install_site_test_project.py`는 syntheticData=true인 staging에만 설치한다. 별도 Project·회사·담당자·검측/시정/보고 예시·측정자료·PDF·기존 합성 이미지를 추가한다. 파일럿에 설치할 수 없다.
- 합성 자격/승인/증빙은 테스트 프로젝트 안의 fixture다. 실제 사용자·공사 증빙·인수 근거로 간주하지 않으며 항상 “합성 테스트 자료 · 실제 현장 증빙 아님”으로 표시한다.
- 기존 실제 프로젝트와 비밀번호/identity binding을 보존한다. 필요한 프로젝트 membership만 명시적으로 연결한다. 재실행은 객체를 중복 생성하거나 다른 membership을 교체하지 않는다.
- 운영 중 초기 관리자에게 전체 설정 범위를 부여하는 일회성 작업은 DB 백업 후 `--enable-project-settings --approval-ref <사용자 요청 참조>`로 실행한다. 이전 RoleAssignment 버전과 운영자 감사 이벤트를 남긴다. 기술 자격을 추가하지 않는다.

## 인수 근거

- AC-SET-01: 기본정보 저장·재로그인/재시작 후 유지.
- AC-SET-02: 네 역할과 회사·담당자·계정 연결, 내부 코드/UUID 표시 제거.
- AC-SET-03: 미허용 입력·자격 기준 완화·자기 배정 수정·다른 프로젝트 접근 거부.
- AC-SET-04: 충돌 후 입력 유지, 멱등 재시도 및 과거 버전/감사 보존, 오프라인 저장 차단.
- AC-SET-05: 승인된 프로젝트 세션 전환·이전 토큰 폐기·합성 표기·PDF 조회.
- AC-SET-06: staging 합성 설치 멱등, 기존 기록 보존, pilot 거부.

자동 시험은 `tests_mvp/test_project_settings_http.py`, `scripts/test_project_session_races.mjs`, `playwright.project-settings.config.ts` 및 기존 비밀번호/field-core 회귀에 있다. 연결 브라우저는 실제 HTTPS·비밀번호·JWT·API·격리된 SQLite를 사용한다. 실제 서버의 PostgreSQL/Tailscale 확인과 실제 현장 파일럿은 별도 근거다.

PCR-2026-003은 C1 호환 확장의 v1.2 후보 변경기록이다. 사용자 요청에 따른 구현 승인과 전체 Product Baseline의 공식 릴리스 채택을 구분한다. 이 기록이나 staging 배포만으로 현장 인수 또는 기준선 전체 채택을 선언하지 않는다.
