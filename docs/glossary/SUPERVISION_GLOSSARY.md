# DOUL Supervision — 감리 표준 용어사전 (Glossary)

- 문서 버전: 0.4.1 (앱 연동 준비)
- 기준 언어: 한국어(ko)
- 대상: 감리자, 시공사, 발주처가 사용하는 화면·문서·관리대장 용어
- 관리 상태: **초안 — 현장 실무 및 국가별 법령 검수 전**
- 데이터 기준: v0.4의 용어 ID `SUP-0001` 형식; 원본 목록 592개는 별도 데이터 파일이며 이 문서에 모두 포함된 상태는 아님

## 1. 목적

이 문서는 DOUL 감리앱에서 IT 중심 표현을 현장 실무 표현으로 일관되게 바꾸기 위한 **별도 표준 문서**이다. 개별 용어의 긴 정의는 추후 보완한다. 이 문서에 표시된 번역은 참고안이며 법적 등가성을 보증하지 않는다.

## 2. 명명 규칙

1. 화면은 한국어 표준명을 기본으로 사용한다. `Dashboard` 대신 `현장 종합현황` 등 현장 표현을 쓴다.
2. 기술적 식별자(API, DB 컬럼, 이벤트, 상태 코드)는 표시명과 분리한다. 사용자 화면의 용어 변경이 기존 데이터·업무 흐름을 바꾸지 않아야 한다.
3. `검토`, `확인`, `검측`, `검사`, `승인`, `보고`, `지시`는 상호 대체하지 않는다. 역할·권한·책임에 맞게 구분한다.
4. `Issue`는 일괄 `지적사항`으로 번역하지 않는다. 품질은 `부적합/지적사항`, 설계는 `기술질의/설계현안`, 공정은 `지연사항`, 발주처 결정은 `결정 요청사항`으로 문맥을 구분한다.
5. 한국과 베트남의 법적 역할명은 국가별 근거를 별도로 관리한다. `Chủ đầu tư`는 프로젝트 법적 맥락에 따라 단순 `발주처`와 동일하지 않을 수 있다.
6. 번역 미검수 시 한국어를 표시하고 미검수 번역을 공식 확정 명칭으로 사용하지 않는다.

## 3. 앱 공통 표시명 (우선 적용 후보)

| 개발 표현 | 한국어 표시명 | 적용 맥락 |
|---|---|---|
| Dashboard | 현장 종합현황 | 첫 화면 |
| Register | 관리대장 | 업무별 목록 |
| Workflow | 업무처리 절차 | 업무 단계 안내 |
| Task | 담당 업무 / 조치사항 | 할 일·시정조치 구분 |
| Assignee | 담당자 | 책임자 표시 |
| Status | 처리상태 | 접수·검토·조치·종결 |
| Attachment | 첨부자료 | 문서·사진·영상 |
| Drawing Viewer | 도면 열람 | 도면 보기 |
| Drawing Markup | 도면 지적사항 표시 | 도면 위 마킹 |
| Inspection Request | 검측 요청 | 시공사 요청 |
| Inspection Result | 검측 결과 | 검측 처리 |
| Approval Request | 승인 요청 | 승인 권한 있는 업무 |
| RFI | 기술질의서 | 설계·시공 질의 |
| NCR | 부적합 보고서 | 품질 부적합 |
| Punch List | 미비사항 목록 | 준공·인계 전 점검 |
| Audit Trail | 처리이력 | 변경·승인 기록 |
| Revision | 개정번호 | 도면·문서 |
| Submittal | 제출자료 | 자재·도면·계획서 |
| Daily Report | 일일 현장보고 | 현장 일보 |
| Progress Report | 공정현황 보고 | 공정 보고 |
| Corrective Action | 시정조치 | 품질·안전 지적 |
| Closeout | 종결 처리 | 조치 완료 후 확인 |

## 4. 현장 핵심 용어

