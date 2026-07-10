import { defineTool, errorTextResult, type ToolDefinition, textResult } from "@playmcp/mcp-common"
import * as z from "zod/v4"

import { loadMoimSources } from "./adapters/moim-sources.js"
import type { AvailabilityBoardStore } from "./availability-board-store.js"
import {
  type AvailabilityBoard,
  createAvailabilityBoard,
  distanceMeters,
  findMidpoint,
  makeChatShareMessage,
  markAvailability,
  type RecommendedPlace,
  type ResolvedOrigin,
  recommendMidpointPlaces,
  summarizeBestTimes,
  validateAvailabilityBoardState,
} from "./domain/moim.js"
import type { MeetPlanOrigin, MeetPlanPlace, MeetPlanStore } from "./meet-plan-store.js"
import {
  formatAvailabilityError,
  formatBoardResult,
  formatBoardStateError,
  formatCreateBoardError,
  formatMidpointError,
  formatSourceStatuses,
} from "./service-format.js"
import {
  coordinatesSchema,
  createAvailabilityBoardInputSchema,
  mcpAvailabilityBoardSchema,
  type OriginInput,
  originListSchema,
  parseAvailabilityBoardInput,
  placeCategorySchema,
} from "./service-schemas.js"

export function createMoimTools(input: {
  readonly boardStore: AvailabilityBoardStore
  readonly meetStore: MeetPlanStore
  readonly publicBaseUrl: string
}): readonly ToolDefinition[] {
  return [
    defineTool({
      name: "create_availability_board",
      title: "가능 시간 보드 만들기",
      description: "모임좌표가 when2meet처럼 가능한 시간 보드와 빈 heatmap을 만듭니다.",
      inputSchema: {
        title: z.unknown().optional(),
        dates: z.unknown().optional(),
        timeWindows: z.unknown().optional(),
        startTime: z.unknown().optional(),
        endTime: z.unknown().optional(),
        participants: z.unknown().optional(),
        slotMinutes: z.unknown().optional(),
        note: z.unknown().optional(),
      },
      openWorldHint: false,
      handler: (args) => {
        const result = safeCreateAvailabilityBoard(args)
        if (!result.ok) return errorTextResult(formatCreateBoardError(result.message))
        const stored = input.boardStore.save(result.board)
        return textResult(
          formatBoardResult(result.board, { voteUrl: boardUrl(input.publicBaseUrl, stored.id) }),
        )
      },
    }),
    defineTool({
      name: "mark_availability",
      title: "가능 시간 표시",
      description: "모임좌표가 한 참여자의 가능 시간을 stateHash 기준으로 갱신합니다.",
      inputSchema: {
        state: mcpAvailabilityBoardSchema,
        participant: z.string().min(1).max(40),
        availableSlotIds: z.array(z.string().min(1).max(32)).max(168),
        expectedStateHash: z.string().min(1).max(128).optional(),
      },
      openWorldHint: false,
      handler: (args) => {
        const state = parseAvailabilityBoardInput(args.state)
        if (state === undefined) return errorTextResult(formatBoardStateError())
        const validation = validateAvailabilityBoardState(state)
        if (!validation.ok) return errorTextResult(formatBoardStateError(validation.message))
        const result = markAvailability({ ...args, state })
        if (!result.ok) return errorTextResult(formatAvailabilityError(result.error))
        const stored = input.boardStore.findByStateHash(state.stateHash)
        const updated =
          stored === undefined ? undefined : input.boardStore.update(stored.id, result.value)
        return textResult(
          formatBoardResult(result.value, { voteUrl: voteUrl(input.publicBaseUrl, updated) }),
        )
      },
    }),
    defineTool({
      name: "summarize_best_times",
      title: "겹치는 시간 요약",
      description: "모임좌표가 가능 시간 heatmap과 미응답자를 요약합니다.",
      inputSchema: {
        state: mcpAvailabilityBoardSchema,
        limit: z.number().int().min(1).max(10).default(5),
      },
      openWorldHint: false,
      handler: ({ state, limit }) => {
        const board = parseAvailabilityBoardInput(state)
        if (board === undefined) return errorTextResult(formatBoardStateError())
        const validation = validateAvailabilityBoardState(board)
        if (!validation.ok) return errorTextResult(formatBoardStateError(validation.message))
        return textResult(summarizeBestTimes(board, { limit }).markdown)
      },
    }),
    defineTool({
      name: "find_midpoint",
      title: "중간 좌표 찾기",
      description: "모임좌표가 출발지 좌표나 주소 fixture를 기준으로 중간지점을 계산합니다.",
      inputSchema: { origins: z.unknown() },
      openWorldHint: true,
      handler: async ({ origins }) => {
        const parsedOrigins = parseOrigins(origins)
        if (parsedOrigins === undefined) {
          return errorTextResult(formatMidpointError("at least 2 resolved origins are required"))
        }
        const sources = await loadMoimSources({
          origins: parsedOrigins,
          midpoint: { x: 126.98, y: 37.54 },
        })
        const result = findMidpoint({ origins: sources.resolvedOrigins })
        if (!result.ok) return errorTextResult(formatMidpointError(result.error.message))
        const stored = input.meetStore.save({
          origins: sources.resolvedOrigins.map(toMeetOrigin),
          midpoint: result.value.midpoint,
          fairness: result.value.fairnessRows,
          places: [],
          mode: sources.mode,
          sourceNote: sourceNote(sources.sources),
        })
        return textResult(
          [
            "## 모임좌표 중간지점",
            "",
            `- 좌표: ${result.value.midpoint.x}, ${result.value.midpoint.y}`,
            "",
            ...result.value.fairnessRows.map(
              (row) => `- ${row.originLabel}: 약 ${row.distanceMeters.toLocaleString("ko-KR")}m`,
            ),
            "",
            "### 지도",
            `- 지도 보기: ${meetUrl(input.publicBaseUrl, stored.id)}`,
            "",
            "### 소스 상태",
            formatSourceStatuses(sources.sources),
          ].join("\n"),
        )
      },
    }),
    defineTool({
      name: "recommend_midpoint_places",
      title: "중간 장소 추천",
      description: "모임좌표가 중간지점 주변의 만날 장소 후보를 fixture-safe 방식으로 추천합니다.",
      inputSchema: {
        midpoint: z.unknown().optional(),
        origins: z.unknown().optional(),
        categories: z.array(placeCategorySchema).min(1).max(6).default(["cafe"]),
        radiusMeters: z.number().int().min(300).max(20_000).default(1500),
        limit: z.number().int().min(1).max(10).default(5),
      },
      openWorldHint: true,
      handler: async ({ midpoint, origins, categories, radiusMeters, limit }) => {
        const parsedOrigins = origins === undefined ? [] : parseOrigins(origins)
        if (parsedOrigins === undefined) {
          return errorTextResult(formatMidpointError("at least 2 resolved origins are required"))
        }
        const parsedMidpoint =
          midpoint === undefined ? undefined : coordinatesSchema.safeParse(midpoint)
        if (parsedMidpoint !== undefined && !parsedMidpoint.success) {
          return errorTextResult(formatMidpointError("at least 2 resolved origins are required"))
        }
        const resolvedMidpoint = parsedMidpoint?.data ?? (await midpointFromOrigins(parsedOrigins))
        if (resolvedMidpoint === undefined) {
          return errorTextResult(formatMidpointError("at least 2 resolved origins are required"))
        }
        const sources = await loadMoimSources({
          origins: parsedOrigins,
          midpoint: resolvedMidpoint,
          categories,
          radiusMeters,
          limit,
        })
        const places = sources.places.length
          ? sources.places
          : recommendMidpointPlaces({ midpoint: resolvedMidpoint, categories, limit, places: [] })
        const stored = input.meetStore.save({
          origins: sources.resolvedOrigins.map(toMeetOrigin),
          midpoint: resolvedMidpoint,
          fairness: sources.resolvedOrigins.map((origin) => ({
            originLabel: origin.label,
            distanceMeters: Math.round(distanceMeters(origin.coordinates, resolvedMidpoint)),
          })),
          places: places.map(toMeetPlace),
          mode: sources.mode,
          sourceNote: sourceNote(sources.sources),
        })
        return textResult(
          [
            "## 모임좌표 중간 장소 후보",
            "",
            ...places.map(
              (place, index) =>
                `${index + 1}. ${place.name} - ${place.address}, 약 ${place.distanceMeters.toLocaleString(
                  "ko-KR",
                )}m${place.placeUrl === undefined ? "" : ` (${place.placeUrl})`}`,
            ),
            "",
            "### 지도",
            `- 지도 보기: ${meetUrl(input.publicBaseUrl, stored.id)}`,
            "",
            "### 소스 상태",
            formatSourceStatuses(sources.sources),
          ].join("\n"),
        )
      },
    }),
    defineTool({
      name: "make_chat_share_message",
      title: "채팅 공유문 만들기",
      description: "모임좌표가 자동 전송 없이 채팅방에 붙여넣을 공유/리마인드 문구를 만듭니다.",
      inputSchema: {
        board: mcpAvailabilityBoardSchema,
        bestSlotIds: z.array(z.string().min(1).max(32)).max(10).optional(),
        placeName: z.string().min(1).max(120).optional(),
      },
      openWorldHint: false,
      handler: (args) => {
        const board = parseAvailabilityBoardInput(args.board)
        if (board === undefined) return errorTextResult(formatBoardStateError())
        const validation = validateAvailabilityBoardState(board)
        if (!validation.ok) return errorTextResult(formatBoardStateError(validation.message))
        return textResult(makeChatShareMessage({ ...args, board }))
      },
    }),
  ] satisfies readonly ToolDefinition[]
}

