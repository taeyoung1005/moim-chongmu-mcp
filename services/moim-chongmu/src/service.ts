import { createServiceApp, type ServiceApp } from "@playmcp/mcp-common"

import {
  type AvailabilityBoardStore,
  createAvailabilityBoardStore,
} from "./availability-board-store.js"
import { handleAvailabilityBoardWebRequest } from "./availability-web.js"
import { createMeetPlanStore, type MeetPlanStore } from "./meet-plan-store.js"
import { handleMeetWebRequest } from "./meet-web.js"
import { createMoimTools } from "./service-tools.js"

export type MoimChongmuServiceOptions = {
  readonly boardStore?: AvailabilityBoardStore | undefined
  readonly meetStore?: MeetPlanStore | undefined
  readonly publicBaseUrl?: string | undefined
  readonly kakaoMapJsKey?: string | undefined
}

export function createMoimChongmuService(options: MoimChongmuServiceOptions = {}): ServiceApp {
  const boardStore = options.boardStore ?? createAvailabilityBoardStore()
  const meetStore = options.meetStore ?? createMeetPlanStore()
  const publicBaseUrl = options.publicBaseUrl ?? defaultPublicBaseUrl()
  const kakaoMapJsKey = options.kakaoMapJsKey ?? process.env["KAKAO_MAP_JS_KEY"]
  const service = createServiceApp({
    id: "moim-chongmu",
    name: "모임좌표",
    version: "0.1.0",
    description: "가능 시간, 중간지점, 채팅 공유문을 stateless로 정리하는 MCP",
    tools: createMoimTools({ boardStore, meetStore, publicBaseUrl }),
  })
  return {
    config: service.config,
    fetch: async (request) => {
      const boardResponse = await handleAvailabilityBoardWebRequest(request, boardStore)
      if (boardResponse !== undefined) return boardResponse
      const meetResponse = await handleMeetWebRequest(request, meetStore, kakaoMapJsKey)
      return meetResponse ?? service.fetch(request)
    },
  }
}

function defaultPublicBaseUrl(): string {
  return process.env["MOIM_COORDINATOR_PUBLIC_BASE_URL"] ?? `http://127.0.0.1:${port()}`
}

function port(): string {
  return process.env["PORT"] ?? "8788"
}
