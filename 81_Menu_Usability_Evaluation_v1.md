# 81. DOUL 감리앱 메뉴 사용성 평가 v1.0

- 기준일: 2026-10-11
- 상태: **1차 정적 점검 및 수정안 작성, GitHub 브라우저 자동시험 대상 등록.** 실제 현장 사용자 평가는 **미실행**.
- 참조: `79_Field_Role_Use_Case_and_Terminology_Review_v1.md`(67건), `80_Feature_Interaction_and_Document_Usability_v1.md`(77+26건)
- 기계 카탈로그: [app/reference/menu_usability_v1.json](app/reference/menu_usability_v1.json)
- 브라우저 자동시험: [tests_browser/menu-usability.spec.ts](tests_browser/menu-usability.spec.ts)
- 정적 검사: [tests_contracts/test_menu_usability.py](tests_contracts/test_menu_usability.py)
- 업무·권한·상태 계약 및 승인 현장 용어 ID를 변경하지 않는다. 한국어 현장 용어 검수를 우선하며 vi/en 전문용어 인간 검수는 추후 실시한다.

## 1. 목표와 평가단위

사용자가 **메뉴명을 보고 올바른 업무를 찾고**, 화면에 진입한 뒤 업무를 완료하고 다시 돌아오는 과정을 검증한다. 개인별 화면 권한, 실제 업무 권한, 단순 자료 열람을 혼동하지 않는다.

평가를 두 층으로 분리한다.

1. **자동 기능 평가**: 실제 브라우저에서 역할별 메뉴목록, 직접 진입, 현재위치 표시, 브라우저 이동기록, 높이 제한 스크롤, 모바일 드로어, 키보드/터치, 다국어 표시, 금지된 주소 처리를 검증한다.
2. **현장 사용자 사용성 평가**: 감리자·시공사·발주처·관리자가 설명 없이 업무를 찾는 시간·잘못 선택한 메뉴수·용어 해석·업무복귀·도움 요청을 관찰한다. 자동시험 PASS만으로 사람의 이해도를 증명하지 않는다.

**판정 원칙:** 메뉴가 존재해도 실제 담당자가 찾지 못하거나 기능이 다른 이름/개발 메뉴 안에 숨겨져 있으면 사용성 미달이다. UI에서 숨기는 것과 API 접근권한은 별도 문제다.

## 2. 사용자별 메뉴 구조 및 우선 탐색 과업

현재 제안 코드 기준이며, 모든 메뉴가 각 역할의 실제 업무 처리 권한을 뜻하지 않는다.

| 역할 | 사용자 | 시범환경 표시 메뉴수 | 1차 과업 |
|---|---|---:|---|
| SUP | 감리자 | 17 | 현장기록 작성→`capture`, 도면 원본 검토→`drawings`, 검측 처리→`inspections`, 시정조치 확인→`actions`, 감리보고 작성→`documents` |
| CON | 시공사 | 15 | 현장사진 등록→`capture`, 도면 확인→`drawings`, 검측 요청→`inspections`, 시정결과 제출→`actions`, 기성청구→`payment` |
| OWN | 발주처 | 11 | 진도·문제 현황→`today`, 도면 조회→`drawings`, 발주처 보고·결정→`owner`, 기성 검토→`payment`, 인수현황→`completion` |
| ADM | 관리자 | 18 | 프로젝트 전환→`today`, 사용자·권한 설정→`admin`, 도면 배포→`drawings`, 문서 원본 관리→`documents`, 관리대장 조회→`registers` |
| DES | 설계자 협업 | 7 | 도면 확인→`drawings`, 개정도면 검토→`drawings`, 설계질의 회신→`rfis`, 문서 확인→`documents` |

첫 화면의 최우선 과업은 감리자: **현장기록·도면검토·검측·시정조치·감리보고**; 시공사: **현장사진·도면확인·검측요청·시정결과·기성청구**; 발주처: **현황·도면·보고/결정·기성·인수**; 관리자: **프로젝트·사용자권한·도면송수신·문서·관리대장**이다.

## 3. 메뉴 평가 시나리오 30건

