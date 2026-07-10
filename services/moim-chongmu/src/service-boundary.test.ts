import { describe, expect, it } from "vitest"
import * as z from "zod/v4"

import { createAvailabilityBoard, markAvailability } from "./domain/moim.js"
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

describe("모임좌표 service boundaries", () => {
  it("rejects imported board states with impossible response keys safely", async () => {
    const service = createMoimChongmuService()
    const payload = await callTool(service.fetch, "summarize_best_times", {
      state: {
        schemaVersion: "moim-coordinate-board/v1",
        title: "검증",
        timezone: "Asia/Seoul",
        slotMinutes: 60,
        dates: ["2026-07-10"],
        startTime: "18:00",
        endTime: "19:00",
        participants: ["민지"],
        slots: [{ id: "2026-07-10T18:00", date: "2026-07-10", time: "18:00" }],
        responses: {
          민지: { availableSlotIds: ["2026-07-10T18:00"] },
          낯선사람: { availableSlotIds: ["2026-07-10T18:00"] },
        },
        revision: 1,
        stateHash: "hash",
      },
    })
    const text = textFromToolResult(payload)

    expect(payload.result?.isError).toBe(true)
    expect(text).toContain("보드 상태를 확인해 주세요")
    expect(text).not.toContain("Invalid count value")
  })

  it("returns safe Korean errors for semantic create-board failures", async () => {
    const service = createMoimChongmuService()
    const tooManySlots = await callTool(service.fetch, "create_availability_board", {
      title: "큰 보드",
      dates: Array.from(
        { length: 14 },
        (_, index) => `2026-07-${String(index + 1).padStart(2, "0")}`,
      ),
      timeWindows: [{ start: "00:00", end: "23:30" }],
      participants: ["민지", "태영"],
      slotMinutes: 30,
    })
    const badClock = await callTool(service.fetch, "create_availability_board", {
      title: "깨진 시간",
      dates: ["2026-07-10"],
      timeWindows: [{ start: "25:00", end: "26:00" }],
      participants: ["민지", "태영"],
    })
    const reversedWindow = await callTool(service.fetch, "create_availability_board", {
      title: "뒤집힌 시간",
      dates: ["2026-07-10"],
      timeWindows: [{ start: "20:00", end: "18:00" }],
      participants: ["민지", "태영"],
    })

    for (const payload of [tooManySlots, badClock, reversedWindow]) {
      const text = textFromToolResult(payload)
      expect(payload.result?.isError).toBe(true)
      expect(text).toContain("## 입력 오류")
      expect(text).toContain("시간대")
      expect(text).not.toContain("max 168 slots")
      expect(text).not.toContain("invalid time")
      expect(text).not.toContain("invalid time window")
    }
  })

  it("rejects duplicate and unknown mark slot ids safely", async () => {
    const service = createMoimChongmuService()
    const board = minimalBoard()
    const duplicate = await callTool(service.fetch, "mark_availability", {
      state: board,
      participant: "민지",
      availableSlotIds: ["2026-07-10T18:00", "2026-07-10T18:00"],
    })
    const unknown = await callTool(service.fetch, "mark_availability", {
      state: board,
      participant: "민지",
      availableSlotIds: ["2026-07-10T18:00", "2026-07-10T19:00"],
    })

    for (const payload of [duplicate, unknown]) {
      const text = textFromToolResult(payload)
      expect(payload.result?.isError).toBe(true)
      expect(text).toContain("## 입력 오류")
      expect(text).toContain("가능 시간을 확인해 주세요")
    }
  })

  it("keeps the largest accepted board and mark outputs under the protocol text limit", async () => {
    const service = createMoimChongmuService()
    const participants = Array.from({ length: 30 }, (_, index) => `참여자${index}`)
    const dates = Array.from(
      { length: 14 },
      (_, index) => `2026-07-${String(index + 1).padStart(2, "0")}`,
    )
    const createPayload = await callTool(service.fetch, "create_availability_board", {
      title: "큰 보드",
      dates,
      startTime: "18:00",
      endTime: "23:30",
      participants,
      slotMinutes: 30,
    })
    const board = createAvailabilityBoard({
      title: "큰 보드",
      dates,
      startTime: "16:00",
      endTime: "22:00",
      timeWindows: [],
      participants,
      slotMinutes: 30,
    })
    const markPayload = await markLastParticipant(service.fetch, board, participants)

    for (const payload of [createPayload, markPayload]) {
      const text = textFromToolResult(payload)
      expect(payload.result?.isError).not.toBe(true)
      expect(text.length).toBeLessThan(24_000)
      expect(text).toContain("```boardState")
    }
  })

  it("rejects imported board states above the 168 slot boundary", () => {
    const slots = Array.from({ length: 169 }, (_, index) => ({
      id: `2026-07-10T${String(index).padStart(3, "0")}`,
      date: "2026-07-10",
      time: "18:00",
    }))

    const parsed = availabilityBoardSchema.safeParse({
      ...minimalBoard(),
      slots,
    })

    expect(parsed.success).toBe(false)
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

async function markLastParticipant(
  fetcher: (request: Request) => Response | Promise<Response>,
  board: ReturnType<typeof createAvailabilityBoard>,
  participants: readonly string[],
): Promise<ToolCallPayload> {
  const allSlotIds = board.slots.map((slot) => slot.id)
  const finalParticipant = participants.at(-1)
  if (finalParticipant === undefined) throw new Error("missing final participant")
  let state = board
  for (const participant of participants.slice(0, -1)) {
    const result = markAvailability({ state, participant, availableSlotIds: allSlotIds })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error.message)
    state = result.value
  }
  return callTool(fetcher, "mark_availability", {
    state,
    participant: finalParticipant,
    availableSlotIds: allSlotIds,
    expectedStateHash: state.stateHash,
  })
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
