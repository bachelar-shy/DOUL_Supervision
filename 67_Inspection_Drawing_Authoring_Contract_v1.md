# 67. 검측 작성 · 도면 / 위치 / 기준 / 증빙 연결 v1

## 목적과 범위

기존 예시 자체검측 버튼을 실제 초안 작성 폼으로 대체한다. 시공사는 작업명, 정확한 도면 개정본, 검측 위치, 검측 기준과 현장 증빙을 선택한다. 자체검측 완료와 사전 확인 5항목, 중지점은 사람이 입력한다. 저장은 draft 생성이며 검측 요청·감리 판정·다음 공정 허용은 기존 공식 명령으로 처리한다.

## 서버 계약

- `GET /projects/{projectId}/inspection-authoring/options`: 현재 역할이 검측을 작성할 수 있는 도면과 해당 도면 범위의 위치를 반환한다.
- 선택 자료 조회: 위 주소에 `drawing_id`, `drawing_version`, `location_id`를 모두 전달한다. 해당 위치의 현재 유효 기준과 열람 가능한 현장 증빙을 반환한다.
- `POST /projects/{projectId}/inspection-authoring/drafts`: `objectId`, `drawingRef`, `locationId`, `requirementRefs`, `evidenceRefs`, `workName`, `selfInspectionComplete`, `precheck`, `holdPoint`를 받는다. `Idempotency-Key`가 필수다.
- `drawingRef`와 `requirementRefs`는 버전을 포함하는 canonical 참조다. `evidenceRefs`도 저장 직전 현재 버전을 확인한다. canonical Inspection에는 기존 스키마대로 `evidenceIds`를 기록하고, 작성 요청의 정확한 참조는 중복 요청 이력에 보존한다.
- 공종·패키지는 도면에서, 책임 조직은 인증된 역할에서, 최소 자격은 Project 규칙에서 결정한다. UI는 이를 지정하거나 낮출 수 없다.
- 검측 위치는 도면 적용 위치 또는 하위 위치여야 한다. 기준은 같은 공종·패키지이며 해당 위치를 포함해야 한다. 증빙은 같은 공종·패키지·검측 위치이며 시공사 조직 범위에 속해야 한다.
- 새 도면은 기존 엔진의 기술 승인·현재 도면/PDF·현장 발행·필수 수령·변경 승인 조건을 충족해야 한다. 기존 승인된 미관리 도면은 기존 호환 동작을 유지한다.
- 기존 `engine.create('inspection', ...)`로 schema / 권한 / Gate / 감사 기록을 적용하며 `nextWorkAllowed=False`로 생성한다. 기존 Inspection의 참조를 자동 변경하지 않는다.
- 첫 저장 201, 동일 요청 재시도 200, 동일 키로 다른 요청 409. 요청 전체와 역할을 비교한다. UI는 실패 시 같은 내용의 재시도 키와 objectId를 유지한다.

## 화면과 구현 경계

검측·검수 메뉴에서 시공사 역할의 작성 폼을 사용한다. 도면·위치 변경 시 기준·증빙 선택을 초기화하고, 이전 비동기 조회 응답은 무시한다. 사용 조건이 바뀌면 서버 저장 검증에서 차단한다. UI가 예시 scope를 사용하거나 확인 항목을 자동 완료 처리하지 않는다.

UI는 `data/inspection-authoring-client.ts`와 SupervisionClient를 통해 호출한다. PDF 처리·OCR·영상 변환·추가 상시 서비스는 도입하지 않는다. 현재 Mac mini의 API·SQLite·Vite 구성에서 실행한다. 대규모 동시 사용자 부하 검증은 이번 범위에 포함하지 않는다.

## Context7 적용

React 공식 controlled select와 Effect cleanup 문서를 조회하여 제어된 선택 상태와 이전 응답 무시 패턴을 적용했다.

- https://github.com/reactjs/react.dev/blob/main/src/content/reference/react-dom/components/select.md
- https://github.com/reactjs/react.dev/blob/main/src/content/reference/react/useEffect.md

## 다음 범위

도면 개정·철회에 따른 기존 미종결 검측 / Issue / Action 영향 조회와 담당자 알림. 발주처 보고·결정 연결은 그 후 단계다.
