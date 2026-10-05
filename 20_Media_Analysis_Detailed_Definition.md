# 20. 사진·영상·발화 분석 상세정의

기준일: 2026-10-06 · 버전: 1.2 · 범위: 제품·데이터·검증·실행 계약

## 1. 목적과 결과

촬영·녹음의 원본을 보존하고 현장 사실, 발화로 보고된 내용, 추정, 상충되는 내용을 구분해 감리자가 확인할 관찰후보를 만든다. EXPLAIN은 근거와 기준·영향을 연결하고, VERIFY는 현장 확인·측정·사람의 권한을 요구하며, RECORD는 원본·모델·처리범위·확인 이력을 보존한다.

분석 성공과 검측 합격은 서로 다른 상태다. 사진에서 치수를 확정하려면 보정된 측정수단과 단위·오차의 근거가 필요하다. 영상이나 발화만으로 공식 합격·불합격·승인·종결을 실행하지 않는다. 분석을 사용하지 않아도 검측·시정·재검측·보고·문서 흐름은 실행된다.

## 2. 입력·원본·업로드

| 항목 | 상세 계약 |
|---|---|
| 원본 식별 | `captureId`, Evidence ID, 프로젝트, 제출자, 실제 촬영자/시험기관 등 `sourcePartyId`를 분리한다. |
| 업무 범위 | 분야·패키지·위치·조직을 지정한다. 승인도면은 `objectType/objectId/version`으로 연결한다. |
| 시각 | 촬영시각은 단말이 보고한 값, 업로드·수령시각은 서버 값이다. 시간대 포함 RFC3339를 사용한다. |
| 파일 무결성 | 원본을 덮어쓰지 않는다. 서버에서 바이트 수·SHA-256·실제 MIME을 확인하고 격리 검사 완료 후 작업자가 접근한다. |
| 재개 업로드 | 8 MiB 조각, 동시 3개, 24시간 세션, 확정 offset과 Idempotency-Key를 사용한다. offset 불일치는 409다. |
| 초기 용량 기준 | 사진 50 MiB, 영상 2 GiB, 음성 200 MiB, 영상·음성 60분. 프로젝트 설정으로 제한을 낮출 수 있다. |
| 오프라인 | 단말 암호화 큐와 안정적인 captureId로 중복을 제거한다. 업무 버전 충돌은 사람이 해결한다. |
| 파생파일 | 프레임, crop, 밝기 보정, 비식별화 파일은 새 Evidence로 만들고 원본·범위·생성작업을 연결한다. |

업로드 이후 `검증 → 미디어 인덱싱 → 발화 처리 → 프레임 처리 → 시각·발화 대조 → 관찰후보 → 사람 검토` 순서로 처리한다. 분할 작업에도 원본 기준의 전역 시간코드를 유지한다. 암호화·백신·단말 큐·저장소는 운영 어댑터의 구현사항이다.

## 3. 사진 분석

사진마다 위치·대상·업무와 원본 해시를 연결한다. 모델은 보이는 현상, 가림·흔들림·역광·해상도 부족, 관련 기준 후보, 추가 확인이 필요한 사항을 반환한다. 촬영 외 영역이나 보이지 않는 내부 상태를 확인된 사실로 표현하지 않는다.

`coverage.sources[].complete=true`는 해당 사진의 결과가 있을 때만 허용한다. 다른 사진의 관찰후보·발화 결과로 처리 완료를 대신할 수 없다. 관찰후보는 자신의 원본 사진을 visual grounding으로 인용한다. 발견사항이 없는 사진은 `kind=photo_result`, `outcome=no_findings`, `sourceEvidenceId`, `analysisRunId`, 정확한 `modelVersion`, 비어 있지 않은 `summary`를 반환한다. 같은 사진의 관찰후보와 no_findings를 함께 제출하면 거부한다. no_findings는 분석 결과이며 공식 합격 판정이 아니다.

원본 화면과 파생 화면을 함께 열 수 있어야 한다. 확대·crop을 근거로 사용하면 부모 원본과 생성 범위를 표시한다. 계측 없는 픽셀 길이를 mm 등 물리 단위의 공식 측정값으로 변환하지 않는다.

## 4. 영상 분석과 처리범위

| 모드 | 처리 단위 | 전체 분석 표시 |
|---|---|---|
| keyframes | 선택 프레임 | 불가 |
| adaptive | 이벤트·변화 구간의 선택 프레임 | 불가 |
| every_frame | 디코딩된 모든 프레임 | 전체 PTS 목록, 모든 고유 프레임의 분석결과, 누락구간 없음이 모두 충족할 때만 가능 |

