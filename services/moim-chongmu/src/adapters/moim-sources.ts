import {
  type Coordinates,
  type MeetingOrigin,
  type PlaceCandidate,
  type PlaceCategory,
  type RecommendedPlace,
  type ResolvedOrigin,
  recommendMidpointPlaces,
} from "../domain/moim.js"
import {
  KakaoLocalError,
  type KakaoLocalOptions,
  resolveKakaoAddress,
  searchKakaoCategory,
} from "./kakao-local.js"

export type MoimDataMode = "fixture" | "live"
export type SourceStatusKind = "fixture" | "live-ready" | "unavailable"
export type SourceKey = "kakaoLocal"
export type MoimEnv = Readonly<Record<string, string | undefined>>

export type SourcePolicy = {
  readonly label: string
  readonly envKey: "KAKAO_REST_API_KEY"
}

export type SourceStatus = SourcePolicy & {
  readonly key: SourceKey
  readonly status: SourceStatusKind
  readonly note: string
}

export type MoimSourceInput = {
  readonly origins: readonly MeetingOrigin[]
  readonly midpoint: Coordinates
  readonly categories?: readonly PlaceCategory[] | undefined
  readonly radiusMeters?: number | undefined
  readonly limit?: number | undefined
}

export type MoimSourceSnapshot = {
  readonly mode: MoimDataMode
  readonly resolvedOrigins: readonly ResolvedOrigin[]
  readonly places: readonly RecommendedPlace[]
  readonly sources: readonly SourceStatus[]
}

export const sourcePolicies = {
  kakaoLocal: {
    label: "Kakao Local address/category search",
    envKey: "KAKAO_REST_API_KEY",
  },
} as const satisfies Record<SourceKey, SourcePolicy>

const defaultPlaceCategories = ["cafe"] as const satisfies readonly PlaceCategory[]

export async function loadMoimSources(
  input: MoimSourceInput,
  env: MoimEnv = process.env,
  options: KakaoLocalOptions = {},
): Promise<MoimSourceSnapshot> {
  const mode = env["MOIM_COORDINATOR_DATA_MODE"] === "live" ? "live" : "fixture"
  if (mode === "fixture") {
    return {
      mode,
      ...fixtureSnapshot(input),
      sources: [sourceStatus("fixture", "local fixture data")],
    }
  }

  const apiKey = env[sourcePolicies.kakaoLocal.envKey]
  if (!isUsableApiKey(apiKey)) {
    return {
      mode,
      ...fixtureSnapshot(input),
      sources: [sourceStatus("unavailable", "API key unusable; fixture fallback used")],
    }
  }

  try {
    const normalizedOptions = withEnvDefaults(env, options)
    const resolvedOrigins = await resolveOrigins(input.origins, apiKey.trim(), normalizedOptions)
    const categories = input.categories?.length ? input.categories : defaultPlaceCategories
    const nestedPlaces = await Promise.all(
      categories.map((category) =>
        searchKakaoCategory({
          midpoint: input.midpoint,
          category,
          apiKey: apiKey.trim(),
          radiusMeters: input.radiusMeters ?? 1500,
          options: normalizedOptions,
        }),
      ),
    )
    return {
      mode,
      resolvedOrigins,
      places: recommendMidpointPlaces({
        midpoint: input.midpoint,
        categories,
        limit: input.limit,
        places: nestedPlaces.flat(),
      }),
      sources: [sourceStatus("live-ready", "live fetched; fixture fallback kept")],
    }
  } catch (error) {
    return {
      mode,
      ...fixtureSnapshot(input),
      sources: [
        sourceStatus("unavailable", `live unavailable: ${errorNote(error)}; fixture fallback used`),
      ],
    }
  }
}

function fixtureSnapshot(input: MoimSourceInput): Omit<MoimSourceSnapshot, "mode" | "sources"> {
  return {
    resolvedOrigins: input.origins.flatMap(resolveFixtureOrigin),
    places: recommendMidpointPlaces({
      midpoint: input.midpoint,
      categories: input.categories,
      limit: input.limit,
      places: fixturePlaces,
    }),
  }
}