| 분야 | 표준 용어 | 영문 참고 | 베트남어 참고 | 검수 |
|---|---|---|---|---|
| 조직 | 발주처 | Owner / Client | Chủ đầu tư | 미검수 |
| 조직 | 시공사 | Contractor | Nhà thầu thi công | 미검수 |
| 조직 | 감리자 | Construction supervisor | Tư vấn giám sát | 미검수 |
| 조직 | 현장대리인 | Site representative | Chỉ huy trưởng công trường | 미검수 |
| 도면 | 설계도서 | Design documents | Hồ sơ thiết kế | 미검수 |
| 도면 | 시공도 | Shop drawing | Bản vẽ thi công | 미검수 |
| 도면 | 준공도 | As-built drawing | Bản vẽ hoàn công | 미검수 |
| 품질 | 검측 | Inspection | Nghiệm thu công việc xây dựng | 맥락 확인 필요 |
| 품질 | 자재승인 | Material approval | Phê duyệt vật liệu | 미검수 |
| 품질 | 시험성적서 | Test report | Kết quả thí nghiệm | 미검수 |
| 품질 | 부적합 | Nonconformity | Sự không phù hợp | 미검수 |
| 안전 | 위험성평가 | Risk assessment | Đánh giá rủi ro | 미검수 |
| 안전 | 작업중지 | Stop work | Dừng thi công | 미검수 |
| 공정 | 예정공정표 | Baseline schedule | Tiến độ kế hoạch | 미검수 |
| 공정 | 공정지연 | Schedule delay | Chậm tiến độ | 미검수 |
| 기성 | 기성검사 | Progress payment inspection | Nghiệm thu khối lượng hoàn thành | 맥락 확인 필요 |
| 문서 | 회의록 | Minutes of meeting | Biên bản họp | 미검수 |
| 문서 | 공문 | Official correspondence | Công văn | 미검수 |
| 준공 | 준공검사 | Completion inspection | Nghiệm thu hoàn thành | 맥락 확인 필요 |
| 준공 | 인수인계 | Handover | Bàn giao | 미검수 |

## 5. 용어 데이터 계약 (앱 개발 기준)

각 용어는 `id`, `domain`, `label.ko/en/vi`, `aliases`, `definition`, `source`, `review`, `active` 필드를 갖는다. 정의가 없는 경우 `null` 허용. 원본 ID는 불변. 화면의 표시 문자열을 식별자로 사용하지 않는다.

- 용어 수정: 번역·표시명 변경은 ID 유지
- 중복 관리: 동일 문자열이라도 업무 맥락이 다르면 구분
- 다국어: 미검수 번역은 공개 전 검수
- 데이터 수집: 원본 592개 파일을 앱에 적재한 뒤 기존 UI 29개 관리대장·36개 양식과 매핑
- 변경 기록: 수정 사유, 검토자, 적용 버전 관리

## 6. 참고할 공식 자료원

| 국가 | 기관·자료 | URL |
|---|---|---|
| 한국 | 국가법령정보센터 | https://www.law.go.kr |
| 한국 | 건설기술정보시스템(CODIL) | https://www.codil.or.kr |
| 한국 | 국가건설기준센터 | https://www.kcsc.re.kr |
| 한국 | e나라표준인증 | https://www.standard.go.kr |
| 베트남 | 국가 법률문서 데이터베이스 | https://vbpl.vn |
| 베트남 | 건설부 | https://moc.gov.vn |
| 베트남 | 정부 법령문서 포털 | https://vanban.chinhphu.vn |

**주의:** 상기 URL은 자료원 링크이며 각 용어에 대한 조항별 근거 검증을 의미하지 않는다.

## 7. 향후 작업

1. v0.4의 592개 용어 원본 데이터(JSON·CSV)를 저장소에 별도 추가
2. 앱 화면·관리대장·양식의 실제 문자열과 ID 매핑
3. 법령·번역·용어 검수 후 적용 범위 확대
4. 개별 정의는 후속 단계에서 작성
