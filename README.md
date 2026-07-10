# 모임좌표 MCP

단톡방 약속의 가능 시간, 중간지점, 장소 후보, 공유문을 한 번에 정리하는 PlayMCP MCP 서버입니다.

## 기능

- 후보 날짜와 시간대 기반 가능 시간 보드 생성
- 웹 링크에서 참여자 이름과 임시 비밀번호로 가능 시간 투표
- 모든 참여자 응답 후 겹치는 시간 heatmap 표시
- 여러 출발지 기준 중간 좌표 계산
- 중간지점 주변 장소 후보 추천
- 단톡방에 직접 붙여넣을 공유문 생성

## 로컬 실행

```sh
npm ci
npm run build
PORT=8788 node services/moim-chongmu/dist/index.js
```

Health check:

```sh
curl http://127.0.0.1:8788/health
```

MCP endpoint:

```text
http://127.0.0.1:8788/mcp
```

## Docker

PlayMCP in KC 제출용 이미지는 `linux/amd64`로 빌드합니다.

```sh
docker build --platform linux/amd64 -t moim-chongmu:latest .
docker run --rm -p 8788:8788 moim-chongmu:latest
```

## 등록 자료

- 등록 문안: `docs/playmcp-registration.md`
- 로고 PNG: `assets/logo.png`
- 로고 SVG: `assets/logo.svg`
