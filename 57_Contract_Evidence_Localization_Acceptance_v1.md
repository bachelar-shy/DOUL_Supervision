# 57. Contract and Evidence Detail Localization — UI Acceptance v1

## 목적 및 적용 범위

DOUL 감리앱 현장 용어·다국어 기반의 후속 작업으로, 계약관리 상세 화면과 증빙 상세 화면에 남아 있던 고정 한국어 문구를 기존 공통 번역 키로 전환했다.

- Contract Notice / Claim / EOT: 생성 양식, 검토·결정 경계, 오류·안내, 상세·명령·원본 버전 표시.
- Evidence Detail: 기본정보, 출처·연결, 기술정보, 원본 보존 및 판정 경계 표시.
- Korean: 업무 용어의 기존 Master 의미와 서버 계약을 유지.
- Vietnamese/English: 화면 사용을 위한 미검수 번역 초안. **현장·계약 전문용어의 최종 검수와 승인 모두 보류.**

## 변경 사항

1. 계약관리 `ContractPage.tsx`에 연결되지 않았던 `contract.*` 키를 적용하고 `contract-translations.ts`의 ko/vi/en 초안 키를 일치시켰다.
2. 증빙 상세 `EvidenceDetailPreview.tsx`의 하드코딩 한국어를 `evidence.*` 키로 정리하고, `evidence-translations.ts`에 vi/en 초안 사전을 추가했다.
3. 'Domain version'은 '원본 기록 버전'으로 표시하되 기술 스키마와 저장 필드명은 유지한다.
4. UI Mock Preview에서는 계약 기록 작성 양식을 열어 언어별 화면을 검토할 수 있다. **생성/제출 버튼은 비활성화되며 서버 계약 객체는 생성하지 않는다.**
5. 증빙 상세의 탭(기본정보 / 출처·연결 / 기술정보)을 3개 표시언어로 제공한다.
6. 서버 원본 값·당사자명·증빙 ID·계약결정 결과·원본 메타데이터는 사용자 UI 언어 변경에 의해 수정하거나 재번역하지 않는다.

## 검증

브라우저 UI Mock 격리 환경(port 5192):

```sh
npx playwright test --config=playwright.localization.config.ts --reporter=line
```

추가 확인 항목:
- 계약통지 모의 작성창의 언어 전환 및 입력값 유지
- 베트남어·영어 생성/권한 안내와 모의 제출 차단
- 계약통지·클레임·EOT 탭 전환
- 증빙 원본 ID 유지, 판정 경계, 원본/기술 상세 번역
- 390px와 1440px 화면에서 횡스크롤 및 상세창 위치 확인
- ko/vi/en에서 동일한 번역 키와 보간 변수 사용

전체 검증 게이트:

```sh
npm run test:contracts
npm run typecheck
npm run web:build
python3 scripts/check_ui_boundary.py
git diff --check
```

## 남은 범위

- 베트남어·영어 전문 용어 및 현지 법령 표현의 검수·승인: **사용자 요청에 따라 추후 수행**
- 실제 API 연결을 통한 역할별 End-to-End 업무 검증: UI Mock 테스트와 별도
- 다국어 법정 문서 출력과 병기 양식의 완성 및 검증
- 사용자 입력 원문·계약 원본·증빙 출처 값은 원칙적으로 번역하지 않음
- 번역 최종 완료 판정은 용어 검수·문서 언어요건·현장 시범 사용 후 진행

본 단계에서는 용어의 베트남어·영어 표현을 **최종 승인하지 않는다.**
