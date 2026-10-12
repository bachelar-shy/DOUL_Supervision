# 프로젝트 설정 개발 인계 — 2026-10-12 (Asia/Bangkok)

## 현재 결과

- 저장소 `bachelar-shy/DOUL_Supervision`, 브랜치 `feat/project-settings-20261012`, PR https://github.com/bachelar-shy/DOUL_Supervision/pull/188 (draft). PR #187의 `fix/field-core-default-entry-20261012`를 기반으로 쌓았으며 아직 병합하지 않았다.
- **프로젝트 설정, 네 역할과 별도 합성 테스트 프로젝트가 실제 서버에 적용되어 실제 HTTPS·PostgreSQL 검증을 통과했다.** 현재 배포 커밋은 `5fc446f41bb369763d0603640b54968472eb4cc2`다. 이후 인계/검증 결과만 담은 커밋은 앱 동작을 바꾸지 않는다.
- 운영준비 주소 https://automation-macmini.tail0e9ef7.ts.net:10001/ . 기존 http://100.68.153.58:5190/ 은 여기로 연결한다. admin 계정의 기존 비밀번호를 유지한다. 비밀번호·DB 접속정보·서명 키를 소스나 인계에 기록하지 않는다.
- 최신 GitHub Actions는 Mac mini self-hosted Linux ARM64에서 **대기 중**이다. native 검증을 GitHub 전체 CI 통과라고 기록하거나 미병합 PR을 병합된 것으로 처리하지 않는다.

## 구현된 기능

- `프로젝트 설정`에서 기본정보, 참여회사·담당자, 작업범위, 업무배정, 로그인계정 다섯 탭을 사용한다. 실제 서버 권한과 저장 API를 사용하며 오프라인/저장 실패/충돌을 처리한다.
- 담당자 및 계정 역할 선택은 관리자·감리자·발주처·시공사 네 가지다. 내부 roleCode/UUID를 표시하지 않는다. 계정 역할을 고르면 등록된 담당자만 표시한다. 원래 프로젝트에는 admin만 있으므로 다른 담당자는 먼저 등록한다.
- 별도 `DOUL 테스트 프로젝트 · 합성자료`를 선택할 수 있다. 네 역할의 합성 담당자, 검측·시정조치·보고, 측정기록, PDF와 합성 이미지를 포함한다. UI는 실제 현장 증빙과 구분하여 표시한다.
- 프로젝트 전환은 승인 membership으로 JWT를 다시 발급하고 이전 토큰을 폐기한다. 브라우저에서 Party/Role/권한을 지정하지 못한다. 오래된 401과 지연 로그아웃이 새 세션을 지우지 않게 했다.
- 관리자 전체 설정 범위는 사용자 요청에 따른 명시적 운영자 배정으로 부여했고 이전 RoleAssignment와 감사 이력을 보존했다. 기존 admin에 기술 자격을 추가하지 않았다. 새 담당자의 qualificationIds는 빈 배열이다. 기존 자격 기준을 완화할 수 없다.
- 768~1100px 및 접힌 desktop 메뉴에서는 프로젝트 선택란을 상단으로 옮겨 정확히 하나만 표시한다. 휴대폰과 펼친 메뉴에서는 기존 위치를 유지한다.
- 기존 DES/출처·감사·공식 참조를 삭제하지 않았다. 공식 상태·승인·종결조건을 바꾸거나 권한·증빙·버전 검증을 우회하지 않았다.

## 검증 근거

- native 전체 브라우저 **359개 통과**, 고정 소스 `7d7f861`, 로그 `/tmp/doul-settings-full-regression.log`, 결과 `.local/full-regression-results`.
- 태블릿 후속 수정 `42f4138`: 실제 API 연결 HTTPS 설정 브라우저 desktop/phone/tablet **14개**, legacy 합성 샘플 **4개**, field-core **29개**, 비밀번호 화면 **5개**, 설정/비밀번호 HTTP **15개**, 응답 순서 **4개** 모두 통과.
- 타입·빌드·UI 경계 통과, lint 기존 90 warnings/0 errors, 전체 25 workflow의 전용 Mac mini 러너 정책 통과.
- 실제 Tailscale: 로그인, 오늘+현장 다섯+설정의 일곱 메뉴, 네 역할, 저장, 프로젝트 왕복/배너 격리, PDF 렌더링, 390px 화면/44px 역할 선택, 768/1024px 프로젝트 선택과 접힌 desktop 전환 확인. JS errors0/HTTP5xx0.
- 실제 API: 이전 토큰401, 교차 프로젝트404, 멱등 재시도, 충돌409, 로그아웃401. API 재시작 후 PostgreSQL 설정/감사 유지 확인. 기존 Project 버전1은 변경하지 않았다(검증 시점).
- 공개 근거 `design/verification/project-settings-20261012.json`. 실제 서버 private 근거는 아래 runtime의 `project-settings-verification.json`, `settings-api-verification.json`, `settings-deployment.json`이다.
- UX200 분류는 PASS13/PARTIAL161/BLOCKED26, 사람 인수 PENDING이다. 자동시험359개 성공은 업무200개 전부 완성이나 실제 파일럿 인수가 아니다. 전체 MVP Goal은 완료로 선언하지 않는다.
- 교육자료, 베트남어/영어 전수 검토, 보안 릴리스는 사용자 지시에 따라 후순위로 남긴다. 이번 번역 변경은 기존 full-mode 미리보기 연결 복구이며 새 언어 개발·인수 선언이 아니다.

