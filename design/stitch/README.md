# Stitch 화면 기준표

프로젝트: **DOUL Supervision MVP** (`11486949689509673114`)

16종 리소스를 생성·조회했다. 캔버스 크기까지 확인한 것은 13종이다. 모바일 3종은 390px용 보정 리소스가 있지만 기존 캔버스 프레임은 아직 1280px이므로 교체 확인을 완료로 표시하지 않는다. 기존 사용자 화면 2개는 보존했다.

| 코드 | 사용자 | 환경 | 리소스 조회 | 캔버스 확인 | Screen ID |
|---|---|---|---|---|---|
| ADM-ROLES-W | ADM | desktop | 확인 | 확인 | `995f7161f0624738bd8c6bc5e16cab74` |
| CON-CORRECTION-M | CON | mobile | 확인 | **보정본 반영 미확인** | `b9a29a02f53d4f85b71190b8fb39523f` |
| CON-CORRECTION-W | CON | desktop | 확인 | 확인 | `ccb31a1e70f749c7a1263b91e7cfd17e` |
| DES-RFI-W | DES | desktop | 확인 | 확인 | `b7cdc0de938c48d4bfbf2ff45ae9afbe` |
| DOC-AUTHOR-W | SUP | desktop | 확인 | 확인 | `5e3f034ede7441a0af230b8c01070b39` |
| OWN-DECISION-M | OWN | mobile | 확인 | 확인 | `e74e223cace443e88008068f742971cb` |
| OWN-DECISION-W | OWN | desktop | 확인 | 확인 | `8d2da76d8c0c420d8372ad51c560cf50` |
| SUP-CAPTURE-M | SUP | mobile | 확인 | **보정본 반영 미확인** | `6fbf64fc3c6148a3952927f0d4ef3d40` |
| SUP-INSPECTION-M | SUP | mobile | 확인 | **보정본 반영 미확인** | `1ecce73fe9c24d0f9574ed6e8ccb30ed` |
| SUP-INSPECTION-W | SUP | desktop | 확인 | 확인 | `b6c695d6480b45f08ceb7e7be5e17131` |
| SUP-MEDIA-W | SUP | desktop | 확인 | 확인 | `ec2af7e3bd704abba9f49d3dbef0a8e0` |
| SUP-OBSERVATION-M | SUP | mobile | 확인 | 확인 | `78b537abef944823bfac65a6e86fca72` |
| SUP-OBSERVATION-W | SUP | desktop | 확인 | 확인 | `0659fbf32911408fadfb8d879c67beec` |
| SUP-REINSPECTION-M | SUP | mobile | 확인 | 확인 | `b9e022497daa44acb63daecd6a5ec8c0` |
| SUP-REINSPECTION-W | SUP | desktop | 확인 | 확인 | `68726af599ff4212ba9d29d87b6c96f1` |
| SUP-TODAY-W | SUP | desktop | 확인 | 확인 | `2c9210cdb973447ba93cb83ee014b930` |

생성된 화면은 사용자 승인 전 초안이다. `screens.json`은 실제 코드 경로 및 기존 상태모델 명령과 연결한다. 원시 생성 응답·임시 자산 URL은 `.local/stitch/`에만 보관한다.

MCP 편집 응답의 DOM 변경 이벤트만으로는 서버 캔버스 크기가 변경됐다고 판단하지 않는다. `get_project`로 재조회한 실제 인스턴스와 비교한다.
