# 프로젝트 설정 개발 인계 — 2026-10-12

## 최신 상태 — 여기부터 재개

- 브랜치 `feat/project-settings-20261012`, PR https://github.com/bachelar-shy/DOUL_Supervision/pull/188 (draft; PR #187 기반). 구현 및 현재 서버 소스 `04538aa`. 작은 커밋은 GitHub에 push되어 있다.
- **프로젝트 설정 및 네 역할 선택, 별도 합성 테스트 프로젝트가 실제 Tailscale 서버에 적용됐고 실제 HTTPS 검증까지 통과했다.** URL https://automation-macmini.tail0e9ef7.ts.net:10001/ . admin 계정은 기존 비밀번호를 유지하며 비밀번호는 인계/소스에 기록하지 않는다.
- `프로젝트 설정` 메뉴에서 다섯 설정 탭을 사용한다. 계정 역할은 관리자·감리자·발주처·시공사 네 가지를 고르고 그 역할에 등록된 담당자를 선택한다. 원래 프로젝트에는 admin만 있으므로 다른 담당자는 먼저 등록한다. 별도 테스트 프로젝트에는 네 역할의 합성 담당자와 측정기록, 검측/시정/보고, PDF와 합성 이미지가 있다.
- 맥미니 native: 설정 HTTP/비밀번호15, 세션순서4, 실제 HTTPS 연결 desktop/phone12, 기존 비밀번호5, field-core29 통과. 후속 계정 역할 필터 변경도 desktop/phone12 및 타입·빌드·lint(90 warnings/0 errors) 통과.
- 실제 서버: admin 로그인, 일곱 메뉴(오늘+현장 다섯+설정), 네 역할, 설정 저장, 프로젝트 왕복 전환/합성 배너 격리, PDF 렌더링, 390px 가로 넘침 없음/44px 역할 선택, JS errors 0 / HTTP5xx 0. 실제 API에서 이전 토큰401·교차 프로젝트404·멱등 재시도·409 충돌·로그아웃401 검증. API 재시작 후 PostgreSQL 설정과 감사 유지 및 기존 Project 버전1 보존 확인.
- **전체 GitHub 회귀 CI는 아직 미통과.** HEAD 04538aa: project-settings, local-adapter-and-ui, contracts, 전용 러너 정책 등은 성공. sample-project-verification, translation-check, browser-integration shards 1~6 실패. 병합/전체 Goal 완료를 선언하지 않는다.
- 다음 작업은 이 CI 실패 로그를 분석해 재현/수정하고 관련 검증을 통과시키는 것이다. 로그는 맥미니 `/tmp/doul-settings-ci-browser.log`, `/tmp/doul-settings-ci-sample.log`, `/tmp/doul-settings-ci-translation.log`; run IDs 38168197995 / 38168198010 / 38168197991. 각 수정은 작은 커밋과 이 인계 갱신으로 이어간다.
- 실제 서버 private 근거: `/Users/automation/work/DOUL-operational-runtime/20261012/project-settings-verification.json`, `settings-api-verification.json`, `settings-deployment.json`. DB 백업과 이전 UI를 `backups/`에 보존했다. 이 파일들은 private이고 Git에 올리지 않는다. source worktree `/Users/automation/work/doul-project-settings-20261012`; `preview/` 사용자 산출물을 보존한다.
- Goal 사용량 회복 자체가 자동 재실행을 보장하지 않는다. 새 채팅에서는 이 파일과 Git/PR/실제 서버 상태를 읽고 미완료 CI부터 재개한다. 완료한 구현/설치를 반복하거나 DB·미커밋 변경을 삭제하지 않는다.

## 요청과 작업 범위

- 프로젝트 설정 화면과 실제 저장 API 구현.
- 역할 선택은 관리자(ADM)·감리자(SUP)·발주처(OWN)·시공사(CON) 네 가지. 내부 역할 코드·UUID는 사용자 화면에서 숨긴다. 기존 설계자/자료출처 기록은 삭제하지 않는다.
- 합성 자료가 포함된 테스트 프로젝트를 별도로 넣고, 실제 프로젝트와 구분하여 선택한다.
- 작은 단위로 커밋·push하고 인계를 갱신한다. 중단된 작업을 완료로 선언하거나 미커밋 변경을 삭제하지 않는다.