| ID | 대상 역할 | 종류 | 시험 상황 | 중요도 | 실행방법 |
|---|---|---|---|---|---|
| MC-01 | SUP, CON, OWN, ADM, DES | findability | 오늘 화면에서 도면 검토 찾기 | P0 | browser |
| MC-02 | SUP | findability | 오늘 화면에서 현장기록·검측·시정조치·감리보고 찾기 | P0 | browser_and_human |
| MC-03 | CON | findability | 검측 신청 후 시정결과 제출 메뉴 찾기 | P0 | human |
| MC-04 | OWN | findability | 발주처 보고·결정과 기성 메뉴 찾기 | P0 | human |
| MC-05 | ADM | findability | 사용자 계정·현장 전환 메뉴 찾기 | P1 | browser_and_human |
| MC-06 | SUP, CON, OWN, ADM, DES | navigation | 좌측 메뉴 클릭·현재 메뉴 강조와 페이지 제목 | P0 | browser |
| MC-07 | SUP, CON, OWN, ADM, DES | navigation | 뒤로가기·앞으로가기·새로고침 후 메뉴 연동 | P0 | browser |
| MC-08 | SUP, CON, OWN, ADM | navigation | 모바일 하단 바로가기와 더보기 메뉴 간 이동 | P0 | browser |
| MC-09 | SUP, ADM | overflow | 높이가 낮은 데스크톱에서 모든 메뉴 끝까지 스크롤 | P0 | browser |
| MC-10 | SUP, ADM | overflow | 긴 프로젝트명과 프로젝트 선택기가 생길 때 메뉴 스크롤 | P0 | browser |
| MC-11 | SUP, CON, OWN, ADM | responsive | 390px 모바일에서 메뉴 열기·닫기·항목 실행 | P0 | browser |
| MC-12 | SUP, CON, OWN, ADM | responsive | 768px 태블릿·1024px 데스크톱 메뉴 배치 | P1 | browser |
| MC-13 | SUP, CON, OWN, ADM | accessibility | 닫힌 모바일 메뉴에서 탭 이동 안전성 | P0 | browser |
| MC-14 | SUP, CON, OWN, ADM | accessibility | Esc·배경 누르기·닫기 버튼으로 모바일 메뉴 닫기 | P0 | browser |
| MC-15 | SUP, CON, OWN, ADM, DES | accessibility | 메뉴 접근성 이름·aria-current 및 버튼 타깃 | P1 | browser |
| MC-16 | SUP, CON, OWN, ADM, DES | role | 역할 전환 시 메뉴 목록과 열람범위 변경 | P0 | browser |
| MC-17 | CON, OWN, DES | role | 직접 URL로 허용되지 않은 메뉴 접근 | P0 | browser |
| MC-18 | ADM, SUP | role | 도면 등록 탭과 일반 조회 탭 권한 구분 | P0 | browser |
| MC-19 | SUP, CON, OWN, ADM | role | 프로젝트 전환 후 새 현장 메뉴·데이터 전환 | P0 | browser_conditional |
| MC-20 | SUP, CON, OWN, ADM | context | 페이지 간 이동 중 도면·문서 원본 연계가 유지되는지 | P0 | browser_and_human |
| MC-21 | SUP, CON, OWN | context | 선택한 메뉴와 업무 처리가 실제로 연결되는지 | P1 | browser_and_human |
| MC-22 | SUP, CON, OWN | context | 빈 목록에서 다음 행동 안내 | P1 | human |
| MC-23 | SUP, CON, OWN, ADM | terminology | 메뉴 이름만 보고 업무 목적 이해 | P0 | human |
| MC-24 | SUP, CON, OWN, ADM | terminology | 메뉴 내 유사 개념 구분 | P1 | human |
| MC-25 | SUP, CON, OWN, ADM | terminology | 한국어·베트남어·영어 전환 후 메뉴 목적 유지 | P1 | browser |
| MC-26 | SUP, CON, OWN | findability | 메뉴 밀도 및 그룹 인지부하 평가 | P1 | human |
| MC-27 | SUP, CON, OWN, ADM | accessibility | 키보드만으로 주 메뉴 조작 | P1 | browser |
| MC-28 | SUP, CON, OWN, ADM | overflow | 200% 확대 및 600px 높이 브라우저 | P1 | browser |
| MC-29 | ADM | context | 관리자 미등록 프로젝트·데모 목록 상태 | P1 | browser |
| MC-30 | SUP, CON, OWN, ADM | context | 메뉴 조작 성능 및 화면 오류 측정 | P1 | browser |

