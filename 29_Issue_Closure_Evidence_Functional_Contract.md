# 29. Issue 종결증빙 Functional Contract v1.0

기준일: 2026-10-06
관련 이슈: GitHub Issue #13
대상: Issue / Action / Reinspection / Evidence
상위원칙: Issue 종결과 발주처 보고 종결은 별개다.

---

## 1. Product 결정

Issue를 `closed`로 전환할 때 일반 `evidenceIds`의 존재만으로 종결증빙 요건을 충족한 것으로 보지 않는다.

Close 명령은 `closureEvidenceIds`를 **명시적 필수 입력**으로 받아야 한다.

종결증빙은 반드시 “Close 시점에 새로 업로드한 파일”일 필요는 없다. 다만 현재 `correctionCycle`의 시정·검증 과정에 실제로 사용된 Evidence여야 한다.

따라서 Issue 생성 당시의 원인사진·관찰증빙만 존재하는 경우에는 Issue를 종결할 수 없다.

---

## 2. 종결 Gate

Issue Close에는 기존 Gate와 함께 다음 조건이 모두 필요하다.

1. Issue 상태가 `reinspection`
2. 현재 Cycle의 Corrective Action이 검증 또는 종결됨
3. 현재 Cycle의 재검측이 합격이고 공식 검수기록/서명이 완료됨
4. 재검측 후속공정 Release가 완료됨
5. `closureEvidenceIds`가 Close 명령에 명시됨
6. `closureEvidenceIds`에 현재 Cycle의 검증된 Corrective Action Evidence가 최소 1건 포함됨
7. `closureEvidenceIds`에 현재 Cycle의 합격 Reinspection Evidence가 최소 1건 포함됨
8. 선택된 모든 종결증빙이 동일 프로젝트와 Issue 업무범위에 속함
9. 적용 Requirement/ITP가 시험결과를 종결조건으로 요구하면 해당 시험결과 Evidence가 포함됨

---

## 3. Evidence 구분

### 원인·관찰 증빙

예:

- 최초 결함 사진
- 최초 측정값
- AI Observation의 원본 영상/사진
- 최초 불합격 검측 Evidence

용도:

- Issue 발생 근거
- 원인과 위치 확인

이 증빙만으로는 종결할 수 없다.

### 시정조치 증빙

예:

- 시정 후 사진
- 교체·보수 기록
- 시공사 시정조치 제출자료
- 재발방지 조치 확인자료

현재 Cycle의 Action에 연결되고 SUP가 검증한 Evidence여야 한다.

### 재검측 증빙

예:

- 재검측 사진
- 재측정값
- 합격 Check Result의 Evidence
- 서명된 검측기록의 근거자료

현재 Cycle의 최종 합격 Reinspection에 연결되어야 한다.

### 시험 증빙

시험이 적용되는 Issue는 필요 시 다음을 추가한다.

- 재시험 결과
- Lab Report
- 계측 결과
- 성능시험 결과

시험기관의 원본 Report는 Evidence이며 최종 기술판정은 SUP 권한이다.

---

## 4. `closureEvidenceIds` 의미

`closureEvidenceIds`는 Issue 전체 Evidence 목록의 복사본이 아니다.

정의:

> 감리자가 Issue를 종결하면서 “이 Evidence들이 현재 시정 Cycle의 완료 및 재검증을 직접 입증한다”고 명시적으로 선택한 Evidence ID 목록

규칙:

- Close 명령 입력에서 명시한다.
- 빈 목록은 허용하지 않는다.
- 중복 ID를 허용하지 않는다.
- 현재 Cycle Action/Reinspection에 연결되지 않은 Evidence는 허용하지 않는다.
- 다른 Project/Package/Location/Discipline 범위의 Evidence는 허용하지 않는다.
- 과거 Cycle의 증빙만으로 현재 Cycle을 종결하지 않는다.
- Close 시 `evidenceIds` 전체를 자동 복사하지 않는다.

---

## 5. 여러 시정 Cycle