## 브랜치와 환경

- 저장소: `bachelar-shy/DOUL_Supervision`
- 작업 브랜치: `feat/project-settings-20261012`
- 기반 커밋: `ac46551f775f5e0264dc0821cd0241d2adc7bf61` (PR #187, 아직 미병합)
- 클라우드 worktree: `/tmp/doul-project-settings-20261012`
- 맥미니 기반 worktree: `/Users/automation/work/doul-field-entry-20261012`
- 운영준비 서버: `https://automation-macmini.tail0e9ef7.ts.net:10001/` (Tailscale 전용); 기존 `http://100.68.153.58:5190/`은 여기로 연결.
- 현재 서버 소스는 `eb3e34bd8cb92d50db58d4d2f55291d01b3fc15f`. **이번 프로젝트 설정 변경은 아직 배포하지 않았다.**
- 관리자 로그인은 이미 만들어져 있다. 비밀번호·DB 접속 비밀정보·서명 키를 이 파일이나 Git에 기록하지 않는다.
- 실제 서버의 private runtime/LaunchAgents/백업 인계: `/Users/automation/work/DOUL-operational-runtime/20261012/HANDOVER.txt`.

## 중간 구현 — 검증 전

- `services/api/modules/project_settings.py`: 기존 `manage_project_roles` 서버 권한을 재검사하는 설정 조회·명령 API. 기본정보, 회사·담당자, 공사범위·작업구역, 기본 업무범위, 다른 담당자의 배정 수정. 버전 충돌·멱등 재시도·감사/과거 버전 보존.
- `services/api/main.py`: 설정 모듈 설치 및 프로젝트별 기본 업무범위 읽기.
- `apps/web/src/data/*`: 화면 계약·HTTP facade 및 저장 불가 mock adapter 확장.
- `packages/client/src/index.ts`: 프로젝트 선택 세션 API 클라이언트와 늦게 도착한 이전 토큰의 401 응답이 새 세션을 지우지 않도록 방어.
- 자격등급은 **숫자가 작을수록 엄격**하다. 설정이 기존 자격 기준을 완화하지 않게 유지한다. 담당자 추가로 검증된 자격이나 기술승인을 만들어내지 않는다.

## 남은 작업과 재개 절차

1. Git 상태·인계·각 브랜치 최신 커밋을 확인한다. 첫 체크포인트 `0c1b055`는 GitHub에 올라가 있다. 다음 체크포인트에 설정 화면 5개 탭 및 승인된 프로젝트 세션 API를 포함했다. 아직 배포하지 않았고 신규 경로 시험은 남아 있다. 현재 중간 코드는 API 단위검증 및 타입검사 전이다.
2. 설정 API 오류 입력/권한/테넌트 경계/버전·재시도/감사·지속성 시험을 추가하고 구현을 정리한다. 현재 현장 전체 설정은 명시적인 프로젝트 전체 관리자 범위를 요구한다. 기존 서버 admin의 빈 범위를 HTTP에서 몰래 확장하지 않는다. 사용자 요청에 따른 일회성 운영자 배정은 기존 버전·감사를 보존해 별도로 수행한다.
3. `AdminPage`를 실제 프로젝트 설정 화면으로 교체한다. 기본정보/회사·담당자/작업범위/업무배정/로그인 계정을 연결하고 오프라인·저장실패·충돌·작은 화면을 처리한다. 메뉴 이름은 프로젝트 설정. 역할 선택과 화면은 요청한 네 가지 실무 용어만 사용한다.
4. 비밀번호 사용자에게 서버가 승인한 프로젝트 목록과 프로젝트 전환 세션을 제공한다. `PinnedJWT.session`과 `role_for`의 프로젝트별 승인 membership 확인 및 `/auth/projects`, `/auth/project-session` 구현은 완료했으나 신규 경로의 회귀 시험과 프로젝트 선택 UI가 남아 있다. 클라이언트가 Party/Role/권한을 정해서 로그인하지 않게 한다.
5. 합성 테스트 프로젝트를 운영자 도구로 멱등 설치한다. `staging`에서만 허용하고 실제 프로젝트 기록·승인과 섞거나 pilot에 설치하지 않는다. 별도 프로젝트 ID/Party/Role/자료/업무범위와 명확한 합성자료 표기를 사용한다. 관리자 계정에는 명시적 프로젝트 membership만 연결한다.
6. 맥미니 별도 worktree에서 잠금파일 의존성을 설치하여 UI 경계·타입·lint·build 및 API/브라우저 검증. UI mock은 실제 저장을 흉내내지 않는다. CI는 맥미니의 `[self-hosted, Linux, ARM64, doul-macmini]` 러너 사용. queued Actions를 통과라고 기록하지 않는다.
7. 검증 뒤 private runtime을 백업하고 새 빌드/API에 순차 적용한다. 실제 admin 로그인, 설정 저장·재시작 후 유지, 테스트 프로젝트 전환·테넌트 격리·합성표시를 확인한다. 기존 MCP 8788 및 Tailscale 443/10000/10002/10003/8443는 변경하지 않는다.
8. 커밋·push·PR·검증 결과와 이 파일을 갱신한다. PR #187 미병합 상태를 고려해 새 PR을 쌓거나 main 병합 후 기준을 정리한다.

## 추가 체크포인트 (검증 중)

- `c62a6f4`: 설정 화면 다섯 탭과 프로젝트별 승인 세션 구현; GitHub push 완료.
- 프로젝트 선택 UI 및 합성 프로젝트 운영자 설치 도구 구현. 기존 관리자 범위는 명시적 옵션으로만 감사/버전을 보존하며 확장한다. 실제 프로젝트 자료는 추가하지 않는다.
- 신규 비밀번호/JWT HTTP 검증 8개: 설정 저장·재시도·충돌·이력·재시작, 네 역할, 회사·담당자·범위, 권한 거부, 프로젝트 격리·전환, 합성 설치 멱등/파일럿 거부. 클라우드에서 통과. 검증 게이트는 모킹하지 않았다.
- 다음: 맥미니 HEAD `43d0e6d` 타입/lint/build 통과 (lint 91 warnings, 0 errors, 기존 경고 포함). 새 실제 API 연결 HTTPS 브라우저 fixture/desktop·phone 시험을 커밋했다. 다음은 이 시험 실행, private DB 백업과 실제 서버 반영. 아직 운영 서버에 적용되지 않았다.

최종 확인 전까지 프로젝트 설정 구현 및 실제 현장 인수를 완료로 표시하지 않는다.

## 브라우저 시험 보정과 다음 체크포인트

- `40c14da`, `69eb348`: 실제 HTTPS 브라우저 시험 추가 및 선택 항목 조회 보정. 맥미니 15 API 시험 통과. 브라우저 12개 중 10개 통과, 로그아웃 직후 다른 사용자 로그인 2개는 재시험 중. 미통과를 완료로 기록하지 않는다.
- 선택 항목은 접근성 combobox로 찾고, 멱등 키는 ASCII UUID를 사용하며 PDF는 실제 원본을 선택한 뒤 렌더링을 검증한다.
- 이전 요청의 401 및 늦은 로그아웃 응답이 새 프로젝트/로그인 세션을 지우지 않도록 클라이언트를 보강했다. 네 가지 세션 응답 순서 시험 추가.
- 신규 프로젝트 설정 CI도 `[self-hosted, Linux, ARM64, doul-macmini]`에서 수행하도록 추가했고 전체 25개 workflow 정책 검사 통과.
- 다음 실행: `VITE_DOUL_AUTH_MODE=password npm run web:build`; `npx playwright test -c playwright.project-settings.config.ts`; 비밀번호/field-core 회귀, private DB 백업 후 운영준비 서버 적용. 실제 배포는 아직 하지 않았다.

## 검증 완료 · 배포 직전 체크포인트

- PR: https://github.com/bachelar-shy/DOUL_Supervision/pull/188 (draft, base PR #187의 브랜치).
- GitHub push: `75e2b29`까지 완료. 맥미니 작업 worktree `/Users/automation/work/doul-project-settings-20261012`. 새 worktree의 사용자/다른 작업자 `preview/`는 삭제하지 않는다.
- 실제 HTTPS·API 연결 브라우저 desktop/phone 12개 **전부 통과**. 계정 등록→감리자 로그인→관리자 설정 403, 기본정보 유지, 네 역할, 회사·담당자, 충돌 입력 보존, 오프라인 차단, 프로젝트 전환 및 PDF 렌더링을 확인했다.
- 기존 비밀번호 화면 5개, field-core 29개 통과. 설정/비밀번호 API 15개, 세션 응답 순서 4개 통과. 맥미니 타입·빌드·UI 경계 검사 통과. lint 기존 90 warnings / 0 errors. 신규 CI 포함 전체 25 workflow 러너 정책 통과.
- C1 계약과 PCR-2026-003을 기록했다. 사용자 지시 범위의 구현 승인과 전체 Product Baseline v1.2 후보 릴리스 채택/현장 인수는 별개다.
- 실제 PostgreSQL 백업 `.../DOUL-operational-runtime/20261012/backups/pre-project-settings-20261012.dump` 생성 완료 (private, 0600).
- 다음: 현재 커밋 맥미니 동기화, operator staging 설치(--enable-project-settings, 승인 참조), 새 source/API 및 정적 UI 적용, 실제 Tailscale 로그인/저장/전환/재시작 검증. **아직 서버 적용 전이다.**

## 실제 서버 적용 및 후속 UI 체크포인트

- `43b4aec`를 실제 서버에 반영했다. Source는 새 맥미니 worktree이고 API health의 baseCommit도 일치한다. 기존 프로젝트 기본정보는 변경하지 않았다.
- 실제 Tailscale HTTPS API: 두 승인 프로젝트, 프로젝트 전환/기존 토큰401/교차 프로젝트404, 설정 저장·멱등 재시도·409 충돌·로그아웃401 확인. 기존 admin에 기술 자격은 없으며 authority는 manage_project_roles/render_document만 유지한다.
- 실제 브라우저는 설정·네 역할·테스트 PDF 렌더링까지 확인했지만 기존 프로젝트로 돌아올 때 비동기 전환을 기다리는 절차를 보정하여 재확인 중이다. 아직 최종 브라우저 PASS로 기록하지 않는다.
- 계정 생성 화면에도 네 역할을 먼저 고르는 선택란을 추가하고 해당 역할의 등록된 담당자만 표시한다. 실제 프로젝트에 ADM 한 명만 있어도 네 역할 선택은 보이며 나머지 담당자는 먼저 등록한다. 이 후속 UI 변경은 아직 검증/배포 전이다.

## 전체 회귀 원인과 수정 체크포인트

- 새 설정 화면 교체에서 기존 DOUL SAMPLE 검증 패널이 누락됐음을 확인, 명시적 full 범위의 개발 demo에서만 복구했다. 실제 비밀번호 서버에는 진단 패널을 노출하지 않는다.
- 번역 미리보기 컴포넌트가 문서 편집기에 연결되어 있지 않았다. 기존 컴포넌트를 full 범위 편집기에 다시 연결하며 새로운 번역/언어 검수 범위는 확장하지 않는다.
- CommandEvidencePicker가 기존 증빙번호 textarea를 고급 입력에 숨긴 뒤 폐쇄흐름 시험들이 옛 필드를 찾고 있었다. 시험은 보이는 증빙 체크박스를 사용하고 목록에 없는 검증용 번호만 명시적 고급 입력을 사용하도록 정리한다. HTTP 결과/버전/권한/증빙 검증은 유지한다.
- 합성 배너 문구 기대를 현재 표시로 맞추고 관리자 화면 대신 실제 관리대장에서 스크롤 헤더를 검증한다. 휴대폰의 역할/언어 선택기 높이36px도44px로 수정했다.
- 이 후속 수정은 아직 native 전체 회귀/배포 전이다. native 전용 포트를 사용해 실제 서비스나 다른 시험 서버와 혼용하지 않고 검증한다.