async function resolveOrigins(
  origins: readonly MeetingOrigin[],
  apiKey: string,
  options: KakaoLocalOptions,
): Promise<readonly ResolvedOrigin[]> {
  const resolved = await Promise.all(
    origins.map((origin) => {
      if (origin.coordinates !== undefined) {
        return Promise.resolve({
          label: normalizeText(origin.label),
          address: origin.address,
          coordinates: origin.coordinates,
        })
      }
      if (origin.address === undefined) return Promise.resolve(undefined)
      return resolveKakaoAddress({
        label: normalizeText(origin.label),
        address: origin.address,
        apiKey,
        options,
      })
    }),
  )
  return resolved.flatMap((origin) => (origin === undefined ? [] : [origin]))
}

function resolveFixtureOrigin(origin: MeetingOrigin): readonly ResolvedOrigin[] {
  if (origin.coordinates !== undefined) {
    return [
      {
        label: normalizeText(origin.label),
        address: origin.address,
        coordinates: origin.coordinates,
      },
    ]
  }
  if (origin.address === undefined) return []
  const address = normalizeText(origin.address)
  return [
    {
      label: normalizeText(origin.label),
      address,
      coordinates: fixtureAddressCoordinates(address),
    },
  ]
}

function sourceStatus(status: SourceStatusKind, note: string): SourceStatus {
  return { key: "kakaoLocal", ...sourcePolicies.kakaoLocal, status, note }
}

function fixtureAddressCoordinates(address: string): Coordinates {
  if (address.includes("서울역")) return { x: 126.9723, y: 37.5547 }
  if (address.includes("시청")) return { x: 126.978, y: 37.5665 }
  if (address.includes("강남")) return { x: 127.0276, y: 37.4979 }
  return { x: 126.98, y: 37.54 }
}

function isUsableApiKey(value: string | undefined): value is string {
  return (
    typeof value === "string" && value.trim().length >= 12 && value.trim().toLowerCase() !== "bad"
  )
}

function errorNote(error: unknown): string {
  if (!(error instanceof KakaoLocalError)) return "upstream unavailable"
  switch (error.reason) {
    case "timeout":
      return "timeout"
    case "http":
      return "upstream http error"
    case "empty":
      return "empty result"
    case "malformed":
      return "malformed upstream"
    case "oversized":
      return "oversized upstream"
    default:
      return assertNever(error.reason)
  }
}

function withEnvDefaults(env: MoimEnv, options: KakaoLocalOptions): KakaoLocalOptions {
  if (options.timeoutMs !== undefined) return options
  const timeoutMs = parsePositiveInt(env["MOIM_COORDINATOR_LIVE_TIMEOUT_MS"])
  return timeoutMs === undefined ? options : { ...options, timeoutMs }
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ")
}

function assertNever(value: never): never {
  throw new Error(`unexpected source error reason: ${value}`)
}

const fixturePlaces: readonly PlaceCandidate[] = [
  {
    id: "fixture-cafe-1",
    name: "중간지점 라운지",
    address: "서울 중구 세종대로",
    x: 126.979,
    y: 37.542,
    categoryCode: "CE7",
    placeUrl: "https://place.map.kakao.com/fixture-cafe-1",
  },
  {
    id: "fixture-food-1",
    name: "좌표 식당",
    address: "서울 중구 남대문로",
    x: 126.982,
    y: 37.541,
    categoryCode: "FD6",
    placeUrl: "https://place.map.kakao.com/fixture-food-1",
  },
  {
    id: "fixture-subway-1",
    name: "시청역",
    address: "서울 중구",
    x: 126.976,
    y: 37.565,
    categoryCode: "SW8",
    placeUrl: "https://place.map.kakao.com/fixture-subway-1",
  },
  {
    id: "fixture-culture-1",
    name: "서울 문화공간",
    address: "서울 중구",
    x: 126.981,
    y: 37.544,
    categoryCode: "CT1",
    placeUrl: "https://place.map.kakao.com/fixture-culture-1",
  },
]