## 위치와 운영 보존

- 클라우드 worktree `/tmp/doul-project-settings-20261012`; 맥미니 worktree `/Users/automation/work/doul-project-settings-20261012`.
- 맥미니 `preview/`는 기존 사용자/다른 작업자 산출물이므로 삭제하지 않는다. `work/`는 scratch sample config; `.local/`은 격리된 시험 DB/결과다. cloud의 `.venv`, `node_modules` 링크도 소스 변경으로 커밋하지 않는다.
- private runtime `/Users/automation/work/DOUL-operational-runtime/20261012`, 인계 `HANDOVER.txt`. PostgreSQL 백업 `backups/pre-project-settings-20261012.dump` 및 `backups/pre-regression-ui-42f4138.dump`를 0600으로 보존한다. 이전 UI도 `backups/`에 보존했다.
- API8795/static6190/redirect5190, LaunchAgents `local.doul.site-api/site-web/site-redirect`. 로그인한 automation 사용자 세션에서 실행된다. 로그인 전/절전 중 availability를 검증한 것으로 선언하지 않는다.
- Docker context `colima-doul-ci`; `doul-site-postgres`, `doul-site-redis` 및 볼륨을 보존한다. 다른 컨테이너나 캐시를 prune/restart/delete하지 않는다.
- MCP8788, Tailscale443/10000/10002/10003/8443를 변경하지 않는다. 기존 native API8801은 다른 서비스여서 중지하지 않았다.

## 작은 커밋과 재개 절차

1. 이 파일, Git 상태, PR #187/#188, 실제 health의 baseCommit부터 확인한다. 이미 설치된 테스트 프로젝트나 완료한 구현을 처음부터 반복하지 않는다. 작은 커밋은 모두 push되어 있다.
2. 최신 GitHub CI가 완료되면 commit SHA와 실패 로그를 확인한다. native 통과를 근거로 CI를 생략하지 않는다. 남은 자동시험/병합 가능 여부를 확인하는 것이 바로 다음 작업이다.
3. PR #187 기준을 먼저 정리한 뒤 저장소 정책에 따라 PR #188을 순차 통합한다. 아직 CI가 대기 중이거나 기준 PR이 미병합이면 완료/병합을 선언하지 않는다.
4. 필요할 때만 관련 시험을 재실행한다. 설정 검증은 `VITE_DOUL_AUTH_MODE=password npm run web:build` 후 `npx playwright test -c playwright.project-settings.config.ts`.
5. 전체 native 검증은 `DOUL_TEST_PYTHON=<worktree>/.venv/bin/python npx playwright test -c playwright.regression.config.ts --output .local/full-regression-results` (독립 UI5221/API8799/DB). 실행 중인 Vite 파일을 변경하지 않는다.
6. 병렬 native 시험은 결과 폴더와 서버 포트를 각각 분리한다. 동일 test-results로 동시에 실행하면 Playwright가 다른 시험의 trace를 삭제한다. 범용 `.local/browser-results.json`도 중복 작성하지 않는다.
7. legacy sample 재검증 scratch는 `work/playwright.sample-recovery.config.ts`, DB `.local/settings-sample-recovery/DOUL_SAMPLE_WWT.sqlite3`, 결과 `.local/sample-recovery-results`. 현재 config의 실제 port/cwd를 확인하고 기존 서버에 붙거나 중지하지 않는다.
8. 다음 코드 변경도 작은 단위로 commit/push하고 이 인계를 갱신한다. 사용량 중단을 완료로 표시하지 않는다. 플랫폼 또는 새 채팅이 재개하면 마지막 완료 지점부터 이어가며 미커밋/다른 에이전트/사용자 변경을 지우지 않는다. 사용량 회복만으로 자동 실행이 보장된다고 말하지 않는다.

## 계약 및 수정 기록

