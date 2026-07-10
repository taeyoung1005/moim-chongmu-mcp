# 중간장소 지도 결과 페이지 (v1) — 설계

- 날짜: 2026-07-10
- 대상: `services/moim-chongmu` — `find_midpoint` / `recommend_midpoint_places` 결과를 웹 지도로 시각화
- 레퍼런스: wemeetplace.com 스타일(카카오 지도 + 출발지 핀 + 중간점 + 장소 후보)

## 1. 목표 / 결정된 범위

채팅(자연어 → MCP)으로 출발지를 넣으면, 도구가 **공유 가능한 지도 결과 페이지 링크**를 돌려주고, 링크를 열면 카카오 지도에 출발지·중간점·장소 후보가 표시된다.

- 입력 UI(웹 입력 페이지)는 만들지 않는다 — 출발지는 채팅에서 자연어로 MCP 도구에 전달.
- **v1 포함**: 카카오 지도 + 출발지 핀 ①②③ + 중간점 마커 + 장소 후보 핀·카드 + 출발지별 공평성(직선거리) + 공유(링크 복사).
- **v1 제외(→ v2)**: 이동시간·경로선·대중교통/자가용 토글(= Kakao Mobility + ODsay 등 라우팅 API 통합).
- **제외(YAGNI)**: 웹 입력 페이지, 친구추가, 랜덤찾기.

## 2. 데이터 흐름

1. 채팅 → AI가 `find_midpoint` 또는 `recommend_midpoint_places` 호출(origins 자연어 파싱).
2. 도구가 결과 스냅샷을 **인메모리 저장(UUID, ~14일 TTL)** 하고, 마크다운 끝에 `- 지도 보기: {publicBaseUrl}/meet/{uuid}` 추가.
3. `GET /meet/{uuid}` → 서버가 스냅샷을 HTML에 JSON으로 심어 렌더. 클라이언트는 Kakao Map JS SDK로 마커만 플롯(추가 API 호출 없음).

보드와 동일한 **UUID capability 링크**(추측 불가, 링크 가진 사람만).

## 3. 신규/변경

### 신규
- `src/meet-plan-store.ts` — 인메모리 Map, UUID id, TTL. `save(plan)` / `find(id)` / prune. 저장 스냅샷(직렬화 가능):
  - `origins: {label, address?, x, y}[]`
  - `midpoint: {x, y}`
  - `fairness: {originLabel, distanceMeters}[]`
  - `places: {name, address, x, y, categoryCode?, placeUrl?, distanceMeters}[]`
  - `mode: "fixture"|"live"`, `sourceNote: string`, `createdAtMs`, `expiresAtMs`
- `src/meet-web.ts` — `handleMeetWebRequest(request, meetStore, kakaoMapJsKey?)`: `GET /meet/{id}` 처리(아니면 undefined). 없으면 404 안내 페이지.
- `src/meet-web-script.ts` — 클라이언트 JS 문자열(보드의 `voteInteractionScript`처럼). `window.__MEET__` 읽어 kakao.maps 초기화 → 출발지(번호)·중간점·장소 마커 추가 → `fitBounds` → 공유 버튼(링크 복사). SDK 없으면 no-op.

### 변경
- `src/service.ts`: env `KAKAO_MAP_JS_KEY` 읽기, `meetStore` 생성, `handleMeetWebRequest`를 `fetch` 체인에 추가(경로가 `/meet`라 `/boards`와 충돌 없음), 도구에 `meetStore` 주입.
- `src/service-tools.ts`: `find_midpoint`(places 없음)·`recommend_midpoint_places`(places 포함)가 스냅샷 저장 후 `- 지도 보기: {mapUrl}` 추가. `createMoimTools` 입력에 `meetStore` 추가.
- `services/moim-chongmu/.env.example`: `KAKAO_MAP_JS_KEY=` 추가.

## 4. 페이지 구조 (점진적 향상 + 폴백)

- **정적 결과는 항상 렌더**(JS/키 없어도 동작): 헤더, 중간점 요약, 출발지별 공평성 바, 장소 후보 카드(이름·주소·거리·카카오 링크), 공유 버튼.
- **`KAKAO_MAP_JS_KEY`가 있으면**: 상단에 `#map` 컨테이너 + Kakao SDK `<script>` + 인라인 JSON + 클라이언트 스크립트로 마커 플롯. SDK 로드 실패해도 정적 결과는 그대로 보임.
- 디자인 토큰은 보드와 동일(따뜻한 초록·라운드·카드·소프트 그림자) 재사용.

## 5. 검증

- 신규 유닛 테스트:
  - `meet-plan-store.test.ts`: save/find/TTL/prune.
  - `meet-web.test.ts`: 도구로 plan 생성 → `/meet/{id}` 링크 추출 → GET 200 + 중간점·장소명·공평성 포함; 없는 id → 404; **키 없을 때** SDK 스크립트 없이 정적 결과 존재(폴백); **키 있을 때** SDK 스크립트 + `window.__MEET__` 존재.
  - 도구 테스트: `find_midpoint`/`recommend_midpoint_places` 성공 출력에 `/meet/` 포함.
- 기존 테스트 불변(에러 케이스만 검증하므로 성공 출력 링크 추가는 안전).
- 로컬: 헤드리스 크롬으로 **폴백(무키) 렌더** 스크린샷. 실제 지도 렌더는 유효 Map JS 키 + 도메인 등록 필요(별도 확인).

## 6. v2 훅 (이동시간)

스냅샷에 `travelTimes: {originLabel, mode, minutes, polyline?}[]` 추가 여지를 남기고, 하단 시트에 교통수단 토글 자리를 비워둔다. 라우팅 API(Kakao Mobility 자가용 / ODsay 대중교통)만 붙이면 확장.

## 7. 리스크

- **fixture 모드**: 좌표가 서울 중심으로 뭉쳐 지도가 밋밋 → 데모엔 live 모드 + `KAKAO_REST_API_KEY` 권장.
- **Map JS 키/도메인**: 지도 렌더 자체가 JS 키 + KC 도메인 등록 필요 → 없으면 폴백으로 자동 강등(기능은 유지).