평가 종류는 목표 메뉴 발견(`findability`), 경로·이동(`navigation`), 스크롤(`overflow`), 역할(`role`), 작업 맥락(`context`), 화면 적응(`responsive`), 접근성(`accessibility`), 용어(`terminology`)이다.

테스트 자료: 역할별 시범 계정, 여러 현장의 권한이 다른 프로젝트, 실제 파일 형식의 도면 PDF(구/신개정), 현장사진·검측·시정·보고 원본, 빈 목록·오류·느린 API 응답, 390/768/1024/1440px 화면과 520px 저높이 창. 실제 시범사용자는 각 역할 최소 1명, 공종과 직무차가 큰 경우 확대한다.

## 4. 소스 점검에서 확인한 문제와 처리 상태

| 번호 | 중요도 | 점검 결과 | 현재 분류 | 검증·후속 작업 |
|---|---|---|---|---|
| MENU-F01 | P0 | 도면이 독립 메뉴가 아니라 개발/업무별 상세 확인 안에 숨겨짐 | confirmed_source_before_fix | MC-01,MC-06,MC-18: CI 브라우저 검증 대기 |
| MENU-F02 | P0 | 메뉴 마지막 항목을 스크롤할 수 없다는 사용자 보고 | reported_by_user_not_reproduced_current_branch | MC-09,MC-10,MC-28: CI 재현 및 확인 대기 |
| MENU-F03 | P1 | 닫힌 모바일 드로어의 키보드 접근/상태 표시 문제 | confirmed_source_before_fix | MC-11,MC-13,MC-14,MC-15: CI 검사 대기 |
| MENU-F04 | P1 | 상세 기능 테스트 메뉴가 현업 역할의 하단 메뉴에 남아 있음 | review_pending | MC-23,MC-26 현업 역할 인지 검수 필요 |
| MENU-F05 | P1 | 감리자의 긴 단일 메뉴 목록 및 그룹 구분 부족 | review_pending | MC-26 실제 현장 사용자 목표 탐색시간 측정 필요 |
| MENU-F06 | P1 | 실제 WWT 원본 도면 미등록으로 탐색 이후 도면 확인 중단 | known_environment_limit | MC-20,MC-22 실제 원본 첨부한 Pilot 검증 필요 |

### 주요 수정 사항

- **도면 바로가기**: 메뉴에 `도면 조회·검토`를 추가하고 기존 PDF 보기·마킹·도면 개정 비교·권한이 허용하는 등록 기능을 별도 화면에서 제공한다. 이전에는 `업무별 상세 확인` 아래로 들어가야 했다.
- **메뉴 스크롤**: 최신 소스에는 `.sidebar nav`의 `overflow-y:auto`가 이미 존재한다. 이전 사용자가 겪은 '스크롤 안됨'이 현행 브라우저에서 재현되는지는 확인 전이므로, `scrollbar-gutter:stable`과 44px 항목 접근성을 추가하고 **높이 520px** 환경을 자동시험에 포함했다. 실제 브라우저 결과를 받아야 '개선 완료'로 판정한다.
- **모바일 접근성**: 닫힌 드로어의 `visibility:hidden`, 열기/더보기 버튼의 확장상태와 대상 메뉴 연결, Escape 및 배경 터치 닫기를 구성했다.
- **역할별 안전성**: 금지된 직접 주소는 허용된 시작화면으로 정리하고, 업무명·활성 메뉴·URL·브라우저 이동기록의 일치를 검증한다. 기존 API의 권한 정책은 변경하지 않았다.

### 사람에 의한 판단이 남은 항목

