# DOUL 감리앱 공통 작업영역 레이아웃 v1

## 적용 범위

기존 메뉴 이름, 메뉴 순서, 업무 기능, 프로젝트·역할별 권한, 서버 저장 계약은 바꾸지 않는다.
모든 화면이 공통 구성 요소를 사용하는 영역에서 Fieldwire의 **정보 배치 방식**을 참고한다.
Fieldwire 상표, 그래픽 자산이나 전용 아이콘 파일을 복제하지 않는다.

| 화면 | 공통 레이아웃 원칙 |
| --- | --- |
| 오늘 | 조밀한 업무 바로가기, KPI, 목록/상세 이중 패널 |
| 현장기록 | 상단 작성/첨부 동작, 저장 기록/파일 목록, 밀도 통일 |
| 도면조회·도면 관리 | 중앙 화면 확보, 얇은 조작막대, 도면 미리보기·검토 패널 |
| 검측·검수 | 검색·상태 필터·정렬 목록, 독립 상세 패널, 기존 시공사 신규 작성 |
| 지적·시정조치·이슈·RFI | 검색·상태 필터·정렬 목록, 상세 패널 |
| 감리보고·양식·문서 | 얇은 탭바, 목록/편집/미리보기 패널 |
| 일정·안전·계약·기성·준공 | 넓은 데이터 영역, 최소한의 중첩 카드, 공통 표 밀도 |
| 문서대장·등록대장 | 단일 표 스크롤, 공통 열 경계 및 인쇄 독립 |
| 어드민·프로젝트 설정 | 공통 상단 도구막대, 얇은 탭바, 조밀한 목록/양식 |
| 인원 추가 요청 | 역할별 화면 유지, 같은 툴바·목록 밀도 적용 |

## DOUL 디자인 기준

- 사이드바: Charcoal `#2B3036`; 메뉴 선택: DOUL Blue `#0B2E91`
- 일반 배경: Gray `#F4F6F8`; 작업면: White `#FFFFFF`
- 선택 상태: Pale Blue `#EAF0FF`, 정보/결과 상태 색상은 기존 서버 판정 유지
- 화면폭 >= 1101px: 좌측 메뉴 208px; 768–1100px: 아이콘 메뉴 64px
- 화면폭 < 768px: 290px 이내 접이식 메뉴 및 기존 모바일 하단탭
- 고정 상단바 48px (모바일 두 줄), 화면별 헤더 약 61px, 내부 좌우 여백 14px
- 작업 목록/상세는 기존 `ResizableWorkspace` 사용. 저장된 패널 비율과 사용자 조작 유지
- 중앙 PDF는 기존 뷰어 사용. PDF 엔진, 증빙 연결, 검토·이슈 저장, 역할 권한에는 영향 없음
- 목록의 검색/상태/정렬은 클라이언트 표시만 변화. 서버 데이터·상태를 바꾸지 않는다

## 접근성 및 성능

- 좌측 탐색 `aria-current` 유지, 모든 검색 입력·밀도 전환에 접근 가능한 이름 부여
- `Ctrl/Cmd+K` 전체 메뉴·기록 검색; 선택 결과는 실제 허용 메뉴로만 이동
- 모바일 44px 터치 목표, 본문 가로 넘침 2px 이내
- DOUL의 기존 도구상태와 PDF 좌표/주석을 그대로 사용; 시각화용 추가 PDF 렌더링 없음
- 대시보드의 위젯과 도면 페이지를 하나의 화면 안에 담아 중첩 스크롤 최소화

## 검증

- `playwright.field-layout.config.ts`: 전체 기능 모드에서 4개 역할/모든 원래 메뉴 경로 순회
- `tests_browser_quick_role/field-layout-core.spec.ts`: 현재 출시 메뉴 구성을 유지하며 4개 역할 x PC/폰 확인
- 기존 `resizable-workspace.spec.ts`: 키보드/포인터 리사이즈·데이터 영속성·스크롤·모바일
- 수정된 `quiet-graphite-design.spec.ts`: 1440/1024/768/390px 화면 비율 및 접근성
- 배포 시 DOUL 테스트 서버의 비밀번호 없는 네 가지 역할 테스트 로그인은 별도 설정 그대로 유지

참고: [Fieldwire Tabs and Categories](https://help.fieldwire.com/hc/en-us/articles/202909250-How-to-Navigate-the-Fieldwire-Tabs-and-Categories), [Fieldwire Tasks](https://help.fieldwire.com/hc/en-us/articles/202634034-Introduction-to-the-Tasks-Tab-and-Views), [Fieldwire Plans](https://help.fieldwire.com/hc/en-us/articles/360018233192-Introduction-to-the-Plans-tab-Web).
