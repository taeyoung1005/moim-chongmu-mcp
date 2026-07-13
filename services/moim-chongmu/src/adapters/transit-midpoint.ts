import type {
  Coordinates,
  MeetingOrigin,
  RecommendedPlace,
  ResolvedOrigin,
} from "../domain/moim.js"
import { findMidpoint } from "../domain/moim.js"
import type { MoimEnv, SourceStatus } from "./moim-sources.js"
import { loadMoimSources, sourcePolicies } from "./moim-sources.js"
import type { OdsayOptions, OdsayTransitRoute } from "./odsay-transit.js"
import {
  loadOdsayTransitPolyline,
  OdsayTransitError,
  searchOdsayTransitRoute,
} from "./odsay-transit.js"

export type TransitRoutePlan = {
  readonly originLabel: string
  readonly totalMinutes: number
  readonly paymentWon: number
  readonly totalWalkMeters: number
  readonly transferCount: number
  readonly polyline: readonly Coordinates[]
  readonly kakaoMapUrl: string
}

export type TransitMidpointPlan = {
  readonly provider: "odsay" | "approximate"
  readonly placeName: string
  readonly address?: string | undefined
  readonly midpoint: Coordinates
  readonly maxMinutes: number
  readonly averageMinutes: number
  readonly routes: readonly TransitRoutePlan[]
  readonly sources: readonly SourceStatus[]
  readonly note: string
}

type Candidate = {
  readonly name: string
  readonly address?: string | undefined
  readonly coordinates: Coordinates
}

type CandidateEvaluation = Candidate & {
  readonly routes: readonly (OdsayTransitRoute & { readonly origin: ResolvedOrigin })[]
  readonly maxMinutes: number
  readonly averageMinutes: number
}

export async function planTransitMidpoint(input: {
  readonly origins: readonly MeetingOrigin[]
  readonly env?: MoimEnv | undefined
  readonly odsayOptions?: OdsayOptions | undefined
}): Promise<TransitMidpointPlan | undefined> {
  const env = input.env ?? process.env
  const originSources = await loadMoimSources(
    { origins: input.origins, midpoint: { x: 126.98, y: 37.54 }, categories: ["any"] },
    env,
  )
  const distanceResult = findMidpoint({ origins: originSources.resolvedOrigins })
  if (!distanceResult.ok) return undefined
  const apiKey = usableKey(env["ODSAY_API_KEY"])
  if (apiKey === undefined) {
    const approximate = findMidpoint({
      origins: originSources.resolvedOrigins,
      basis: "public_transit_time",
    })
    if (!approximate.ok) return undefined
    const routes = approximate.value.fairnessRows.map((row, index) => {
      const origin = originSources.resolvedOrigins[index]
      if (origin === undefined) return undefined
      return {
        originLabel: row.originLabel,
        totalMinutes: row.estimatedTransitMinutes ?? 1,
        paymentWon: 0,
        totalWalkMeters: 0,
        transferCount: 0,
        polyline: [origin.coordinates, approximate.value.midpoint],
        kakaoMapUrl: kakaoTransitUrl(
          origin.label,
          origin.coordinates,
          "중간지점",
          approximate.value.midpoint,
        ),
      }
    })
    const usableRoutes = routes.filter((route) => route !== undefined)
    return {
      provider: "approximate",
      placeName: "중간지점",
      midpoint: approximate.value.midpoint,
      maxMinutes: Math.max(...usableRoutes.map((route) => route.totalMinutes)),
      averageMinutes: average(usableRoutes.map((route) => route.totalMinutes)),
      routes: usableRoutes,
      sources: [...originSources.sources, odsayStatus("unavailable", "API key unusable")],
      note: "ODSAY_API_KEY가 없어 직선거리 기반 근사치를 사용했습니다.",
    }
  }

  const candidateSources = await loadMoimSources(
    {
      origins: originSources.resolvedOrigins,
      midpoint: distanceResult.value.midpoint,
      categories: ["subway"],
      radiusMeters: 20_000,
      limit: 5,
    },
    env,
  )
  const candidates = transitCandidates(candidateSources.places, distanceResult.value.midpoint)
  const evaluations = (
    await Promise.all(
      candidates.map((candidate) =>
        evaluateCandidate(candidate, originSources.resolvedOrigins, apiKey, input.odsayOptions),
      ),
    )
  ).filter((evaluation) => evaluation !== undefined)
  const best = evaluations.sort(
    (left, right) =>
      left.maxMinutes - right.maxMinutes || left.averageMinutes - right.averageMinutes,
  )[0]
  if (best === undefined)
    return fallbackAfterOdsayFailure(originSources.resolvedOrigins, originSources.sources)

  const routes = await Promise.all(
    best.routes.map(async (route) => {
      const polyline = await safePolyline(route, apiKey, input.odsayOptions, best.coordinates)
      return {
        originLabel: route.origin.label,
        totalMinutes: route.totalMinutes,
        paymentWon: route.paymentWon,
        totalWalkMeters: route.totalWalkMeters,
        transferCount: route.transferCount,
        polyline,
        kakaoMapUrl: kakaoTransitUrl(
          route.origin.label,
          route.origin.coordinates,
          best.name,
          best.coordinates,
        ),
      }
    }),
  )
  return {
    provider: "odsay",
    placeName: best.name,
    address: best.address,
    midpoint: best.coordinates,
    maxMinutes: best.maxMinutes,
    averageMinutes: best.averageMinutes,
    routes,
    sources: [
      ...originSources.sources,
      ...candidateSources.sources,
      odsayStatus("live-ready", "live public transit routes fetched"),
    ],
    note: "ODsay 실제 대중교통 추천 경로의 소요시간으로 후보를 비교했습니다.",
  }
}

