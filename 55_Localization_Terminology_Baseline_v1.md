# 55. Localization / Terminology Baseline v1

## 1. 목적

DOUL 감리앱의 업무 개념과 사용자 표시언어를 분리한다.

다국어 지원은 한국어 문자열을 다른 언어로 직역하는 기능이 아니다. 하나의 업무개념을 안정된 Term ID와 시스템 식별자로 관리하고, 각 언어는 그 의미를 현지 감리·건설 실무에 맞게 독립적으로 표현한다.

## 2. 기본 원칙

1. Domain / API / DB / State Machine 식별자는 번역하지 않는다.
2. 사용자에게 보이는 문자열은 Translation Key 또는 승인된 Term ID를 통해 표시한다.
3. 한국어는 현재 업무 검토의 Master 언어이지만 다른 언어는 한국어 문구를 연쇄번역하지 않는다.
4. UI 언어, 프로젝트 기본언어, 문서 출력언어를 분리한다.
5. 법정 제출문서의 언어요건은 개인 UI 설정보다 우선한다.
6. 베트남 법정 Final 문서에 적용 중인 베트남어 강제규칙은 유지한다.
7. 날짜·숫자·통화는 Locale-aware Formatter를 사용한다.
8. 새 언어 추가 때문에 업무 Domain 로직을 변경해서는 안 된다.

## 3. Locale 구조

- UI Locale: 사용자 개인 표시언어
- Project Primary Locale: 프로젝트 공식 협업 기본언어
- Project Secondary Locale(s): 병기·협업 보조언어
- Document Output Locale: 문서 생성 시 독립 선택
- Statutory Locale: 법령·계약으로 강제되는 출력언어

초기 등록 Locale:

- `ko / ko-KR` — Master review
- `vi / vi-VN` — Draft, 현장 전문용어 검수 필요
- `en / en-US` — Draft, 현장 전문용어 검수 필요

현재 vi/en은 부분 번역 상태이므로 최초 UI는 기존과 동일하게 `ko`로 시작한다. 사용자가 언어를 직접 선택하면 그 선택을 저장해 다음 접속부터 재사용한다. 전체 번역 승인 전에는 브라우저 언어만으로 자동 전환하지 않는다.

추가 언어는 동일 구조로 등록한다.

## 4. Fallback

기본 Fallback:

`requested locale → requested base language → ko`

Fallback은 표시 누락 방지용이며 번역 완료판정을 의미하지 않는다.

## 5. 현장용어 Term ID

`app/reference/terminology_catalog_v1.json`을 현장용어 기준선으로 사용한다.

예:

- `QA-INSP-REQ-001` — 검측요청
- `QA-FIELD-INSP-001` — 현장검측
- `QA-CORR-001` — 시정조치
- `PAY-CLAIM-001` — 기성청구
- `PAY-REC-001` — 지급추천
- `OWN-DEC-001` — 발주처 결정

Term ID의 의미가 기준이며 각 Locale Label은 별도 검토대상이다.

## 6. UI 구현

Web과 Mobile은 같은 `@doul/localization` 언어팩과 Translation Key를 사용한다.

Web:

- `i18next + react-i18next`
- `localStorage`에 사용자 언어 선택 저장
- HTML `lang/dir` 동기화
- Navigation / Role / App chrome Translation Key 적용
- 기존 `roles / states / commands / fields / reason` 490개 한국어 Label을 `@doul/localization`의 한국어 Master 사전으로 이동
- 기존 화면 코드는 `apps/web/src/labels.ts` 호환 계층을 통해 현재 Locale을 자동 조회하며, 미번역 항목은 한국어 Master로 Fallback
- Locale-aware date / number / currency helper

Mobile:

- `i18next + react-i18next`
- 기존 `expo-sqlite`의 `expo-sqlite/kv-store`에 사용자 언어 선택 저장
- Hermes 환경의 plural rule 호환을 위한 `intl-pluralrules` 적용
- 역할·상태·업무명령·Navigation·촬영·설정·오류문구를 공통 Translation Key로 전환
- 앱 화면에 한국어 UI 문자열을 직접 하드코딩하지 않는 기준 적용

현재 vi/en은 Draft이므로 Web과 Mobile 모두 최초 기본언어는 `ko`로 유지한다. 사용자가 직접 선택한 언어만 이후 접속에서 재사용한다.

관리대장 전체 필드·Web 상세 페이지 본문·서버가 제공하는 업무 데이터의 다국어 표현은 후속 현장 UX 정합화 단계에서 확대한다.

## 7. 문서

앱 UI 언어와 A4 문서 출력언어는 독립한다.

지원 목표:

- 단일언어 출력
- 한·베 병기
- 한·영 병기
- 승인된 임의 Locale 조합 병기

법정 원본서식과 법정 언어요건은 DOUL 내부 다국어 편의기능으로 대체하지 않는다.

## 8. 번역 완료판정

Locale별 완료조건:

1. Translation Key 누락 0
2. 현장 핵심 Term ID 전문검수 완료
3. 긴 문자열 / Table / Badge 레이아웃 검증
4. 날짜·숫자·통화 표시 검증
5. Role별 실제 유즈케이스 수행 가능
6. 문서 출력 언어와 UI 언어 독립 동작
7. 현지 직원 Pilot 통과

## 9. 현재 단계

이번 v1은 다국어 기술기반과 용어관리 계약을 확정한다.

베트남어·영어 전문용어는 아직 Final이 아니다. 전체 기능개발 및 한국어 현장 UX 정합화 후 현지 실무자 검수를 거쳐 승인한다.
