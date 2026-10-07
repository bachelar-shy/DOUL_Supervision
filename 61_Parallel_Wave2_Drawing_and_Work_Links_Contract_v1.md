# Wave 2: PDF·위치·업무 연결 실행 계약

기준선은 integration/parallel-test-v1 @ 9c39bdc다. 기존 테스트 서버와 합성 데모 DB를 사용한다. 각 Stream은 별도 branch/worktree에서 작은 기능 단위로 개발한다. main 운영 기준선은 변경하지 않는다.

## 도면 PDF 연결
정식 Drawing/Evidence 상태 변경 없이 데모의 기술 연결 index를 추가한다. 쓰기는 demo=True이며 활성 ADM/project_admin/render_document 배정에서만 허용한다. 원본 Drawing과 Evidence를 모두 현재 역할로 읽을 수 있어야 한다. 정식 운영 권한 신설은 이 단계의 범위가 아니다.

POST /projects/{projectId}/parallel/drawing-pdf-bindings 요청은 drawingRef와 evidenceRef 두 필드만 받는다. 각각 InformationItem subtype Drawing / Evidence의 UUID와 정확한 양의 버전이다. Idempotency-Key는 비어 있지 않은 최대 160자다. 서버는 같은 프로젝트, 정확한 역사 버전, original/document Evidence, application/pdf MIME, 최대 20 MiB 원본 blob의 SHA-256 및 PDF signature를 검사한다.

binding은 id, projectId, drawingRef, evidenceRef, fileHash, createdAt, createdBy를 갖는 기술 기록이다. store.meta의 JSON index와 별도 기술 변경 내역으로 저장한다. Drawing 원본, fileIds, Evidence 원본과 공식 승인/발행 상태는 수정하지 않는다. 정확한 Drawing 버전당 원본 PDF는 하나만 연결한다. 같은 연결은 중복 생성하지 않으며 다른 원본으로 교체하려 하면 409를 반환한다. 수정/삭제/재발행은 별도 계약으로 처리한다.

GET은 현재 역할에서 두 원본을 모두 읽을 수 있는 해당 프로젝트 연결만 반환한다. 다른 프로젝트/권한 철회/누락 원본은 연결 식별정보를 노출하지 않는다. 재시작 후에도 index가 유지된다. PDF 자체를 구조 검증하거나 도면 승인으로 간주하지 않는다.

## 위치 핀
화면 클릭 위치는 PDF.js PageViewport.convertToPdfPoint로 변환한다. canvas CSS bounding rectangle을 viewport 공간으로 환산하고 DPR은 PDF 좌표에 곱하지 않는다. 확대/회전 뒤에도 같은 pdf_points 좌표를 convertToViewportPoint로 다시 표시한다. 렌더 완료된 현재 viewport에서만 클릭을 받는다. 유한한 좌표와 PDF viewBox 내부 클릭을 확인한다.

핀은 별도 Issue 상태가 아니라 기존 Location.drawingAnchors의 {drawingRef,page,x,y,coordinateSystem:pdf_points}다. 정확히 연결된 도면/페이지의 핀만 표시한다. 클릭은 임시 미리보기이며 관리자에게 명시적인 저장 버튼을 제공한다. 기존 PUT Location API와 expectedVersion을 사용하고 다른 anchor를 보존한다. 409 시 최신 위치를 읽고 임시핀을 다시 확인하도록 한다. 역할/문서 변경은 이전 선택과 응답을 무효화한다.

노드당 anchor는 최대 1000개다. 완전히 같은 도면 ref/페이지/좌표/좌표계 중복은 422로 거절한다. 서버가 PDF page geometry를 갖지 않으므로 실제 page bounds를 검증했다고 주장하지 않는다. 기존 역할·프로젝트·정확한 Drawing ref 검사와 demo 전용 관리 제한을 유지한다.

## 업무와 알림 연결
검측 사례 화면은 기존 inspection-case API의 Issue/Action/reinspection/OwnerReport, 서버 readiness와 정확한 버전을 표시한다. 명령은 기존 facade와 확인창을 사용한다. 상태 전이와 증빙/종결 조건을 UI에서 만들지 않으며 발주자 보고 전송을 자동 실행하지 않는다.

알림 원본 이동은 sourceRef와 현재 workspace record의 정확한 ID/버전이 일치할 때만 제공한다. 과거 버전을 최신 기록으로 조용히 치환하지 않는다. 읽음 저장은 전달 또는 공식 승인 상태를 변경하지 않는다. dueAt는 현재 이벤트 발생 시각이며 계약 기한 표시로 쓰지 않는다. SLA/예약 발송/외부 알림은 별도 단계다.

Safety 명령은 현재 원본 버전과 기존 서버 명령/입력 요구를 사용한다. 작업중지 해제·재개 조건과 보고 절차를 자동 실행하지 않는다. 합성 테스트 기록에서만 실제 전이를 검증한다.

## 검증·통합
기능/API와 화면 책임을 분리하며 루트가 main API composition과 ParallelTestPage/AppShell 연결을 맡는다. Context7의 PDF.js 좌표 변환 문서를 적용한다. 사용자 원본 데이터 및 다른 서버는 수정하지 않는다. 권한/프로젝트/버전/원본 checksum/중복/재시도/재시작과 회전·확대 좌표 유지, 명시적 저장, 원본 이동을 검사한다. UI 경계, typecheck/lint/build 및 의미 있는 브라우저 시나리오를 통과한 뒤 테스트 서버에 반영한다. 이번 작업은 기존 앱 전체의 구현 완료 또는 운영 배포를 선언하지 않는다.