재검측 실패 후 `correctionCycle`이 증가하면 종결 판단은 **현재 Cycle**만을 기준으로 한다.

예:

~~~text
Cycle 0
시정 A → 재검측 Fail

Cycle 1
시정 B → 재검측 Pass → Close
~~~

종결 시:

- Cycle 0의 실패·시정·증빙은 Audit History로 유지
- Cycle 1의 Action Evidence와 Reinspection Evidence가 종결 Package에 포함
- Cycle 0 Evidence만 선택하여 Close할 수 없음

과거 기록은 삭제하지 않는다.

---

## 6. 명령 계약

Issue `close`:

~~~text
command: close
required payload:
  closureEvidenceIds: EvidenceId[]
~~~

주요 실패사유:

- `COMMAND_FIELD_REQUIRED`
- `CLOSURE_EVIDENCE_REQUIRED`
- `CLOSURE_ACTION_EVIDENCE_REQUIRED`
- `CLOSURE_REINSPECTION_EVIDENCE_REQUIRED`
- `CLOSURE_EVIDENCE_SCOPE_INVALID`
- `CURRENT_ACTIONS_VERIFIED`
- `REINSPECTION_PASSED`

`closureEvidenceIds`는 Audit Event의 command request에 포함되어 누가 어떤 근거를 선택해 종결했는지 재현할 수 있어야 한다.

---

## 7. Application / UI 계약

Issue Case 화면은 Close 가능 여부와 함께 현재 Cycle에서 선택 가능한 종결증빙 후보를 제공한다.

`closureEvidenceCandidateIds`는 다음 합집합이다.

- 현재 Cycle의 verified/closed Action Evidence
- 현재 Cycle의 최종 Reinspection Evidence
- Reinspection Check Result Evidence

UI는 일반 Issue Evidence 전체를 “종결증빙”으로 자동 선택하지 않는다.

사용자는 Close 전에 최소 다음을 확인할 수 있어야 한다.

- 시정조치 검증 완료 여부
- 합격 재검측 여부
- 시정 Evidence
- 재검측 Evidence
- 필요한 시험 Evidence
- 최종 선택된 `closureEvidenceIds`

---

## 8. 발주처 보고와의 관계

Issue가 `closed`가 되어도 Owner Report는 자동 종결하지 않는다.

Issue 종결 후 발주처 보고가 필요한 경우:

> Issue closed → Owner Report 발행 → 수령확인 → 후속조치/결정 → 검증 → Report closed

를 별도로 수행한다.

발주처 종결보고 작성 시 Issue의 `closureEvidenceIds`와 정확한 source version을 참조한다.

---

## 9. 회귀검증 조건

최소 다음 시나리오를 유지한다.

1. `closureEvidenceIds` 없이 Close → 실패
2. 최초 원인증빙만 종결증빙으로 선택 → 실패
3. 현재 Cycle Action Evidence 누락 → 실패
4. 현재 Cycle Reinspection Evidence 누락 → 실패
5. 다른 범위 Evidence 선택 → 실패
6. 현재 Cycle Action + 합격 Reinspection Evidence 선택 → Close 성공
7. Close 후 `closureEvidenceIds`가 선택값 그대로 보존됨
8. 이전 Cycle 증빙과 실패 이력은 삭제되지 않음

---

## 10. Issue #13 결론

| 질문 | 결정 |
|---|---|
| 새로운 종결증빙을 반드시 요구하는가 | Close 시 새 업로드 자체는 강제하지 않지만, 현재 Cycle의 시정·재검증 근거를 반드시 요구 |
| 기존 evidenceIds 사용 가능 여부 | 일반 evidenceIds 존재만으로 불가. 현재 Cycle Action/Reinspection에 실제 연결된 Evidence만 가능 |
| closureEvidenceIds 분리 여부 | Close 명령의 명시적 필수 입력으로 분리 |
| 최소 구성 | 현재 Cycle의 검증된 시정조치 Evidence + 합격 재검측 Evidence. Requirement/ITP 요구 시 시험 Evidence 추가 |