프레임에는 `frameIndex`, 디코더의 `ptsMs`, 원본 Evidence, 파생 Evidence, AnalysisRun, 정확한 모델 버전이 필요하다. 가변 프레임률 영상에서는 `frameIndex/fps`를 원본 시간으로 사용하지 않는다. 회전·해상도·원본 길이·프레임 수·PTS 목록은 서버 미디어 인덱서가 기록한다.

처리범위는 파일별로 기록한다. 디코딩 프레임 수, 분석한 고유 프레임 수, 분석구간, 누락구간, 음성 처리구간, 전체 완료 여부를 구분한다. 일부 프레임의 높은 confidence가 전체 처리범위를 대신할 수 없다. 전체 영상을 디코딩했어도 일부 프레임만 모델에 전달했다면 일부 분석이다.

긴 영상은 작업을 나누되 프레임 인덱스와 시간코드의 중복·공백을 검사한다. 일부 작업이 실패하면 해당 구간은 누락으로 남고 재시도는 새 run의 `retryOfId`로 연결한다. 기존 결과·모델·프롬프트 버전을 수정하지 않는다.

## 5. 발화 분석

| 필드 | 정의 |
|---|---|
| segmentId | 원본 내 발화구간의 안정적인 ID |
| startMs/endMs | 원본 기준 전역 시작·종료 시간. 파일 길이를 넘을 수 없다. |
| speakerLabel | 임시 화자 구분. 실명·역할 귀속은 사람이 확인한다. |
| originalLanguage/originalText | 인식된 원언어와 원문. 번역문으로 대체하지 않는다. |
| translatedText | 선택적 협업 번역. 수치·단위·그리드명·부정 표현을 보존한다. |
| sourceEvidenceId/analysisRunId | 원본과 인식작업의 출처 |

한국어·베트남어·영어 및 혼합 발화를 처리한다. 잡음·중첩발화·불명확한 숫자는 reviewFlags로 표시하고 확인을 요구한다. 무음·미처리 구간에 발화를 만들어 넣지 않는다. 음성을 전부 처리했다는 의미와 모든 발화를 정확히 인식했다는 의미를 구분한다.

“120 mm에 미달한다”는 발화는 `reported`다. 측정사진·계측기록·문서 또는 감리자의 현장 확인 근거가 있어야 공식 결함의 근거로 사용할 수 있다. 화자 분리만으로 계약상 통지·승인·책임자 결정이 성립하지 않는다.

## 6. 관찰후보와 대조

후보의 필수 정보는 설명, 출처, grounding, 분석작업, confidence, 검토 플래그다. grounding은 Evidence와 시간·프레임·발화 구간, `visual/speech/measurement/document` 채널, `observed/reported/inferred/contradictory` 근거 성격을 가진다.

시각과 발화가 상충하면 두 근거를 남기고 사람이 확인한다. confidence는 모델의 참고 점수이며 보정된 확률·법정 합격도·공식 판정 기준이 아니다. 기준선·도면 개정이 바뀌면 현재 작업에 대한 적용을 다시 확인한다.

AI는 candidate만 작성한다. SUP가 검토를 시작하고 검증 메모·추가 `verificationGrounding`을 남겨 확정 또는 사유를 적어 기각한다. 추가 측정은 원래 모델 grounding을 덮어쓰지 않는다. 공식 Issue 발행은 별도 사람 명령이며, 발화 또는 추정만 있는 후보는 차단한다.

## 7. 작업·오류·운영

AnalysisRun은 `queued → running → succeeded/failed/cancelled`다. 모델 provider/name/version, promptVersion, policyVersion, 언어, 원본 목록, 출력, 처리범위를 보존한다. 실패·취소는 사유를 남기며 성공 run을 소급 수정하지 않는다.

권한은 촬영·조회·분석요청·후보확인·공식 발행으로 분리한다. AI, SYSTEM, INTEGRATION은 구분된 계정·배치권한을 사용하며 공식 승인·판정·종결·법정서명을 할 수 없다. SYSTEM은 분석 작업과 기한 알림 의도를 처리하고 INTEGRATION은 외부 자료의 제출 출처를 보존한다.