- 감리자의 단일 메뉴가 너무 길어 핵심 작업을 찾기 어려운지. 단순히 메뉴를 17개 미만으로 줄이기보다 **업무 우선순위·그룹 구조** 평가 후 정한다.
- 시범환경에서 `업무별 상세 확인`에 남은 개발/점검성 기능을 현장 사용자에게 노출할 필요가 있는지. 기존 개발 시험 경로는 이번 작업에서 삭제하지 않았다.
- `계약통지·클레임·EOT`, `현장·증빙`, `부적합·지적사항` 등의 명칭을 사용자가 실제로 구별하는지. 임의 번역 대신 현장 사용자 발화 기록으로 정한다.
- WWT 시범자료에 실제 원본 PDF가 없어 '도면 메뉴 진입'과 '도면 검토 업무 완료'는 다른 통과 조건임.

## 5. 점수·결과 기록 기준

| 지표 | 측정 항목 | 검토안 기준 |
|---|---|---|
| M-01 | 목적 메뉴 발견 | 역할별 핵심 작업 5개를 힌트 없이 찾아 메뉴 클릭까지 걸린 시간 | 현장 Pilot 후 기준선 결정(초기 목표 한 작업 30초 이내) |
| M-02 | 오진입 | 메뉴 선택 후 뒤로가기·잘못 선택한 경로 수 | 핵심 업무 5건 중 오진입 1회 이하 |
| M-03 | 접근 완료율 | 역할별 허용 기능에 실제 화면까지 도달한 비율 | P0 자동 브라우저 시나리오 100% 진입, 실제 사용자 목표 90% 이상 |
| M-04 | 메뉴 정확성 | 현재 URL·활성메뉴·제목·역할·프로젝트 표시의 일치 | 자동 전수 100%, 잘못된 업무노출 0건 |
| M-05 | 스크롤·화면 접근성 | 390/768/1024/1440px 및 짧은 높이에서 버튼 접근·포커스·44px 타깃 | 필수 메뉴 접근 불가 0건 |
| M-06 | 메뉴 이름 이해도 | 현장 역할별 메뉴명 해석·올바른 작업 선택 1~5점 | 평균 4점 이상(협의 전 제안) |
| M-07 | 전환 안전성 | 역할·프로젝트 변경/뒤로가기/재접속 시 이전 컨텍스트 노출 | 타 프로젝트 정보 노출·권한 없는 공식행위 0건 |
| M-08 | 메뉴 작업 중 데이터 보존 | 기본 업무에서 다른 메뉴로 왕복할 때 입력값·원본참조 일치 | 공식 원본 손실 0건, 미저장 작성물 명시적 경고 또는 복구 |

핵심 실패 기준: `메뉴 접근불가`, `잘못된 사용자·프로젝트 정보 노출`, `도면 검토 기능 진입 불가`, `중요 입력값 무고지 손실`, `사용자에게 승인권한 오인 유발`. 이런 항목은 정량 평균이 양호하더라도 P0/P1 결함으로 분리한다.

검증 결과 기록 형식:

`menuCaseId / role / projectId / viewportWidthHeight / routeBeforeAfter / discoveredInSec / wrongClicks / scrollTopBeforeAfter / keyboardFocus / ariaCurrent / expected / actual / status / screenshotOrVideo / trace / termFeedback / defectId / retestEvidence`.

## 6. 자동시험과 인수의 경계

| 구분 | 통과 인정 조건 |
|---|---|
| 카탈로그 정적 검사 | 메뉴 ID·역할·현장용어·접근성 구현 및 시험 스크립트의 참조 일치 |
| GitHub 브라우저 자동시험 | 사용자 역할별 실제 메뉴·경로·스크롤·모바일 동작 테스트 성공 및 증빙 |
| 사용성 관찰 | 실제 역할 담당자가 지침 없이 목표 기능을 찾고 과업을 끝낸 기록 |
| 현장 인수 | 실제 도면·문서·검측·시정기록과 역할별 공식 권한·원본 무결성을 확인 |

정적검사와 GitHub 브라우저 CI의 결과는 다르게 관리한다. 이전에 종료한 맥미니 서버는 재가동하지 않고 GitHub의 임시 실행환경에서 평가한다. 자동평가 결과가 확인되기 전까지 `unverified`를 유지하고, 사람 관찰을 위한 점수는 **미실행**으로 표시한다.
