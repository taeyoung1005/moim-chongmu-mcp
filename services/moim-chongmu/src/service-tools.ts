import { defineTool, errorTextResult, type ToolDefinition, textResult } from "@playmcp/mcp-common"
import * as z from "zod/v4"

import { fetchDrivingRoute } from "./adapters/kakao-directions.js"
import type { MoimEnv } from "./adapters/moim-sources.js"
import { loadMoimSources } from "./adapters/moim-sources.js"
import type { OdsayOptions } from "./adapters/odsay-transit.js"
import { planTransitMidpoint, type TransitMidpointPlan } from "./adapters/transit-midpoint.js"
import { resolveAvailabilityBoardReference } from "./availability-board-reference.js"
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
  createAvailabilityBoardInputSchema,
  lenientCoordinatesSchema,
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
  readonly routeApiKey?: string | undefined
  readonly moimEnv?: MoimEnv | undefined
  readonly odsayOptions?: OdsayOptions | undefined
}): readonly ToolDefinition[] {
  return [
    defineTool({
      name: "create_availability_board",
      title: "가능 시간 보드 만들기",
      description:
        "모임총무가 when2meet처럼 가능한 시간 보드와 빈 heatmap을 만듭니다. 사용자가 약속 제목·날짜·시간대·실제 참가자 이름을 모두 직접 말한 경우에만 호출하세요. 참가자 이름을 알 수 없으면 질문으로 확인해야 하며, 출발지·역·장소 이름을 사람 이름으로 추론하면 안 됩니다.",
      inputSchema: {
        title: z
          .unknown()
          .optional()
          .describe("필수. 사용자가 직접 말한 약속 제목입니다. 제목이 없으면 먼저 질문합니다."),
        dates: z
          .unknown()
          .optional()
          .describe("필수. 사용자가 직접 말한 후보 날짜 목록(YYYY-MM-DD)입니다."),
        timeWindows: z
          .unknown()
          .optional()
          .describe('필수. 사용자가 직접 말한 후보 시간대입니다. 예: ["10:00-23:00"].'),
        startTime: z.unknown().optional().describe("timeWindows 대신 쓰는 시작 시각(HH:mm)입니다."),
        endTime: z.unknown().optional().describe("timeWindows 대신 쓰는 종료 시각(HH:mm)입니다."),
        participants: z
          .unknown()
          .optional()
          .describe(
            "필수. 사용자가 대화에서 직접 밝힌 실제 사람 이름 목록입니다. 출발지·역·장소에서 사람 이름을 추론해 넣지 마세요. 이름이 없으면 도구를 호출하지 말고 먼저 질문합니다.",
          ),
        slotMinutes: z.unknown().optional().describe("선택. 30 또는 60분 단위입니다."),
        note: z.unknown().optional().describe("선택. 참여자에게 보일 안내 문구입니다."),
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
      description:
        "모임총무가 한 참여자의 가능 시간을 갱신합니다. create_availability_board 또는 직전 mark_availability가 돌려준 최신 boardState가 있을 때만 호출하세요. participant는 boardState.participants에 있는 실제 이름을 그대로 사용하고, 이름이나 슬롯 ID를 추론하지 마세요.",
      inputSchema: {
        state: mcpAvailabilityBoardSchema.describe(
          "필수. 직전 보드 결과에 포함된 최신 boardState 전체입니다.",
        ),
        participant: z
          .string()
          .min(1)
          .max(40)
          .describe("필수. boardState.participants에 있는 이름을 글자까지 동일하게 사용합니다."),
        availableSlotIds: z
          .array(z.string().min(1).max(32))
          .max(168)
          .describe(
            "필수. boardState.slots에서 선택한 id 목록입니다. 슬롯을 임의로 만들지 마세요.",
          ),
        expectedStateHash: z
          .string()
          .min(1)
          .max(128)
          .optional()
          .describe("선택. 동시 수정 방지를 위해 최신 boardState.stateHash를 그대로 넣습니다."),
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
      description:
        "모임총무가 현재 가능 시간 heatmap과 미응답자를 요약합니다. create_availability_board 또는 mark_availability가 돌려준 최신 boardState가 있을 때만 호출하세요.",
      inputSchema: {
        state: mcpAvailabilityBoardSchema.describe(
          "필수. 직전 보드 결과에 포함된 최신 boardState 전체입니다.",
        ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(10)
          .default(5)
          .describe("선택. 보여줄 최적 시간대 수이며 기본값은 5입니다."),
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
      description:
        "모임총무가 2곳 이상 출발지의 중간지점을 계산합니다. origins는 사용자가 직접 말한 출발지만 넣고, 참가자 이름이나 장소를 추론해 추가하지 마세요. basis는 사용자가 거리 또는 대중교통 시간 중 무엇을 원하는지 밝힌 뒤에만 넣습니다. 기준이 없으면 먼저 물어봅니다.",
      inputSchema: {
        origins: z
          .unknown()
          .describe(
            '필수. 사용자가 직접 말한 출발지 2~10곳입니다. 예: ["강남역", "홍대역"] 또는 [{"name":"집","lat":37.5,"lon":127.0}].',
          ),
        basis: z
          .union([z.literal("distance"), z.literal("public_transit_time")])
          .optional()
          .describe(
            "선택. distance는 거리 균형, public_transit_time은 실제 ODsay 대중교통 시간입니다. 사용자가 기준을 고른 경우에만 넣습니다.",
          ),
      },
      openWorldHint: true,
      handler: async ({ origins, basis }) => {
        const parsedOrigins = parseOrigins(origins)
        if (parsedOrigins === undefined) {
          return errorTextResult(
            formatMidpointError(
              '출발지를 2곳 이상 알려주세요. 예: ["강남역", "홍대역"] 또는 [{"label":"집","lat":37.5,"lng":127.0}]',
            ),
          )
        }
        if (basis === undefined) {
          return textResult(
            [
              "## 중간지점 기준을 선택해 주세요",
              "",
              "- `distance`: 출발지와의 거리 균형 기준",
              "- `public_transit_time`: ODsay 실제 대중교통 소요시간 기준",
            ].join("\n"),
          )
        }
        if (basis === "public_transit_time") {
          const plan = await planTransitMidpoint({
            origins: parsedOrigins,
            env: input.moimEnv,
            odsayOptions: input.odsayOptions,
          })
          if (plan === undefined) {
            return errorTextResult(formatMidpointError("대중교통 경로를 찾을 수 없습니다."))
          }
          return textResult(formatTransitPlan(plan))
        }
        const sources = await loadMoimSources({
          origins: parsedOrigins,
          midpoint: { x: 126.98, y: 37.54 },
        })
        const result = findMidpoint({ origins: sources.resolvedOrigins, basis })
        if (!result.ok) {
          return errorTextResult(formatMidpointError("출발지를 2곳 이상 알려주세요."))
        }
        const stored = input.meetStore.save({
          origins: await withRoutes(
            sources.resolvedOrigins.map(toMeetOrigin),
            result.value.midpoint,
            input.routeApiKey,
          ),
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
      description:
        "모임총무가 중간지점 주변의 만날 장소 후보를 추천합니다. 이미 계산한 midpoint 좌표가 있으면 그대로 쓰고, 없으면 사용자가 직접 말한 origins 2곳 이상으로 계산합니다. midpoint와 origins를 임의로 만들지 마세요.",
      inputSchema: {
        midpoint: z
          .unknown()
          .optional()
          .describe("선택. find_midpoint 결과의 좌표를 그대로 사용합니다. {lat,lng} 또는 {x,y}."),
        origins: z
          .unknown()
          .optional()
          .describe("선택. midpoint가 없을 때만 사용자의 출발지 2곳 이상을 넣습니다."),
        categories: z
          .array(placeCategorySchema)
          .min(1)
          .max(6)
          .default(["cafe"])
          .describe("선택. cafe, restaurant, bar, culture, park 중 사용자가 요청한 유형입니다."),
        radiusMeters: z
          .number()
          .int()
          .min(300)
          .max(20_000)
          .default(1500)
          .describe("선택. 중간지점에서 검색할 반경(미터)이며 기본값은 1500입니다."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(10)
          .default(5)
          .describe("선택. 추천 수이며 기본값은 5입니다."),
      },
      openWorldHint: true,
      handler: async ({ midpoint, origins, categories, radiusMeters, limit }) => {
        const parsedOrigins = origins === undefined ? [] : parseOrigins(origins)
        if (parsedOrigins === undefined) {
          return errorTextResult(
            formatMidpointError('출발지 형식을 확인해 주세요. 예: origins ["강남역", "홍대역"]'),
          )
        }
        const parsedMidpoint =
          midpoint === undefined ? undefined : lenientCoordinatesSchema.safeParse(midpoint)
        if (parsedMidpoint !== undefined && !parsedMidpoint.success) {
          return errorTextResult(
            formatMidpointError(
              '중간지점 좌표 형식을 확인해 주세요. 예: {"lat":37.5,"lng":127.0} 또는 {"x":127.0,"y":37.5}',
            ),
          )
        }
        const resolvedMidpoint = parsedMidpoint?.data ?? (await midpointFromOrigins(parsedOrigins))
        if (resolvedMidpoint === undefined) {
          return errorTextResult(
            formatMidpointError("출발지를 2곳 이상 알려주거나, 중간지점 좌표를 알려주세요."),
          )
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
          origins: await withRoutes(
            sources.resolvedOrigins.map(toMeetOrigin),
            resolvedMidpoint,
            input.routeApiKey,
          ),
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
      description:
        "모임총무가 자동 전송 없이 채팅방에 붙여넣을 공유·리마인드 문구를 만듭니다. 실제 메시지를 전송하지 않습니다. 이미 만든 보드의 UUID·URL·boardState를 받은 경우에만 호출하세요.",
      inputSchema: {
        board: z
          .unknown()
          .describe(
            "가능 시간 보드의 UUID, 전체 보드 URL, 또는 create_availability_board의 boardState",
          ),
        bestSlotIds: z
          .array(z.string().min(1).max(32))
          .max(10)
          .optional()
          .describe("선택. boardState.slots에서 가져온 확정·추천 슬롯 ID 목록입니다."),
        placeName: z
          .string()
          .min(1)
          .max(120)
          .optional()
          .describe("선택. 사용자가 확정했거나 장소 추천 결과에 나온 만남 장소명입니다."),
      },
      openWorldHint: false,
      handler: (args) => {
        const board = resolveAvailabilityBoardReference(args.board, input.boardStore)
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
    return '참여자 이름을 알려주세요. 예: participants ["민지", "태영"]'
  if (fields.has("timeWindows") || fields.has("startTime") || fields.has("endTime"))
    return '시간대를 알려주세요. 예: timeWindows ["12:00-20:00"] 또는 startTime "12:00", endTime "20:00"'
  if (fields.has("dates"))
    return '날짜를 YYYY-MM-DD로, 최대 14일까지 알려주세요. 예: dates ["2026-07-11"]'
  if (fields.has("slotMinutes"))
    return "슬롯 단위는 30분 또는 60분만 됩니다. slotMinutes: 30 또는 60."
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

function formatTransitPlan(plan: TransitMidpointPlan): string {
  return [
    "## 모임좌표 대중교통 중간지점",
    "",
    `- 추천 장소: ${plan.placeName}`,
    ...(plan.address === undefined ? [] : [`- 주소: ${plan.address}`]),
    `- 평균 이동시간: 약 ${plan.averageMinutes}분`,
    `- 가장 오래 걸리는 사람: 약 ${plan.maxMinutes}분`,
    `- 계산 방식: ${plan.provider === "odsay" ? "ODsay 실제 대중교통 경로" : "직선거리 기반 근사"}`,
    "",
    ...plan.routes.flatMap((route) => [
      `- ${route.originLabel}: 약 ${route.totalMinutes}분 · 도보 ${route.totalWalkMeters.toLocaleString("ko-KR")}m · 환승 ${route.transferCount}회${route.paymentWon > 0 ? ` · ${route.paymentWon.toLocaleString("ko-KR")}원` : ""}`,
      `  - 카카오맵: ${route.kakaoMapUrl}`,
    ]),
    "",
    `> ${plan.note}`,
    "",
    "### 소스 상태",
    formatSourceStatuses(plan.sources),
  ].join("\n")
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

// Attach a road-following driving route (Kakao Mobility) from each origin to the midpoint,
// when a REST key is available. Best-effort per origin — failures keep the origin route-less.
async function withRoutes(
  origins: readonly MeetPlanOrigin[],
  midpoint: { readonly x: number; readonly y: number },
  apiKey: string | undefined,
): Promise<readonly MeetPlanOrigin[]> {
  if (apiKey === undefined || apiKey.trim().length < 12) return origins
  const key = apiKey.trim()
  return Promise.all(
    origins.map(async (origin) => {
      const route = await fetchDrivingRoute({
        origin: { x: origin.x, y: origin.y },
        destination: midpoint,
        apiKey: key,
        timeoutMs: 4500,
      })
      return route === undefined ? origin : { ...origin, route }
    }),
  )
}