function safeCreateAvailabilityBoard(
  args: unknown,
):
  | { readonly ok: true; readonly board: AvailabilityBoard }
  | { readonly ok: false; readonly message: string } {
  const parsed = createAvailabilityBoardInputSchema.safeParse(args)
  if (!parsed.success) return { ok: false, message: createInputHint(parsed.error) }
  try {
    return { ok: true, board: createAvailabilityBoard(parsed.data) }
  } catch {
    // Keep internal (English) error details out of the user-facing message.
    return { ok: false, message: "보드를 만들 수 없어요. 날짜와 시간대를 확인해 주세요." }
  }
}

function createInputHint(error: z.ZodError): string {
  const fields = new Set(error.issues.map((issue) => String(issue.path[0] ?? "")))
  if (fields.has("participants"))
    return '참여자 이름을 최소 1명 알려주세요. 예: participants ["민지", "태영"]'
  if (fields.has("timeWindows") || fields.has("startTime") || fields.has("endTime"))
    return '시간대를 알려주세요. 예: timeWindows ["12:00-20:00"] 또는 startTime "12:00", endTime "20:00"'
  if (fields.has("dates")) return '날짜를 YYYY-MM-DD로 알려주세요. 예: dates ["2026-07-11"]'
  if (fields.has("title")) return "약속 제목(title)을 알려주세요."
  return "보드 입력값을 확인해 주세요."
}

