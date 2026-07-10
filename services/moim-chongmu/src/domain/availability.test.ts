import { describe, expect, it } from "vitest"
import {
  createAvailabilityBoard,
  makeChatShareMessage,
  markAvailability,
  summarizeBestTimes,
  validateAvailabilityBoardState,
} from "./moim.js"

describe("moim-coordinate availability domain", () => {
  it("creates deterministic availability boards with bounded defaults", () => {
    const board = createAvailabilityBoard({
      title: "7월 저녁 모임",
      dates: ["2026-07-10", "2026-07-11"],
      timeWindows: [{ start: "18:00", end: "20:00" }],
      participants: [" 민지 ", "태영", "민지", "수현"],
    })
    const sameBoard = createAvailabilityBoard({
      title: "7월 저녁 모임",
      dates: ["2026-07-10", "2026-07-11"],
      timeWindows: [{ start: "18:00", end: "20:00" }],
      participants: ["민지", "태영", "수현"],
    })

    expect(board.schemaVersion).toBe("moim-coordinate-board/v1")
    expect(board.timezone).toBe("Asia/Seoul")
    expect(board.slotMinutes).toBe(30)
    expect(board.revision).toBe(1)
    expect(board.slots.map((slot) => slot.id)).toEqual([
      "2026-07-10T18:00",
      "2026-07-10T18:30",
      "2026-07-10T19:00",
      "2026-07-10T19:30",
      "2026-07-11T18:00",
      "2026-07-11T18:30",
      "2026-07-11T19:00",
      "2026-07-11T19:30",
    ])
    expect(board.stateHash).toBe(sameBoard.stateHash)
    expect(() =>
      createAvailabilityBoard({
        title: "too many",
        dates: Array.from(
          { length: 15 },
          (_, index) => `2026-07-${String(index + 1).padStart(2, "0")}`,
        ),
        timeWindows: [{ start: "18:00", end: "19:00" }],
        participants: ["민지", "태영"],
      }),
    ).toThrow("max 14 dates")
    expect(() =>
      createAvailabilityBoard({
        title: "too many people",
        dates: ["2026-07-10"],
        timeWindows: [{ start: "18:00", end: "19:00" }],
        participants: Array.from({ length: 31 }, (_, index) => `p${index}`),
      }),
    ).toThrow("max 30 participants")
    expect(() =>
      createAvailabilityBoard({
        title: "bad range",
        dates: ["2026-07-10"],
        timeWindows: [{ start: "20:00", end: "18:00" }],
        participants: ["민지", "태영"],
      }),
    ).toThrow("invalid time window")
    expect(() =>
      createAvailabilityBoard({
        title: "bad clock",
        dates: ["2026-07-10"],
        timeWindows: [{ start: "25:00", end: "26:00" }],
        participants: ["민지", "태영"],
      }),
    ).toThrow("invalid time")
    expect(() =>
      createAvailabilityBoard({
        title: "too many slots",
        dates: Array.from(
          { length: 14 },
          (_, index) => `2026-07-${String(index + 1).padStart(2, "0")}`,
        ),
        timeWindows: [{ start: "00:00", end: "23:30" }],
        participants: ["민지", "태영"],
        slotMinutes: 30,
      }),
    ).toThrow("max 168 slots")
  })

  it("marks availability with replace semantics and stale hash rejection", () => {
    const board = createAvailabilityBoard({
      title: "주말",
      dates: ["2026-07-10"],
      timeWindows: [{ start: "18:00", end: "20:30" }],
      participants: ["민지", "태영", "수현", "지훈"],
      slotMinutes: 60,
    })
    const first = markAvailability({
      state: board,
      participant: "민지",
      availableSlotIds: ["2026-07-10T18:00", "2026-07-10T19:00"],
      expectedStateHash: board.stateHash,
    })
    expect(first.ok).toBe(true)
    if (!first.ok) throw new Error(first.error.message)

    const replaced = markAvailability({
      state: first.value,
      participant: "민지",
      availableSlotIds: ["2026-07-10T19:00"],
      expectedStateHash: first.value.stateHash,
    })
    expect(replaced.ok).toBe(true)
    if (!replaced.ok) throw new Error(replaced.error.message)

    expect(replaced.value.revision).toBe(3)
    expect(replaced.value.responses).toEqual({
      민지: { availableSlotIds: ["2026-07-10T19:00"] },
    })

    const stale = markAvailability({
      state: replaced.value,
      participant: "태영",
      availableSlotIds: ["2026-07-10T18:00"],
      expectedStateHash: board.stateHash,
    })
    expect(stale).toEqual({
      ok: false,
      error: {
        kind: "stale_state",
        message: "availability board state hash is stale",
        currentStateHash: replaced.value.stateHash,
      },
    })
  })

  it("summarizes a markdown heatmap and sorted best slots", () => {
    const board = createAvailabilityBoard({
      title: "주말",
      dates: ["2026-07-10"],
      timeWindows: [{ start: "18:00", end: "22:00" }],
      participants: ["민지", "태영", "수현", "지훈"],
      slotMinutes: 60,
    })
    const withMinji = markAvailability({
      state: board,
      participant: "민지",
      availableSlotIds: ["2026-07-10T18:00", "2026-07-10T19:00", "2026-07-10T20:00"],
    })
    expect(withMinji.ok).toBe(true)
    if (!withMinji.ok) throw new Error(withMinji.error.message)
    const withTaeyoung = markAvailability({
      state: withMinji.value,
      participant: "태영",
      availableSlotIds: ["2026-07-10T19:00", "2026-07-10T20:00"],
    })
    expect(withTaeyoung.ok).toBe(true)
    if (!withTaeyoung.ok) throw new Error(withTaeyoung.error.message)
    const withSuhyun = markAvailability({
      state: withTaeyoung.value,
      participant: "수현",
      availableSlotIds: ["2026-07-10T20:00"],
    })
    expect(withSuhyun.ok).toBe(true)
    if (!withSuhyun.ok) throw new Error(withSuhyun.error.message)

    const summary = summarizeBestTimes(withSuhyun.value, { limit: 3 })

    expect(summary.missingRespondents).toEqual(["지훈"])
    expect(summary.bestSlots.map((slot) => slot.id)).toEqual([
      "2026-07-10T20:00",
      "2026-07-10T19:00",
      "2026-07-10T18:00",
    ])
    expect(summary.markdown).toContain("### 많이 겹치는 시간")
    expect(summary.markdown).toContain("1. 2026-07-10T20:00 - 3/4")
    expect(summary.markdown).toContain("2. 2026-07-10T19:00 - 2/4")
    expect(summary.markdown).toContain("2026-07-10T18:00 [=---] 1/4")
    expect(summary.markdown).toContain("2026-07-10T19:00 [==--] 2/4")
    expect(summary.markdown).toContain("2026-07-10T20:00 [===-] 3/4")
    expect(summary.markdown).toContain("2026-07-10T21:00 [----] 0/4")
    expect(summary.markdown).toContain("미응답: 지훈")
  })

  it("rejects imported board states with duplicate slot responses", () => {
    const board = createAvailabilityBoard({
      title: "검증",
      dates: ["2026-07-10"],
      timeWindows: [{ start: "18:00", end: "19:00" }],
      participants: ["민지"],
      slotMinutes: 60,
    })

    const validation = validateAvailabilityBoardState({
      ...board,
      responses: {
        민지: {
          availableSlotIds: ["2026-07-10T18:00", "2026-07-10T18:00", "2026-07-10T18:00"],
        },
      },
    })

    expect(validation).toEqual({ ok: false, message: "보드 상태를 확인해 주세요." })
  })

  it("formats a chat share message without mutating board state", () => {
    const board = createAvailabilityBoard({
      title: "토요일 모임",
      dates: ["2026-07-10"],
      timeWindows: [{ start: "18:00", end: "20:00" }],
      participants: ["민지", "태영"],
    })
    const message = makeChatShareMessage({
      board,
      bestSlotIds: ["2026-07-10T18:00"],
      placeName: "서울역 카페",
    })

    expect(message).toContain("토요일 모임")
    expect(message).toContain("2026-07-10T18:00")
    expect(message).toContain("서울역 카페")
    expect(message).toContain("미응답: 민지, 태영")
    expect(message).toContain("리마인드")
    expect(message).toContain("가능한 시간을 아직 안 적은 분들은")
    expect(board.revision).toBe(1)
  })
})
