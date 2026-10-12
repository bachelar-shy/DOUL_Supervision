# PDF 장별 자동 분리 — 기존 도면 구조 재사용

실제 도면집을 한 장짜리 PDF 여러 개로 **물리적 복제하지 않는다**. 원본 PDF는
PostgreSQL snapshot blob에 **한 번만** 저장한다. 파생 결과는 각 장별
저용량 JPEG(썸네일 330px, 열람 2200px)로 보관한다.

## 기존 구조 (수정·초기화 금지)
- InformationItem(subtype=Drawing) — 공식 도면/개정 업무 객체
- drawingPdfBindings — Drawing/Evidence 정확한 작성 차수 연결
- drawingMarkups — PDF 주석
- drawingMarkupIssueLinks — 검측/관찰/Issue/Action 연동
- drawingFieldRevisions — 현장 배포·개정 자료

## 추가 구조 (기존 snapshot format=1 유지, 별도 DDL 없음)
- meta.drawingSets[project_id][set_id] — 원본 PDF 해시/크기/원본 blob ID/페이지수/진행률
- meta.drawingSheets[project_id][sheet_id] — PDF 각 페이지 독립 식별자, 도면번호/도면명/폴더/상태, 썸네일·열람 이미지 blob
- meta.drawingSheetPins[project_id][sheet_id][pin_id] — 현장상황·검측·지적 마크의 정규화된 x/y 좌표, 선택적 검증된 Issue/Inspection 등 recordRef
- meta.drawingSheetAudit[project_id] — 누가 언제 어느 sheet/issue pin을 생성/수정했는지
- store.requests — Idempotency key/replay fingerprint

모든 새 데이터는 **초안**이며 승인된 건설도면/증빙/시정조치라는 뜻이 아니다.
정식 정보항목·증빙 승격은 기존 Evidence 워크플로 후 별도 단계로 수행한다.

## API / 기존 권한 재사용
- POST /projects/{projectId}/drawing-sets?filename=... (application/pdf, Idempotency-Key)
- GET /projects/{projectId}/drawing-sets 및 /{setId}
- GET /projects/{projectId}/drawing-sheets 및 /{sheetId}
- GET /projects/{projectId}/drawing-sheets/{sheetId}/image?size=thumb|preview
- PATCH /projects/{projectId}/drawing-sheets/{sheetId} (ExpectedVersion + Idempotency-Key)
- GET/POST /projects/{projectId}/drawing-sheets/{sheetId}/pins (normalized 0..1 x/y, recordRef optional)
- 역할 ADM/SUP/CON: 업로드, 초안 생성, 수정, 좌표 기록. OWN: 도면/연결된 핀 조회 전용
- 모든 API에서 인증한 프로젝트의 역할 배정 고정, 객체 참조 교차 프로젝트 검사.
- Idempotency/Version/Audit 보존 및 원본 업로드 중복 방지.

## 서버 변환 정책
- poppler pdfinfo/pdftoppm; child shell 불사용; 최대 원본 20 MiB, 150페이지
- API는 processing 을 반환; FastAPI BackgroundTasks 에서 최대 두 페이지를 병렬 래스터 처리
- 진척도·실패 상태를 API에 공개, 개별 JPG는 권한 확인 후 전송
- 브라우저에서는 PDF 렌더링·벡터 전송 없음 (레거시 PDF 뷰어는 별도 메뉴로 접근 가능)
- DLP/악성 코드 검사, 영속 큐 재시도, 대규모 도면집 저장소 분리는 정식 출시 이전 강화 범위