function parseOrigins(origins: unknown): readonly OriginInput[] | undefined {
  const parsed = originListSchema.safeParse(origins)
  return parsed.success ? parsed.data : undefined
}

async function midpointFromOrigins(
  origins: readonly OriginInput[],
): Promise<{ readonly x: number; readonly y: number } | undefined> {
  const sources = await loadMoimSources({ origins, midpoint: { x: 126.98, y: 37.54 } })
  const result = findMidpoint({ origins: sources.resolvedOrigins })
  return result.ok ? result.value.midpoint : undefined
}

function voteUrl(
  publicBaseUrl: string,
  stored: { readonly id: string } | undefined,
): string | undefined {
  return stored === undefined ? undefined : boardUrl(publicBaseUrl, stored.id)
}

function boardUrl(publicBaseUrl: string, id: string): string {
  return `${publicBaseUrl.replace(/\/+$/, "")}/boards/${encodeURIComponent(id)}`
}

function meetUrl(publicBaseUrl: string, id: string): string {
  return `${publicBaseUrl.replace(/\/+$/, "")}/meet/${encodeURIComponent(id)}`
}

function toMeetOrigin(origin: ResolvedOrigin): MeetPlanOrigin {
  return {
    label: origin.label,
    address: origin.address,
    x: origin.coordinates.x,
    y: origin.coordinates.y,
  }
}

function toMeetPlace(place: RecommendedPlace): MeetPlanPlace {
  return {
    name: place.name,
    address: place.address,
    x: place.coordinates.x,
    y: place.coordinates.y,
    categoryCode: place.categoryCode,
    placeUrl: place.placeUrl,
    distanceMeters: place.distanceMeters,
  }
}

function sourceNote(sources: readonly { readonly note: string }[]): string {
  return sources.map((source) => source.note).join("; ")
}