- C1 계약 `design/development/project-settings-contract-20261012.md`; PCR-2026-003은 v1.2 후보 기록이며 전체 Product Baseline 채택/현장 인수 선언과 구분한다.
- 설정 화면 교체에서 빠졌던 DOUL SAMPLE 검증 패널을 full development demo에만 복구했다. 실제 비밀번호 서버에는 진단 패널을 노출하지 않는다.
- 기존 번역 미리보기 연결을 full 문서 편집기에 복구했다. 증빙 시험은 보이는 선택 체크박스를 사용하고 미등록 검증용 번호만 명시적 고급 입력으로 처리한다. 실제 HTTP/권한/버전/누계 검증 조건은 유지했다.
- field 용어 변경으로 오래된 메뉴·중지 수령 확인·도면 선택 기대를 갱신했고 임시저장 시험의 진행 중 route가 끝난 뒤 teardown하도록 했다. 도면 정확한 ID/표시차수, 대장의 실제 sticky header와 휴대폰44px를 계속 검증한다.

## 프로젝트 추가 및 공사용 도면 후속 작업 — 2026-10-12

- 프로젝트 설정 상단에 `＋ 프로젝트 추가`와 새 프로젝트 입력을 구현했다. 관리자 로그인/전체 관리 범위 확인 후 서버가 빈 프로젝트, 관리회사, 현재 계정의 담당자·ADM 배정과 승인 membership을 한 트랜잭션으로 생성한다. 기술 권한/자격 및 기존 시험자료를 복제하지 않는다. 같은 멱등 키의 재시도는 동일 Project를 반환한다. 전환 실패 시 이미 생성한 ID를 보존한다.
- `LAYEX_For Bidding_Architecture_260911.pdf` 원본 56,274,511 bytes/145쪽을 기존 테스트 프로젝트에 영속 등록했다. 사용자가 지정한 표시 용도는 `공사용 도면`이며 원본 파일명은 유지한다. 원본은 private runtime에 보관하고 Git에 넣지 않았다. 입찰용 파일명으로 용도를 자동 결정하지 않고, 표시 용도로 승인 상태를 바꾸지 않는다. 기존 합성 도면의 exact reference에 연결하지 않았다.
- 원본 SHA-256은 `44b4294283eb525e4e9115212a0d57f9f4a8b69a3a8e06a4583fa9ff0e3b1971`. 등록 근거와 실제 출처는 private runtime에 보존한다. 다운로드 원본과 인증 API 반환 bytes/hash 일치, 교차 프로젝트404, API 재시작 후 영속성 및 실제 HTTPS 첫/마지막 쪽 열람을 확인했다. 이는 145쪽 전체 설계 검토/승인이나 현장 인수 완료가 아니다.
- 최종 소스 `5fc446f`: 설정 비밀번호 HTTPS 브라우저 desktop/phone 16개 통과. 기존 현장 메뉴29개 및 PDF3개는 `3382b5e`, HTTP11개는 동일 backend 구현에서 통과했다. 타입/빌드/UI 경계 통과, lint90기존 warnings/0errors. 휴대폰 긴 원본명 범위를 제한하고 설정 버튼44px가 공통 스타일에 덮이지 않게 했다.
- 실제 서버의 프로젝트 추가 버튼·입력·오프라인 보존과 PDF 열람은 private `project-add-verification.json`, `construction-drawing-deployment.json`, `construction-drawing-api-verification.json`에 기록한다. 실제 서버에는 시험용 새 프로젝트를 추가하지 않았다. 생성·재로그인 기능 시험은 격리된 실제 비밀번호 HTTPS fixture 서버에서 수행했다.
- 현재 PR #188은 draft/open, 기준 PR #187 위에 쌓여 있다. 마지막 조회의 GitHub 24개 검사는 QUEUED다. native 검사와 실제 서버 검증을 GitHub CI 성공/병합 완료로 바꾸어 기록하지 않는다.
- 재개 시 실제 health의 release SHA, 위 근거 파일, Git 상태와 이 인계부터 확인한다. 원본 PDF를 재업로드하거나 새 테스트 프로젝트를 중복 생성하지 않는다. 현재 미구현 작업으로 `프로젝트 추가`를 다시 시작하지 않는다.
- field-core 기본 포트5198은 기존 서비스가 사용 중이어서 종료하지 않았다. 후속 검증은 `work/playwright.project-add-field-core.config.ts`의 별도49271에서29개 통과했고 시험 서버는 종료됐다. 다른 기존 서비스/preview/Colima/MCP/Tailscale 설정을 보존했다.
- private 백업은 `backups/pre-original-drawing-63059db.dump`, 원본을 포함한 `backups/pre-project-add-3382b5e.dump`, 이전 UI는 `web-before-original-drawing-63059db`, `web-before-project-add-3382b5e`, `web-before-project-add-5fc446f`에 보존한다. 클라우드 work/import_site_test_reference.draft.py는 과거 scratch이며 실행 대상은 커밋된 scripts/import_site_test_reference.py다.
