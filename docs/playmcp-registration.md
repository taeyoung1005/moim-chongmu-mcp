# PlayMCP 등록 문안: 모임좌표

## 기본 정보

- 등록 이름: 모임좌표
- 식별 이름: `moimChongmu`
- 대체 식별 이름: `moimSpot`
- 카테고리 추천: 생산성 / 일정 / 로컬
- 인증 방식: 없음
- MCP Endpoint: PlayMCP in KC에서 발급된 Endpoint URL의 `/mcp`
- 로고: `submissions/moim-chongmu/assets/logo.png`

## 한 줄 소개

단톡방 약속의 가능 시간, 중간지점, 장소 후보, 공유문을 한 번에 정리하는 모임 조율 MCP입니다.

## 상세 설명

모임좌표는 카카오톡 단톡방에서 "언제 어디서 볼지"를 빠르게 정하게 돕는 MCP입니다. 참석자별 가능한 시간을 when2meet처럼 모아 겹치는 구간을 시각화하고, 여러 출발지의 중간 좌표와 주변 장소 후보를 정리합니다. 마지막에는 사람이 직접 단톡방에 붙여넣을 수 있는 공유문과 리마인드 문구까지 만들어 줍니다.

자동 메시지 발송, 친구 목록 조회, 채팅방 접근, 결제, 예약, 송금은 하지 않습니다. 가능 시간 보드는 임시 웹 링크로 열리며, 참여자는 자기 이름과 임시 비밀번호로 본인 응답만 수정할 수 있습니다. 결과 heatmap은 모든 참여자가 응답한 뒤 표시됩니다.

## 주요 기능

- 후보 날짜와 시간대 기반 가능 시간 보드 생성
- 웹 링크에서 참여자 이름과 임시 비밀번호로 가능 시간 투표
- 모든 참여자 응답 후 겹치는 시간 heatmap 표시
- 미응답자와 최적 시간 후보 요약
- 여러 출발지 기준 중간 좌표 계산
- 중간지점 주변 카페, 식당, 지하철, 문화시설 후보 추천
- 단톡방에 직접 붙여넣을 공유문과 리마인드 문구 생성

## 도구 목록

- `create_availability_board`: 후보 날짜와 시간대로 가능 시간 보드를 만들고 웹 투표 링크를 반환합니다.
- `mark_availability`: MCP state 기반으로 참여자 가능 시간을 표시합니다.
- `summarize_best_times`: 겹치는 시간, 응답 현황, 미응답자를 요약합니다.
- `find_midpoint`: 여러 출발지 좌표나 주소 기준 중간지점을 계산합니다.
- `recommend_midpoint_places`: 중간지점 주변 만날 장소 후보를 추천합니다.
- `make_chat_share_message`: 자동 발송 없이 사람이 직접 보낼 공유문을 작성합니다.

## 스타터 메시지

- "17일부터 30일까지 저녁 6시부터 9시 사이로 민지, 태영 가능한 시간 확인하자."
- "강남, 홍대에서 만나는 중간지점 근처 카페 후보 찾아줘."
- "아직 응답 안 한 사람에게 보낼 단톡방 리마인드 문구 만들어줘."

## 데이터 및 안전 정책

이 MCP는 기본적으로 인증 없는 read-only helper입니다. 서버는 외부 계정 로그인, 친구 목록, 채팅방 내용, 캘린더, 결제 정보를 읽거나 쓰지 않습니다. 가능 시간 보드는 서버 프로세스 메모리에 임시 저장되며(약 14일 후 자동 만료), 운영 DB나 장기 보관 저장소에 기록하지 않습니다. 보드 링크는 추측 불가능한 UUID로 발급되어 링크를 받은 사람만 열람할 수 있습니다.

주소와 장소 추천은 기본 `fixture` mode에서 안정적으로 동작합니다. live mode를 켜고 `KAKAO_MAP_JS_KEY`와 등록된 Endpoint 도메인을 제공한 경우 공식 지역 검색 API 경계 뒤에서 주소/장소 조회를 수행합니다. `KAKAO_REST_API_KEY`는 도로경로·이동시간 조회에만 사용합니다. 외부 API가 실패하거나 timeout이 발생하면 raw upstream error를 노출하지 않고 안전한 안내와 fallback 응답을 반환합니다.

## 심사 요청 메모

모임좌표는 카카오톡 단톡방 약속 조율에 집중한 무인증 MCP입니다. 핵심 흐름은 `create_availability_board`로 웹 투표 링크를 만들고, 참여자가 이름과 임시 비밀번호로 가능 시간을 입력한 뒤, 전원 응답 후 겹치는 시간 heatmap을 확인하는 방식입니다. 카카오톡 메시지는 자동 전송하지 않으며, `make_chat_share_message`는 사용자가 직접 복사해 보낼 문구만 생성합니다.

## 배포 메모

PlayMCP in KC에는 이 폴더의 Dockerfile을 사용해 `linux/amd64` 이미지로 빌드한 뒤 등록합니다.

```sh
docker build --platform linux/amd64 -f submissions/moim-chongmu/Dockerfile -t moim-chongmu:latest .
```

서버가 `Active`가 되면 PlayMCP 등록 화면의 MCP Endpoint에 PlayMCP in KC Endpoint URL을 붙여넣고 `정보 불러오기`를 확인합니다.
