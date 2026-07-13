import * as z from "zod/v4"

import { decodeAvailabilityBoardState, type EncodedAvailabilityBoardState } from "./domain/moim.js"

export const coordinatesSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
})

// LLMs send coordinates as {lat, lng}/{latitude, longitude} at least as often as {x, y} (x=lng, y=lat).
export const lenientCoordinatesSchema = z
  .object({
    x: z.number().finite().optional(),
    y: z.number().finite().optional(),
    lat: z.number().finite().optional(),
    latitude: z.number().finite().optional(),
    lng: z.number().finite().optional(),
    lon: z.number().finite().optional(),
    longitude: z.number().finite().optional(),
  })
  .transform((value, ctx) => {
    const x = value.x ?? value.lng ?? value.lon ?? value.longitude
    const y = value.y ?? value.lat ?? value.latitude
    if (x === undefined || y === undefined) {
      ctx.addIssue({ code: "custom", message: "좌표는 {x, y} 또는 {lat, lng} 형식이어야 합니다." })
      return z.NEVER
    }
    return { x, y }
  })

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/
const clockPattern = /^\d{2}:\d{2}$/

export const isoDateSchema = z.string().refine(isIsoCalendarDate, {
  message: "YYYY-MM-DD 형식의 실제 날짜를 입력해 주세요.",
})

export const mcpClockSchema = z.string().regex(clockPattern)

export const clockSchema = z.string().refine(isClock, {
  message: "HH:mm 형식의 실제 시간을 입력해 주세요.",
})

export const mcpOriginSchema = z.object({
  label: z.string().trim().min(1).max(80).optional(),
  name: z.string().trim().min(1).max(80).optional(),
  address: z.string().trim().min(1).max(160).optional(),
  coordinates: lenientCoordinatesSchema.optional(),
  // Flat coordinate aliases: LLMs often send {label, lat, lng} with no `coordinates` wrapper.
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
  lat: z.number().finite().optional(),
  latitude: z.number().finite().optional(),
  lng: z.number().finite().optional(),
  lon: z.number().finite().optional(),
  longitude: z.number().finite().optional(),
})

const objectOriginSchema = mcpOriginSchema.transform((origin, ctx) => {
  const flatX = origin.x ?? origin.lng ?? origin.lon ?? origin.longitude
  const flatY = origin.y ?? origin.lat ?? origin.latitude
  const coordinates =
    origin.coordinates ??
    (flatX !== undefined && flatY !== undefined ? { x: flatX, y: flatY } : undefined)
  if (origin.address === undefined && coordinates === undefined) {
    ctx.addIssue({ code: "custom", message: "출발지는 주소 또는 좌표가 필요합니다." })
    return z.NEVER
  }
  return {
    label: origin.label ?? origin.name ?? origin.address ?? "출발지",
    ...(origin.address === undefined ? {} : { address: origin.address }),
    ...(coordinates === undefined ? {} : { coordinates }),
  }
})

// Accept a bare place-name/address string (what LLMs usually send) as well as an object.
const stringOriginSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .transform((value) => ({ label: value, address: value }))

export const originSchema = z.union([stringOriginSchema, objectOriginSchema])

export type OriginInput = z.infer<typeof originSchema>

export const originListSchema = z.array(originSchema).min(2).max(10)

export const timeWindowSchema = z.object({
  start: mcpClockSchema,
  end: mcpClockSchema,
})

const strictTimeWindowSchema = z.object({
  start: clockSchema,
  end: clockSchema,
})

// Accept a "HH:MM-HH:MM" (or "HH:MM~HH:MM") string as well as a {start, end} object.
const stringTimeWindowSchema = z
  .string()
  .trim()
  .refine(
    (value) => {
      const match = /^(\d{2}:\d{2})\s*[-~]\s*(\d{2}:\d{2})$/.exec(value)
      if (match === null) return false
      const [, start, end] = match
      return start !== undefined && end !== undefined && isClock(start) && isClock(end)
    },
    { message: "시간대는 'HH:MM-HH:MM' 형식으로 입력해 주세요. 예: 12:00-20:00" },
  )
  .transform((value) => {
    const [start = "", end = ""] = value.split(/\s*[-~]\s*/)
    return { start, end }
  })

const timeWindowInputSchema = z.union([stringTimeWindowSchema, strictTimeWindowSchema])

const availabilitySlotSchema = z
  .object({
    id: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
    date: isoDateSchema,
    time: clockSchema,
  })
  .refine((slot) => slot.id === `${slot.date}T${slot.time}`, {
    message: "slot id는 날짜와 시간으로 만든 YYYY-MM-DDTHH:mm 형식이어야 합니다.",
  })

