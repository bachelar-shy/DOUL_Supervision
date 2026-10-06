# 52. Media Analysis Operations Policy v1.0

기준일: 2026-10-06
대상: 기존 `20_Media_Analysis_Detailed_Definition.md`의 운영 미확정 항목만 보완

## 1. 자동 Retry와 사용자 Reanalysis

자동 Retry:
- transient infrastructure/provider failure만 대상
- 동일한 logical request를 재처리하되 새 execution attempt를 기록
- 무한 재시도 금지
- 프로젝트별 maxAttempts/backoff/cost ceiling 적용
- 성공한 결과를 소급 수정하지 않는다.

사용자 Reanalysis:
- SUP가 명시적으로 요청
- 새 AnalysisRun을 만든다.
- `reanalysisOfId`와 요청사유를 기록한다.
- 모델/prompt/policy가 달라질 수 있으므로 이전 결과를 덮어쓰지 않는다.
- 이전 confirmed/rejected Human Review도 역사로 유지한다.

## 2. Failed / Cancelled

`failed`:
- 실행이 완료결과 계약을 만족하지 못함
- failureCode, failedStage, retryable, processedCoverage를 남긴다.
- 이미 생성된 유효한 부분결과가 있으면 `partialResultPreserved=true`로 보존 가능하지만 전체 완료로 표시하지 않는다.

`cancelled`:
- 사용자/시스템이 더 이상 처리를 진행하지 않도록 중지
- cancelRequestedBy, requestedAt, effectiveAt, reason을 기록한다.
- 취소 전 생성된 원본/파생 Evidence를 삭제하지 않는다.
- 취소가 공식 Inspection/Issue 상태를 바꾸지 않는다.

## 3. 비용과 자원 제한

Project Configuration에서 최소:
- per-run 비용한도
- 월 비용한도
- 최대 파일크기/길이
- analysis mode 허용목록
을 정한다.

비용한도 초과 예상 시 자동으로 낮은 분석모드로 바꾸지 않는다. 실행을 보류하고 사용자에게 정책위반을 표시하거나 승인된 fallback만 사용한다.

## 4. 외부 모델 반출

정책값:
- `forbidden`
- `approved_only`
- `allowed_under_contract`

외부반출 시 최소 provider, region/data residency, source scope, redaction status, policy/config version을 Audit한다.

현장 원본이 외부반출 금지인 경우 파생/비식별 사본도 승인정책을 통과해야 한다.

## 5. Export / Sharing

- 원본 Export는 명시적 권한 필요
- 공유사본은 필요 시 비식별화
- Export 결과는 source Evidence와 derivation을 유지
- Export는 원본 삭제나 소유권 이전을 의미하지 않는다.

## 6. 보존과 삭제

- 원본 Evidence의 보존기간은 계약·법·Project policy를 따른다.
- 공식 기록과 연결된 Evidence는 일반 사용자 삭제로 제거하지 않는다.
- 삭제예외/법적보존은 별도 결정과 Audit가 필요하다.

## 7. 사람 검토와 재분석 관계

- 새 Reanalysis가 기존 공식 Human Review를 자동 무효화하지 않는다.
- 서로 다른 Run이 상충하면 SUP 검토대상으로 표시한다.
- 최신 Run이라는 이유만으로 이전 Run보다 우선한다고 추정하지 않는다.
- 공식 Issue 생성은 Issue 생성 시점의 현재 Inspection 상태와 eligible confirmed observation을 다시 검증한다.

## 8. UI 필수표시

- run source/retry/reanalysis chain
- queued/running/succeeded/failed/cancelled
- partial/full coverage
- missing ranges
- model/prompt/policy version
- 예상/실제 비용이 제공되는 경우 그 값과 한도
- external transfer policy/result
- Human Review 상태

## 9. Backend / Platform 경계

Product는 사용자에게 보이는 의미와 보존원칙을 정의한다.

Backend는 Queue claim/idempotency/retry/transition/result validation을 구현한다.
Platform은 Worker runtime, provider connectivity, resource/cost observability를 제공한다.

Worker heartbeat는 분석업무가 처리되고 있다는 의미가 아니다.