async function evaluateCandidate(
  candidate: Candidate,
  origins: readonly ResolvedOrigin[],
  apiKey: string,
  options: OdsayOptions | undefined,
): Promise<CandidateEvaluation | undefined> {
  try {
    const routes = await Promise.all(
      origins.map(async (origin) => ({
        ...(await searchOdsayTransitRoute({
          origin: origin.coordinates,
          destination: candidate.coordinates,
          apiKey,
          options,
        })),
        origin,
      })),
    )
    const minutes = routes.map((route) => route.totalMinutes)
    return {
      ...candidate,
      routes,
      maxMinutes: Math.max(...minutes),
      averageMinutes: average(minutes),
    }
  } catch {
    return undefined
  }
}

async function safePolyline(
  route: OdsayTransitRoute & { readonly origin: ResolvedOrigin },
  apiKey: string,
  options: OdsayOptions | undefined,
  destination: Coordinates,
): Promise<readonly Coordinates[]> {
  try {
    const lane = await loadOdsayTransitPolyline({ mapObject: route.mapObject, apiKey, options })
    return [route.origin.coordinates, ...lane, destination]
  } catch (error) {
    if (!(error instanceof OdsayTransitError)) return [route.origin.coordinates, destination]
    return [route.origin.coordinates, destination]
  }
}

function transitCandidates(
  places: readonly RecommendedPlace[],
  fallback: Coordinates,
): readonly Candidate[] {
  const candidates = places.slice(0, 5).map((place) => ({
    name: place.name,
    address: place.address,
    coordinates: place.coordinates,
  }))
  return candidates.length > 0 ? candidates : [{ name: "거리 중간지점", coordinates: fallback }]
}

function fallbackAfterOdsayFailure(
  origins: readonly ResolvedOrigin[],
  sources: readonly SourceStatus[],
): TransitMidpointPlan | undefined {
  const result = findMidpoint({ origins, basis: "public_transit_time" })
  if (!result.ok) return undefined
  const routes = result.value.fairnessRows.flatMap((row, index) => {
    const origin = origins[index]
    if (origin === undefined) return []
    return [
      {
        originLabel: origin.label,
        totalMinutes: row.estimatedTransitMinutes ?? 1,
        paymentWon: 0,
        totalWalkMeters: 0,
        transferCount: 0,
        polyline: [origin.coordinates, result.value.midpoint],
        kakaoMapUrl: kakaoTransitUrl(
          origin.label,
          origin.coordinates,
          "중간지점",
          result.value.midpoint,
        ),
      },
    ]
  })
  return {
    provider: "approximate",
    placeName: "중간지점",
    midpoint: result.value.midpoint,
    maxMinutes: Math.max(...routes.map((route) => route.totalMinutes)),
    averageMinutes: average(routes.map((route) => route.totalMinutes)),
    routes,
    sources: [...sources, odsayStatus("unavailable", "route unavailable; estimate fallback used")],
    note: "ODsay 호출을 사용할 수 없어 직선거리 기반 근사치로 폴백했습니다.",
  }
}

function kakaoTransitUrl(
  originName: string,
  origin: Coordinates,
  destinationName: string,
  destination: Coordinates,
): string {
  const from = `${encodeURIComponent(originName)},${origin.y},${origin.x}`
  const to = `${encodeURIComponent(destinationName)},${destination.y},${destination.x}`
  return `https://map.kakao.com/link/by/traffic/${from}/${to}`
}

function average(values: readonly number[]): number {
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
}

function usableKey(value: string | undefined): string | undefined {
  if (value === undefined || value.trim().length < 8 || value.trim().toLowerCase() === "bad") {
    return undefined
  }
  return value.trim()
}

function odsayStatus(status: "live-ready" | "unavailable", note: string): SourceStatus {
  return { key: "odsayTransit", ...sourcePolicies.odsayTransit, status, note }
}
