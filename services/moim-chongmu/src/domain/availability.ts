import { createHash } from "node:crypto"

export type TimeWindow = {
  readonly start: string
  readonly end: string
}

export type AvailabilitySlot = {
  readonly id: string
  readonly date: string
  readonly time: string
}

export type AvailabilityResponse = {
  readonly availableSlotIds: readonly string[]
  readonly note?: string | undefined
}

export type AvailabilityResponses = Readonly<Record<string, AvailabilityResponse>>

export type AvailabilityBoard = {
  readonly schemaVersion: "moim-coordinate-board/v1"
  readonly title: string
  readonly timezone: string
  readonly slotMinutes: 30 | 60
  readonly dates: readonly string[]
  readonly startTime: string
  readonly endTime: string
  readonly participants: readonly string[]
  readonly slots: readonly AvailabilitySlot[]
  readonly responses: AvailabilityResponses
  readonly note?: string | undefined
  readonly revision: number
  readonly stateHash: string
}

export type CreateAvailabilityBoardInput = {
  readonly title: string
  readonly dates: readonly string[]
  readonly timeWindows: readonly TimeWindow[]
  readonly startTime?: string | undefined
  readonly endTime?: string | undefined
  readonly participants: readonly string[]
  readonly slotMinutes?: 30 | 60 | undefined
  readonly note?: string | undefined
}

export type MarkAvailabilityInput = {
  readonly state: AvailabilityBoard
  readonly participant: string
  readonly availableSlotIds: readonly string[]
  readonly note?: string | undefined
  readonly expectedStateHash?: string | undefined
}

export type StaleStateError = {
  readonly kind: "stale_state"
  readonly message: "availability board state hash is stale"
  readonly currentStateHash: string
}

export type MarkAvailabilityError =
  | StaleStateError
  | { readonly kind: "unknown_participant"; readonly message: string; readonly participant: string }
  | { readonly kind: "invalid_slot_ids"; readonly message: string }

export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E }

export type SlotSummary = {
  readonly id: string
  readonly availableCount: number
  readonly participantCount: number
}

export type AvailabilitySummary = {
  readonly bestSlots: readonly SlotSummary[]
  readonly missingRespondents: readonly string[]
  readonly markdown: string
}

const maxSlots = 168

export function createAvailabilityBoard(input: CreateAvailabilityBoardInput): AvailabilityBoard {
  if (input.dates.length > 14) throw new Error("max 14 dates")
  if (input.participants.length > 30) throw new Error("max 30 participants")

  const dates = input.dates.map(normalizeText)
  const participants = normalizeUnique(input.participants)
  const slotMinutes = input.slotMinutes ?? 30
  const timeWindows = input.timeWindows.length
    ? input.timeWindows
    : [{ start: input.startTime ?? "18:00", end: input.endTime ?? "21:00" }]
  const slots = dates.flatMap((date) =>
    timeWindows.flatMap((window) => slotsForWindow(date, window, slotMinutes)),
  )
  if (slots.length === 0) throw new Error("invalid time window")
  if (slots.length > maxSlots) throw new Error("max 168 slots")

  return withStateHash({
    schemaVersion: "moim-coordinate-board/v1",
    title: normalizeText(input.title),
    timezone: "Asia/Seoul",
    slotMinutes,
    dates,
    startTime: timeWindows[0]?.start ?? "18:00",
    endTime: timeWindows[0]?.end ?? "21:00",
    participants,
    slots,
    responses: {},
    note: input.note,
    revision: 1,
  })
}

export function markAvailability(
  input: MarkAvailabilityInput,
): Result<AvailabilityBoard, MarkAvailabilityError> {
  if (input.expectedStateHash !== undefined && input.expectedStateHash !== input.state.stateHash) {
    return {
      ok: false,
      error: {
        kind: "stale_state",
        message: "availability board state hash is stale",
        currentStateHash: input.state.stateHash,
      },
    }
  }

  const participant = normalizeText(input.participant)
  if (!input.state.participants.includes(participant)) {
    return {
      ok: false,
      error: {
        kind: "unknown_participant",
        message: "participant is not on this board",
        participant,
      },
    }
  }

  const validSlots = new Set(input.state.slots.map((slot) => slot.id))
  const uniqueSlotIds = normalizeUnique(input.availableSlotIds)
  if (
    uniqueSlotIds.length !== input.availableSlotIds.length ||
    uniqueSlotIds.some((slotId) => !validSlots.has(slotId))
  ) {
    return { ok: false, error: { kind: "invalid_slot_ids", message: "invalid slot ids" } }
  }
  const availableSlotIds = uniqueSlotIds
  const response =
    input.note === undefined ? { availableSlotIds } : { availableSlotIds, note: input.note }

  return {
    ok: true,
    value: withStateHash({
      ...withoutHash(input.state),
      responses: { ...input.state.responses, [participant]: response },
      revision: input.state.revision + 1,
    }),
  }
}

function slotsForWindow(
  date: string,
  window: TimeWindow,
  slotMinutes: 30 | 60,
): readonly AvailabilitySlot[] {
  const start = parseClock(window.start)
  const end = parseClock(window.end)
  if (end <= start) throw new Error("invalid time window")
  const slots: AvailabilitySlot[] = []
  for (let minute = start; minute < end; minute += slotMinutes) {
    const time = formatClock(minute)
    slots.push({ id: `${date}T${time}`, date, time })
  }
  return slots
}

function parseClock(value: string): number {
  const [hourText, minuteText] = value.split(":")
  const hour = Number.parseInt(hourText ?? "", 10)
  const minute = Number.parseInt(minuteText ?? "", 10)
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) throw new Error("invalid time")
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) throw new Error("invalid time")
  return hour * 60 + minute
}

function formatClock(value: number): string {
  const hour = Math.floor(value / 60)
  const minute = value % 60
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
}

function normalizeUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values.map(normalizeText).filter((value) => value.length > 0))]
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ")
}

function withoutHash(board: AvailabilityBoard): Omit<AvailabilityBoard, "stateHash"> {
  return {
    schemaVersion: board.schemaVersion,
    title: board.title,
    timezone: board.timezone,
    slotMinutes: board.slotMinutes,
    dates: board.dates,
    startTime: board.startTime,
    endTime: board.endTime,
    participants: board.participants,
    slots: board.slots,
    responses: board.responses,
    note: board.note,
    revision: board.revision,
  }
}

function withStateHash(board: Omit<AvailabilityBoard, "stateHash">): AvailabilityBoard {
  const stateHash = createHash("sha256").update(JSON.stringify(board)).digest("hex").slice(0, 16)
  return { ...board, stateHash }
}
