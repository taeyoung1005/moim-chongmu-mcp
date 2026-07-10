# moim-chongmu 배포·등록 런북 (PlayMCP in KC → PlayMCP)

Agentic Player 10 제출용. 이 저장소(`moim-chongmu-mcp`)를 PlayMCP in KC에 **Git 소스 빌드**로 배포하고 PlayMCP에 등록하는 절차.

## 0. 전제·제약

- 예선 제출 및 KC 서버 발급 기간: **2026-06-15 ~ 2026-07-14** (여유 두고 진행).
- 개인 서버·타 클라우드는 요건 미충족 — **반드시 PlayMCP in KC 경유**.
- KC는 계정당 MCP 서버 **최대 2개** (`moim-chongmu`, `k-skill-korea`).
- Apple Silicon에서 컨테이너 이미지로 갈 경우 `--platform linux/amd64`로 빌드(arm64는 활성화 실패 가능). 이 저장소는 `linux/amd64` 로컬 빌드·구동·`/mcp`·`/meet` 스모크테스트를 통과했다.
- 제출 후 수정 시: KC에서 **같은 이름으로 삭제 후 재생성** → PlayMCP 정보 다시 불러오기 → 심사 재요청.

## 1. KC "Git 소스 빌드" 폼 값

| 필드 | 값 |
|---|---|
| MCP 서버 이름 | `moim-chongmu` |
| Git URL | `https://github.com/taeyoung1005/moim-chongmu-mcp.git` |
| 브랜치 / ref | `main` |
| Dockerfile 경로 | `Dockerfile` (루트 단일 파일, 기본값 그대로) |
| PAT | 비움 (public 저장소) |
| 컨테이너 포트 | **`8788`** (기본 `8000` 아님 — 서버가 8788 listen, 안 바꾸면 헬스체크 실패) |

환경변수·시크릿:

- `MOIM_COORDINATOR_DATA_MODE` — 기본 `fixture`(Dockerfile에 박혀 있어 생략 가능). 실제 지오코딩·장소검색을 쓰려면 `live`.
- `MOIM_COORDINATOR_PUBLIC_BASE_URL` — **Active 후** KC Endpoint 베이스(`/mcp` 제외)로 설정하고 재배포(§3). 없으면 투표/지도 링크가 `127.0.0.1`로 나온다.
- `KAKAO_MAP_JS_KEY` (선택) — 중간장소 결과 페이지 `/meet/*`의 **카카오 지도**와 live 주소→좌표·주변 장소 검색에 사용한다. 없으면 카드형 정적 결과와 fixture 데이터로 폴백. Kakao Developers **JavaScript 키** + 플랫폼 도메인에 KC Endpoint 도메인 등록 필요.
- 시크릿 `KAKAO_REST_API_KEY` (선택) — 카카오 Mobility 도로경로·이동시간 조회에 사용한다.

## 2. 대안: 컨테이너 이미지

```bash
docker build --platform linux/amd64 -f Dockerfile -t <REGISTRY>/moim-chongmu:<TAG> .
docker push <REGISTRY>/moim-chongmu:<TAG>
```

KC에서 이미지로 서버 생성. 포트·환경변수는 §1과 동일.

## 3. Active → Endpoint → 공개 URL 재설정 (2단계)

1. KC 서버 상태가 **`Active`**가 될 때까지 대기.
2. KC **Endpoint URL 복사** (예: `https://<host>.kc.playmcp.../`).
3. `MOIM_COORDINATOR_PUBLIC_BASE_URL`을 그 베이스로 설정하고 **재배포**. 이후 링크가 공개 주소로 나온다.
   - MCP 엔드포인트: `<Endpoint>/mcp`
   - 웹 투표 보드: `<Endpoint>/boards/<uuid>` · 중간장소 지도: `<Endpoint>/meet/<uuid>`

## 4. PlayMCP 등록 → 테스트 → 심사 → 공개

1. PlayMCP에 새 MCP 등록 → **MCP Endpoint**에 `<Endpoint>/mcp` 붙여넣기 → **`정보 불러오기`** 성공 확인 → **`임시 등록`**.
2. 툴박스에 추가하고 AI 챗으로 테스트:
   - "이번 주 토/일 저녁 6~9시로 민지·태영 가능 시간 보드 만들어줘" → `create_availability_board` (UUID 투표 링크)
   - "왕십리·성수·잠실 3명 중간지점이랑 근처 카페 찾아줘" → `recommend_midpoint_places` → **지도 보기 링크** 확인(열면 지도/카드 결과)
   - "아직 응답 안 한 사람에게 보낼 단톡방 리마인드 문구 만들어줘" → `make_chat_share_message` (자동 발송 없음)
3. 통과하면 **심사 요청** → 승인 후 `나에게만 공개` → **`전체 공개`** → 공개 상세 URL 복사 → 대회 지원서에 사용.

## 5. 데이터/영속성 메모

투표 보드와 중간장소 결과는 **서버 메모리에만** 저장(약 14일 TTL, 디스크·DB 없음). 재시작·재배포 시 초기화된다. 링크는 추측 불가능한 UUID capability URL. 장기 운영하려면 영속 저장소 도입이 별도 필요 — 대회 제출·심사에는 현재 인메모리로 충분.
