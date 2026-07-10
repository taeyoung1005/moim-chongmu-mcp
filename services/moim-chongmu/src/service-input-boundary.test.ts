import { describe, expect, it } from "vitest"
import * as z from "zod/v4"

import { createMoimChongmuService } from "./service.js"
import { availabilityBoardSchema } from "./service-schemas.js"

const textContentSchema = z.object({ type: z.literal("text"), text: z.string() })
const toolCallPayloadSchema = z.object({
  result: z
    .object({
      content: z.array(textContentSchema).optional(),
      isError: z.boolean().optional(),
    })
    .optional(),
  error: z.unknown().optional(),
})

type ToolCallPayload = z.infer<typeof toolCallPayloadSchema>

describe("모임좌표 service input boundaries", () => {
  it("rejects create-board dates that are not real ISO calendar dates safely", async () => {
    const service = createMoimChongmuService()
    const malformed = await callTool(service.fetch, "create_availability_board", {
      title: "깨진 날짜",
      dates: ["not-a-date"],
      timeWindows: [{ start: "18:00", end: "19:00" }],
      participants: ["민지", "태영"],
    })
    const impossible = await callTool(service.fetch, "create_availability_board", {
      title: "불가능한 날짜",
      dates: ["2026-02-30"],
      timeWindows: [{ start: "18:00", end: "19:00" }],
      participants: ["민지", "태영"],
    })
    const tooManyDates = await callTool(service.fetch, "create_availability_board", {
      title: "너무 긴 후보",
      dates: Array.from(
        { length: 15 },
        (_, index) => `2026-08-${String(index + 1).padStart(2, "0")}`,
      ),
      timeWindows: [{ start: "18:00", end: "19:00" }],
      participants: ["민지", "태영"],
    })

    for (const payload of [malformed, impossible, tooManyDates]) {
      const text = textFromToolResult(payload)
      expect(payload.result?.isError).toBe(true)
      expect(text).toContain("## 입력 오류")
      expect(text).toContain("날짜")
      expect(text).not.toContain("not-a-dateT18:00")
      expect(text).not.toContain("2026-02-30T18:00")
      expect(text).not.toContain("MCP error -32602")
      expect(text).not.toContain("Input validation error")
    }
  })

  it("rejects imported board states with invalid dates and slot dates at the boundary", () => {
    const invalidDate = availabilityBoardSchema.safeParse({
      ...minimalBoard(),
      dates: ["2026-02-30"],
    })
    const invalidSlotDate = availabilityBoardSchema.safeParse({
      ...minimalBoard(),
      slots: [{ id: "2026-02-30T18:00", date: "2026-02-30", time: "18:00" }],
    })

    expect(invalidDate.success).toBe(false)
    expect(invalidSlotDate.success).toBe(false)
  })

  it("rejects imported board states with impossible clocks safely", async () => {
    const service = createMoimChongmuService()
    const board = {
      ...minimalBoard(),
      startTime: "25:00",
      endTime: "99:99",
      slots: [{ id: "2026-07-10T25:00", date: "2026-07-10", time: "25:00" }],
    }
    const marked = await callTool(service.fetch, "mark_availability", {
      state: board,
      participant: "민지",
      availableSlotIds: ["2026-07-10T25:00"],
    })
    const summarized = await callTool(service.fetch, "summarize_best_times", { state: board })
    const shared = await callTool(service.fetch, "make_chat_share_message", { board })

    for (const payload of [marked, summarized, shared]) {
      const text = textFromToolResult(payload)
      expect(payload.result?.isError).toBe(true)
      expect(text).toContain("## 입력 오류")
      expect(text).toContain("보드 상태를 확인해 주세요")
      expect(text).not.toContain("25:00")
      expect(text).not.toContain("99:99")
    }
  })

  it("keeps malformed board and origin payloads inside Korean error envelopes", async () => {
    const service = createMoimChongmuService()
    const malformedClock = await callTool(service.fetch, "mark_availability", {
      state: { ...minimalBoard(), startTime: "bad" },
      participant: "민지",
      availableSlotIds: ["2026-07-10T18:00"],
    })
    const oversizedEncoded = await callTool(service.fetch, "summarize_best_times", {
      state: {
        schemaVersion: "moim-coordinate-board/v1",
        encoding: "deflate-base64url-json",
        encodedState: "a".repeat(20_001),
      },
    })
    const malformedOrigin = await callTool(service.fetch, "find_midpoint", {
      origins: [
        { label: "민지", coordinates: { x: "bad", y: 37.5 } },
        { label: "태영", coordinates: { x: 127, y: 37.6 } },
      ],
    })

    for (const payload of [malformedClock, oversizedEncoded]) {
      const text = textFromToolResult(payload)
      expect(payload.result?.isError).toBe(true)
      expect(text).toContain("## 입력 오류")
      expect(text).toContain("보드 상태를 확인해 주세요")
      expect(text).not.toContain("MCP error -32602")
      expect(text).not.toContain("Input validation error")
    }
    const originText = textFromToolResult(malformedOrigin)
    expect(malformedOrigin.result?.isError).toBe(true)
    expect(originText).toContain("## 입력 오류")
    expect(originText).toContain("중간지점을 계산할 수 없습니다")
    expect(originText).not.toContain("MCP error -32602")
    expect(originText).not.toContain("Input validation error")
  })

  it("rejects label-only origins for midpoint tools instead of fixture defaults", async () => {
    const service = createMoimChongmuService()
    const findPayload = await callTool(service.fetch, "find_midpoint", {
      origins: [{ label: "민지" }, { label: "태영" }],
    })
    const recommendPayload = await callTool(service.fetch, "recommend_midpoint_places", {
      origins: [{ label: "민지" }, { label: "태영" }],
      categories: ["cafe"],
    })

    for (const payload of [findPayload, recommendPayload]) {
      const text = textFromToolResult(payload)
      expect(payload.result?.isError).toBe(true)
      expect(text).toContain("## 입력 오류")
      expect(text).toContain("중간지점을 계산할 수 없습니다")
      expect(text).not.toContain("fixture")
      expect(text).not.toContain("중간지점 라운지")
    }
  })
})

function minimalBoard(): Readonly<Record<string, unknown>> {
  return {
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
}

async function callTool(
  fetcher: (request: Request) => Response | Promise<Response>,
  name: string,
  args: Readonly<Record<string, unknown>>,
): Promise<ToolCallPayload> {
  const response = await fetcher(
    new Request("http://127.0.0.1/mcp", {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    }),
  )
  expect(response.status).toBe(200)
  return toolCallPayloadSchema.parse(await response.json())
}

function textFromToolResult(payload: ToolCallPayload): string {
  const first = payload.result?.content?.find((item) => item.type === "text")
  return first?.text ?? ""
}