export const createAvailabilityBoardInputSchema = z.object({
  title: z.string().min(1).max(120),
  dates: z.array(isoDateSchema).min(1).max(14),
  timeWindows: z.array(timeWindowInputSchema).max(4).default([]),
  startTime: clockSchema.optional(),
  endTime: clockSchema.optional(),
  participants: z
    .array(
      z
        .string()
        .min(1)
        .max(40)
        .refine((participant) => !/역\s*$/.test(participant.trim()), {
          message: "참가자에는 역 이름이 아닌 실제 사람 이름을 넣어야 합니다.",
        }),
    )
    .min(1)
    .max(30),
  slotMinutes: z.union([z.literal(30), z.literal(60)]).default(30),
  note: z.string().min(1).max(400).optional(),
})

export const rawAvailabilityBoardSchema = z.object({
  schemaVersion: z.literal("moim-coordinate-board/v1"),
  title: z.string().min(1).max(120),
  timezone: z.string().min(1).max(40),
  slotMinutes: z.union([z.literal(30), z.literal(60)]),
  dates: z.array(isoDateSchema).min(1).max(14),
  startTime: clockSchema,
  endTime: clockSchema,
  participants: z.array(z.string().min(1).max(40)).min(1).max(30),
  slots: z.array(availabilitySlotSchema).min(1).max(168),
  responses: z.record(
    z.string().min(1).max(40),
    z.object({
      availableSlotIds: z.array(z.string().min(1).max(32)).max(168),
      note: z.string().min(1).max(400).optional(),
    }),
  ),
  note: z.string().min(1).max(400).optional(),
  revision: z.number().int().positive(),
  stateHash: z.string().min(1).max(128),
})

const encodedAvailabilityBoardSchema = z.object({
  schemaVersion: z.literal("moim-coordinate-board/v1"),
  encoding: z.literal("deflate-base64url-json"),
  encodedState: z.string().min(1).max(20_000),
})

export const availabilityBoardSchema = z.union([
  rawAvailabilityBoardSchema,
  encodedAvailabilityBoardSchema,
])

export const mcpAvailabilityBoardSchema = z.unknown()

export type AvailabilityBoardInput = z.infer<typeof availabilityBoardSchema>

export function parseAvailabilityBoardInput(
  input: unknown,
): z.infer<typeof rawAvailabilityBoardSchema> | undefined {
  const parsedInput = availabilityBoardSchema.safeParse(input)
  if (!parsedInput.success) return undefined
  if (!("encodedState" in parsedInput.data)) return parsedInput.data
  const decoded = decodeAvailabilityBoardState(
    parsedInput.data satisfies EncodedAvailabilityBoardState,
  )
  if (!decoded.ok) return undefined
  const parsed = rawAvailabilityBoardSchema.safeParse(decoded.value)
  return parsed.success ? parsed.data : undefined
}

export const placeCategorySchema = z.union([
  z.literal("any"),
  z.literal("cafe"),
  z.literal("restaurant"),
  z.literal("subway"),
  z.literal("culture"),
  z.literal("attraction"),
  z.literal("parking"),
])

function isIsoCalendarDate(value: string): boolean {
  if (!isoDatePattern.test(value)) return false
  const [yearText, monthText, dayText] = value.split("-")
  if (yearText === undefined || monthText === undefined || dayText === undefined) return false
  const year = Number.parseInt(yearText, 10)
  const month = Number.parseInt(monthText, 10)
  const day = Number.parseInt(dayText, 10)
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false
  if (year < 1 || month < 1 || month > 12 || day < 1) return false
  const days = daysInMonth(year, month)
  return days !== undefined && day <= days
}

function isClock(value: string): boolean {
  if (!clockPattern.test(value)) return false
  const [hourText, minuteText] = value.split(":")
  if (hourText === undefined || minuteText === undefined) return false
  const hour = Number.parseInt(hourText, 10)
  const minute = Number.parseInt(minuteText, 10)
  return (
    Number.isInteger(hour) &&
    Number.isInteger(minute) &&
    hour >= 0 &&
    hour <= 23 &&
    minute >= 0 &&
    minute <= 59
  )
}

function daysInMonth(year: number, month: number): number | undefined {
  const daysByMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const
  const days = daysByMonth[month - 1]
  if (days === undefined) return undefined
  return month === 2 && isLeapYear(year) ? 29 : days
}

function isLeapYear(year: number): boolean {
  return year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0)
}