원본 접근과 공유는 프로젝트·분야·패키지·위치·조직 범위를 따른다. 얼굴·음성·외부자 정보의 공유용 사본은 비식별화하고 출처를 남긴다. 보존기간·외부 모델 반출·삭제 예외는 프로젝트 계약·적용법·승인된 개인정보 정책에서 정한다. 모델 공급자는 아직 선택하지 않았다.

## 8. 화면과 합격조건

SUP 촬영 화면은 업로드·동기화 상태를 보여준다. 분석 검토 화면은 원본, 선택 프레임, PTS 시간선, 원문·번역, 임시 화자, 처리·누락구간, 후보의 근거·검토플래그를 함께 보여준다. 후보에는 “공식 판정 대기”를 표시한다. 세부 기술버전은 출처 상세에서 확인한다.

자동검증은 가변 프레임률 PTS, 누락 프레임의 전체 분석 주장, 허위 처리 수, 원문 없는 번역, 범위 밖 발화, 음성 공백, 파생 원본 연결, 사람 확인 없는 공식 판정, 원본 덮어쓰기와 체크섬 오류를 거부한다. 실제 모델의 인식 성능·언어 정확도·현장 오탐률은 대표 현장 데이터셋으로 따로 평가한다.

관련 구현: `app/schema/media_analysis_contract_v1.json`, `app/reference/media.py`, `app/reference/engine.py`, `services/api/application.py`, `services/api/main.py`, `tests/test_media_documents.py`, `tests_mvp/test_media_pipeline_http.py`, `tests_mvp/test_media_to_issue_http.py`.

## 9. 현재 실행 구현 경계

현재 Core Application은 SUP의 분석요청, AnalysisRun 상태관리, SYSTEM/AI 서비스 계정 분리, 영상·음성 미디어 인덱스, VFR PTS 기반 파생 프레임 Evidence, 정규화 Worker 결과 검증, transcript 보존, AI candidate Observation 생성, SUP Human Review 조회까지 실행한다. 원본·파생파일·분석작업·후보·사람 확인은 각각 별도 감사기록과 Idempotency-Key를 가진다.

`POST /projects/{id}/media-analysis-runs`에서 모델·프롬프트·정책 버전은 서버가 지정하며 호출자가 변경하지 못한다. 선택적으로 `inspectionId`를 받으면 서버가 그 시점의 `inspectionRef(objectType/objectId/version)`를 보존하고 미디어와 Inspection의 package/location/discipline/responsible organization 범위를 검증한다. 재시도 run은 최초 inspectionRef를 그대로 계승한다. `GET /projects/{id}/media-analysis-runs/{runId}`의 원시 분석결과와 candidate는 SUP/ADM 내부검토 자료로 제한하며, 현재 연결 Inspection과 `issueReadiness`도 함께 반환한다. AI candidate는 `candidate` 상태로만 생성되며 SUP의 `begin_review → confirm/reject`를 자동 실행하지 않는다.

`POST /projects/{id}/media-analysis-runs/{runId}/issues`는 해당 run이 명시적으로 연결한 Inspection과, 그 run에서 생성되어 SUP가 `confirmed`한 AI Observation만 사용해 기존 공식 Issue + 최초 Corrective Action 생성 절차를 호출한다. `issueReadiness`는 모든 confirmed 후보와 별도로 공식 Issue에 사용할 수 있는 `issueEligibleObservationIds`를 구분하며, 발화 또는 추정만 확인된 후보는 `CLAIM_UNCORROBORATED`로 준비완료 처리하지 않는다. 위치·공종이 같다는 이유로 다른 Inspection이나 다른 run의 후보를 자동 연결하지 않는다. AnalysisRun에 저장된 Inspection 버전은 요청시점 출처를 설명하기 위한 기록이며, Issue 생성 시점에는 현재 Inspection 상태를 다시 읽어 `failed/completed + resultStatus=fail`인지 검증한다. 따라서 분석 자체가 Inspection의 실패 판정이나 Issue 발행을 대신하지 않는다.

로컬 개발환경에는 `/dev/media-worker/...` 정규화 ingress가 있어 SYSTEM 작업자의 `index/start/frame/complete/fail` 계약을 검증한다. 이는 실제 FFmpeg/ffprobe 실행, 음성인식·비전 모델 호출, 메시지 큐, 운영 Worker 인증 또는 외부 AI 공급자가 연결되었다는 뜻이 아니다. Generic `analysis-runs` 생성 경로는 실제 provider 미연결을 명확히 하기 위해 계속 501을 반환한다. 실제 공급자 어댑터는 이 정규화 ingress와 동일한 결과 계약을 만족해야 한다.
