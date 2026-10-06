# Stitch 화면 기준표

프로젝트: **DOUL Supervision MVP** (`11486949689509673114`)

## 현재 Frontend 동기화 기준

현재 React Frontend의 desktop 주요 route **11개**를 Stitch의 `React 동기화` 화면과 대응시켰다.
동기화 검증 기준은 `main` **`b298cd5`**이며, UI 소스는 `ddaa662` 이후 변경이 없어 현재 화면과 동일하다.

Stitch MCP에는 별도의 내부 Prototype link 편집 API가 노출되어 있지 않으므로, 각 화면의 메뉴와 업무 이동 요소는 실제 실행 중인 Frontend hash route를 **HTML `<a target="_self">`** 로 연결한다. 따라서 Stitch 화면에서 메뉴를 클릭하면 해당 실제 Frontend 페이지로 이동한다. 이 링크는 화면 권한을 부여하지 않으며, 실제 접근 범위는 애플리케이션의 역할·서버 권한을 따른다.

| Route | 대표 역할 | Stitch 화면 | Screen ID | 클릭 이동 | Frontend |
|---|---|---|---|---|---|
| today | SUP | SUP-TODAY-W | 감리 업무현황 (React 동기화) | `9cfcdca7cee24bd3b4bcfa2b56f44dc0` | 확인 | `http://100.68.153.58:5174/#/today` |
| inspections | SUP | SUP-INSPECTION-W | 검측·검수 (React 동기화) | `451810a781cb430e9e28e5b401c0aaa3` | 확인 | `http://100.68.153.58:5174/#/inspections` |
| capture | SUP | SUP-MEDIA-W | 현장·증빙 (React 동기화) | `34a012cd08274530b6746690d096e73c` | 확인 | `http://100.68.153.58:5174/#/capture` |
| observations | SUP | SUP-OBSERVATION-W | 관찰 후보 (React 동기화) | `a3fdbdb99a4a4de090885fdebccb4aaf` | 확인 | `http://100.68.153.58:5174/#/observations` |
| issues | SUP | SUP-REINSPECTION-W | 부적합·이슈 (React 동기화) | `7ee421fa511c4df6819abe1a5d56f28c` | 확인 | `http://100.68.153.58:5174/#/issues` |
| actions | CON | CON-CORRECTION-W | 시정조치 (React 동기화) | `fd6ce199d34842cba5617dffb4626b85` | 확인 | `http://100.68.153.58:5174/#/actions` |
| owner | OWN | OWN-DECISION-W | 발주처 보고·결정 (React 동기화) | `d71403f944234f8aa8aa71a8e154c23f` | 확인 | `http://100.68.153.58:5174/#/owner` |
| documents | SUP | DOC-AUTHOR-W | 문서 작성 (React 동기화) | `ac115ffe4db8436c9253d919e58d1e81` | 확인 | `http://100.68.153.58:5174/#/documents` |
| registers | SUP | SUP-REGISTERS-W | 관리대장 (React 동기화) | `2cac65491b4640aca4c1acbdd77ce075` | 확인 | `http://100.68.153.58:5174/#/registers` |
| rfis | DES | DES-RFI-W | 설계질의 (React 동기화) | `0ffb870122fa49a987c836f7a4a612df` | 확인 | `http://100.68.153.58:5174/#/rfis` |
| admin | ADM | ADM-ROLES-W | 배치·권한 (React 동기화) | `47e48fc436bc498f982875bfeee1030a` | 확인 | `http://100.68.153.58:5174/#/admin` |

검증 결과:

- Screen readback: **11/11**
- Project canvas instance: **11/11**
- `list_screens` 확인: **11/11**
- 역할별 navigation href: **11/11**
- Live Frontend base: `http://100.68.153.58:5174/#`

상세 검증값은 `frontend-page-sync.json`, 최종 채택 Screen ID는 `screens.json`에서 관리한다. 페이지 동기화는 `scripts/stitch_sync_frontend_pages.py`가 route별로 **순차 실행**하며, 원시 응답과 임시 HTML은 `.local/stitch/`에만 보관한다.

## 기존 Mobile / Historical 화면

기존 모바일 보정 화면과 과거 Stitch draft는 삭제하지 않고 reference/history로 보존한다. 현재 11개 React Frontend 동기화 화면의 Screen ID를 canonical desktop review set으로 사용한다. 모바일 전용 Stitch 재동기화는 별도 작업으로 관리한다.

생성·편집된 Stitch 화면은 사용자 디자인 승인 전 초안이다. MCP 편집 응답만으로 완료를 판단하지 않고 `get_project`, `list_screens`, `get_screen` 및 생성 HTML 링크를 다시 검증한다.
