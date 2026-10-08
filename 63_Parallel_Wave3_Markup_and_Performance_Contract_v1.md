# Wave 3: PDF 주석·도면 이슈·작업함 성능 계약

기준선 integration/parallel-test-v1 @33991a4. main 및 다른 서버는 수정하지 않는다. 로컬 커밋으로 검토하며 루트가 공통 API/화면 등록을 담당한다.

## 주석
정확한 drawingPdfBinding에 연결된 별도 기술 metadata다. 원본 PDF, Drawing 승인/발행 상태 및 Evidence는 수정하지 않는다. 이번 범위는 사각형과 메모 생성/조회이며 수정·삭제·자유곡선은 후속이다.

POST /projects/{p}/parallel/drawing-markups body EXACT {bindingId,page,rect:{x1,y1,x2,y2},text}. Idempotency-Key 필수. demo 활성 ADM/project_admin/render_document만 작성한다. 양쪽 원본을 현재 역할로 읽을 수 있어야 한다. bindingId UUID, page 양의 정수 <=100000, rect 유한한 JSON number(bool 제외), -10000000<=각좌표<=10000000, x1<x2 및 y1<y2, text trimmed 1~2000자를 검증한다. body 최대 16KiB. 서버는 PDF page geometry가 없으므로 실제 페이지/경계 검증을 주장하지 않는다. UI는 렌더 완료된 PageViewport viewBox 내부 점을 변환해 저장한다.

record {id,version:1,projectId,bindingId,drawingRef,evidenceRef,page,rect,text,createdAt,createdBy}. store.meta.drawingMarkups JSON 배열과 drawingMarkupAudit 기술 이력. 동일 key/body 재시도 200, 변경 body 409; 최초 201. 최대 1000개/binding. GET /parallel/drawing-markups?bindingId={id} -> {items:[record]} (bindingId 필수). GET /parallel/drawing-markups/{id} -> record. 두 원본 읽기 권한이 없거나 다른 프로젝트/없는binding이면 generic404, 미인증401. plain text로 표시, SVG/HTML로 해석하지 않는다.

UI: 주석 작성 mode와 핀 mode를 구분하고 두 점 또는 드래그로 사각형 지정, 메모 입력 후 명시적 저장. 확대/회전 때 네 꼭짓점을 viewport로 변환해 표시. role/project/source/binding/page/render 변경은 임시 선택·늦은 응답을 무효화한다. 저장된 주석 선택은 optional onSelectMarkup(id|null) callback으로 연결한다.

## 도면 주석에서 이슈 등록
POST /parallel/drawing-markups/{id}/issues body EXACT {roleAssignmentId,expectedMarkupVersion,inspectionRef,observationRefs,issueObjectId,actionObjectId,subtype,title,actionTitle,responsiblePartyId,dueAt}. 기존 create_issue_package를 동일 transaction에서 호출한다. demo 모드만, 실제 기존 issue/action 권한은 engine가 검사하며 UI에서 신설하지 않는다. 확인 없는 생성 금지.

inspectionRef canonical objectType Inspection / observationRefs Observation, UUID와 정확한 현재 positive version. source/markup 조회 권한, 검사·관찰 읽기 권한, markup version, 같은 프로젝트, 원 검측이며 failed 또는 failed result completed, 검사 drawingRef==markup drawingRef 및 observation confirmed를 검사한다. 기존 create_issue_package의 관찰 scope, 책임조직/담당자, 증빙, 권한 및 자격 조건을 유지한다. 자동 관찰 확인/검측 실패 처리 없이 이미 판정된 기록만 사용한다.

성공하면 store.meta.drawingMarkupIssueLinks에 {markupId,markupVersion,inspectionRef,observationRefs,issueRef,actionRef,createdAt,createdBy} 정확한 canonical refs를 기록하고 기술 이력을 추가한다. markup당 하나의 이슈 연결, 동일 key/body replay 200, 최초201, 이미 다른 연결이면409. canonical workflow+기술link 하나의 transaction으로 실패 시 모두 rollback한다. key replay 전에 source와 생성 결과 현재 읽기 권한도 확인한다. 응답 {markup,issue,correctiveAction,link}. GET detail record에 issueLink?:link를 붙이되 해당 이슈/조치를 읽을 수 없으면 이 필드를 생략한다. 목록 역시 표시 가능한 link만 포함한다. 읽기권한 없는 링크의 ID를 노출하지 않는다.

UI: 선택한 주석을 조회하고 정확한 도면 일치 failed 원검측 및 scope 일치 confirmed 관찰 선택, subtype/제목/조치/담당자/기한 입력, 명시적 확인 후 등록. 기존 canonical record로 이동하는 callback을 사용할 수 있다. 부적격 record 자동수정 없음. responsiblePartyId는 사용자가 입력/확인한다. 미리보기는 발행/종결로 표시하지 않는다.

## 작업함
응답 schema/권한/명령/정렬/total/cursor 의미를 유지한다. 상세 preflight는 실제 페이지의 기록에만 수행할 수 있는 기존 authority 판정 callback을 분리한다. 캐시로 역할 또는 버전 권한을 우회하지 않는다. 기존 기본 동작은 유지해 callback 없는 소비자 회귀를 막는다. 의미 있는 동일응답·권한·페이지·명령 계산 횟수 검사와 before/after 측정.

루트 UI는 처음부터 모든 모듈 조회를 동시에 수행하지 않고 선택한 진단 조회를 필요한 시점에 수행해 중복·불필요한 초기 조회를 줄인다. 읽기 계약이나 빈 결과를 성공으로 조작하지 않는다.

## 검증
Context7 Mozilla PDF.js PageViewport 공식 source 적용. Python 계약/권한/버전/재시도/rollback/재시작, UI boundary/typecheck/lint/build 및 실제 서버 브라우저 시나리오. 새 작업은 별도 branch/worktree에서 수행한다. API 8801·UI5191 및 기존 Tailscale10002 접속 주소를 유지한다.
