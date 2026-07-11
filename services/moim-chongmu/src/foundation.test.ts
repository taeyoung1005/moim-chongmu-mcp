import { describe, expect, it } from "vitest"
import * as z from "zod/v4"

import { createMoimChongmuService } from "./service.js"

const textContentSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
})

const toolListPayloadSchema = z.object({
  result: z.object({
    tools: z.array(
      z.object({
        name: z.string(),
        description: z.string(),
      }),
    ),
  }),
})

const toolCallPayloadSchema = z.object({
  result: z
    .object({
      content: z.array(textContentSchema).optional(),
      isError: z.boolean().optional(),
    })
    .optional(),
  error: z.unknown().optional(),
})

const healthPayloadSchema = z.object({
  ok: z.boolean(),
  serviceId: z.string(),
  serviceName: z.string(),
})

type ToolCallPayload = z.infer<typeof toolCallPayloadSchema>

const expectedTools = [
  "create_availability_board",
  "mark_availability",
  "summarize_best_times",
  "find_midpoint",
  "recommend_midpoint_places",
  "make_chat_share_message",
] as const

describe("모임좌표 foundation HTTP surface", () => {
  it("returns service identity from health when requested", async () => {
    // Given
    const service = createMoimChongmuService()

    // When
    const response = await service.fetch(new Request("http://127.0.0.1/health"))
    const payload = healthPayloadSchema.parse(await response.json())

    // Then
    expect(response.status).toBe(200)
    expect(payload).toMatchObject({
      ok: true,
      serviceId: "moim-chongmu",
      serviceName: "모임좌표",
    })
  })

  it("lists the exact six moim-coordinate MCP tools in order", async () => {
    // Given
    const service = createMoimChongmuService()

    // When
    const payload = await postMcp(service.fetch, toolListPayloadSchema, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    })

    // Then
    expect(payload.result.tools.map((tool) => tool.name)).toEqual(expectedTools)
    expect(payload.result.tools.every((tool) => tool.description.includes("모임총무"))).toBe(true)
  })

  it("creates an availability board with a when2meet-style heatmap", async () => {
    // Given
    const service = createMoimChongmuService()

    // When
    const payload = await callTool(service.fetch, "create_availability_board", {
      title: "토요일 저녁",
      dates: ["2026-07-10"],
      timeWindows: [{ start: "18:00", end: "20:00" }],
      participants: ["민지", "태영"],
    })
    const text = textFromToolResult(payload)

    // Then
    expect(payload.result?.isError).not.toBe(true)
    expect(text).toContain("토요일 저녁")
    expect(text).toContain("2026-07-10T18:00 [----] 0/2")
    expect(text).toContain("stateHash")
  })

  it("returns safe stale-state errors and never sends chat messages", async () => {
    // Given
    const service = createMoimChongmuService()
    const board = {
      schemaVersion: "moim-coordinate-board/v1",
      title: "토요일 저녁",
      timezone: "Asia/Seoul",
      slotMinutes: 60,
      dates: ["2026-07-10"],
      participants: ["민지", "태영"],
      slots: [{ id: "2026-07-10T18:00", date: "2026-07-10", time: "18:00" }],
      startTime: "18:00",
      endTime: "19:00",
      responses: {},
      revision: 1,
      stateHash: "current-hash",
    }

    // When
    const stale = await callTool(service.fetch, "mark_availability", {
      state: board,
      participant: "민지",
      availableSlotIds: ["2026-07-10T18:00"],
      expectedStateHash: "stale-hash",
    })
    const share = await callTool(service.fetch, "make_chat_share_message", {
      board,
      bestSlotIds: ["2026-07-10T18:00"],
      placeName: "서울역 카페",
    })

    // Then
    expect(stale.result?.isError).toBe(true)
    expect(textFromToolResult(stale)).toContain("다시 불러온 뒤")
    expect(textFromToolResult(stale)).toContain("current-hash")
    expect(textFromToolResult(share)).toContain("아직 메시지는 전송하지 않았습니다")
  })
})

async function callTool(
  fetcher: (request: Request) => Response | Promise<Response>,
  name: string,
  args: Readonly<Record<string, unknown>>,
): Promise<ToolCallPayload> {
  return postMcp(fetcher, toolCallPayloadSchema, {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name, arguments: args },
  })
}

async function postMcp<T>(
  fetcher: (request: Request) => Response | Promise<Response>,
  schema: z.ZodType<T>,
  body: Readonly<Record<string, unknown>>,
): Promise<T> {
  const response = await fetcher(
    new Request("http://127.0.0.1/mcp", {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }),
  )
  expect(response.status).toBe(200)
  return schema.parse(await response.json())
}

function textFromToolResult(payload: ToolCallPayload): string {
  const first = payload.result?.content?.find((item) => item.type === "text")
  return first?.text ?? ""
}
