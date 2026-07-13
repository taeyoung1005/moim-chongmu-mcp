export type Coordinates = {
  readonly x: number
  readonly y: number
}

export type MeetingOrigin = {
  readonly label: string
  readonly address?: string | undefined
  readonly coordinates?: Coordinates | undefined
}

export type ResolvedOrigin = {
  readonly label: string
  readonly address?: string | undefined
  readonly coordinates: Coordinates
}

export type FairnessRow = {
  readonly originLabel: string
  readonly distanceMeters: number
  readonly estimatedTransitMinutes?: number | undefined
}

export type MidpointBasis = "distance" | "public_transit_time"

export type MidpointResult = {
  readonly basis: MidpointBasis
  readonly midpoint: Coordinates
  readonly fairnessRows: readonly FairnessRow[]
}

export type MidpointError = {
  readonly kind: "insufficient_origins"
  readonly message: "at least 2 resolved origins are required"
  readonly resolvedCount: number
}

export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E }

export const placeCategoryCodes = {
  cafe: "CE7",
  restaurant: "FD6",
  subway: "SW8",
  culture: "CT1",
  attraction: "AT4",
  parking: "PK6",
} as const

export type PlaceCategory = keyof typeof placeCategoryCodes | "any"
export type PlaceCategoryCode = (typeof placeCategoryCodes)[keyof typeof placeCategoryCodes]

export type PlaceCandidate = {
  readonly id?: string | undefined
  readonly name: string
  readonly address: string
  readonly x: number
  readonly y: number
  readonly categoryCode?: string | undefined
  readonly placeUrl?: string | undefined
}

export type RecommendedPlace = {
  readonly id?: string | undefined
  readonly name: string
  readonly address: string
  readonly coordinates: Coordinates
  readonly categoryCode?: string | undefined
  readonly placeUrl?: string | undefined
  readonly distanceMeters: number
}

export function findMidpoint(input: {
  readonly origins: readonly MeetingOrigin[]
  readonly basis?: MidpointBasis | undefined
}): Result<MidpointResult, MidpointError> {
  const resolved = input.origins.flatMap((origin) => {
    if (origin.coordinates === undefined || !isCoordinate(origin.coordinates)) return []
    return [
      {
        label: normalizeText(origin.label),
        address: origin.address,
        coordinates: origin.coordinates,
      },
    ]
  })

  if (resolved.length < 2) {
    return {
      ok: false,
      error: {
        kind: "insufficient_origins",
        message: "at least 2 resolved origins are required",
        resolvedCount: resolved.length,
      },
    }
  }

  const basis = input.basis ?? "distance"
  const midpoint =
    basis === "public_transit_time"
      ? transitTimeMidpoint(resolved.map((origin) => origin.coordinates))
      : coordinateAverage(resolved.map((origin) => origin.coordinates))
  return {
    ok: true,
    value: {
      basis,
      midpoint,
      fairnessRows: resolved.map((origin) => {
        const meters = Math.round(distanceMeters(origin.coordinates, midpoint))
        return {
          originLabel: origin.label,
          distanceMeters: meters,
          ...(basis === "public_transit_time"
            ? { estimatedTransitMinutes: estimateTransitMinutes(meters) }
            : {}),
        }
      }),
    },
  }
}

function coordinateAverage(coordinates: readonly Coordinates[]): Coordinates {
  return {
    x: round4(coordinates.reduce((sum, point) => sum + point.x, 0) / coordinates.length),
    y: round4(coordinates.reduce((sum, point) => sum + point.y, 0) / coordinates.length),
  }
}

function transitTimeMidpoint(coordinates: readonly Coordinates[]): Coordinates {
  const average = coordinateAverage(coordinates)
  const xs = coordinates.map((point) => point.x)
  const ys = coordinates.map((point) => point.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const steps = 24
  let best = average
  let bestScore = transitScore(coordinates, average)
  for (let xIndex = 0; xIndex <= steps; xIndex += 1) {
    for (let yIndex = 0; yIndex <= steps; yIndex += 1) {
      const candidate = {
        x: minX + ((maxX - minX) * xIndex) / steps,
        y: minY + ((maxY - minY) * yIndex) / steps,
      }
      const score = transitScore(coordinates, candidate)
      if (
        score.maxMinutes < bestScore.maxMinutes ||
        (score.maxMinutes === bestScore.maxMinutes && score.totalMinutes < bestScore.totalMinutes)
      ) {
        best = candidate
        bestScore = score
      }
    }
  }
  return { x: round4(best.x), y: round4(best.y) }
}

function transitScore(
  origins: readonly Coordinates[],
  candidate: Coordinates,
): { readonly maxMinutes: number; readonly totalMinutes: number } {
  const minutes = origins.map((origin) => estimateTransitMinutes(distanceMeters(origin, candidate)))
  return {
    maxMinutes: Math.max(...minutes),
    totalMinutes: minutes.reduce((sum, value) => sum + value, 0),
  }
}

function estimateTransitMinutes(distance: number): number {
  return Math.max(1, Math.round(8 + distance / 350))
}

export function recommendMidpointPlaces(input: {
  readonly midpoint: Coordinates
  readonly categories?: readonly PlaceCategory[] | undefined
  readonly limit?: number | undefined
  readonly places: readonly PlaceCandidate[]
}): readonly RecommendedPlace[] {
  const limit = Math.min(Math.max(input.limit ?? 5, 1), 10)
  const seen = new Set<string>()
  const requestedCodes = categoryCodes(input.categories)

  return input.places
    .flatMap((place) => {
      if (!matchesCategory(place.categoryCode, requestedCodes)) return []
      const key =
        place.id ?? place.placeUrl ?? `${normalizeText(place.name)}:${normalizeText(place.address)}`
      if (seen.has(key)) return []
      seen.add(key)
      return [
        {
          id: place.id,
          name: normalizeText(place.name),
          address: normalizeText(place.address),
          coordinates: { x: place.x, y: place.y },
          categoryCode: place.categoryCode,
          placeUrl: place.placeUrl,
          distanceMeters: Math.round(distanceMeters({ x: place.x, y: place.y }, input.midpoint)),
        },
      ]
    })
    .sort(
      (left, right) =>
        left.distanceMeters - right.distanceMeters ||
        categoryRank(left.categoryCode, requestedCodes) -
          categoryRank(right.categoryCode, requestedCodes) ||
        left.name.localeCompare(right.name, "ko-KR"),
    )
    .slice(0, limit)
}

export function distanceMeters(left: Coordinates, right: Coordinates): number {
  const radiusMeters = 6_371_000
  const leftLat = radians(left.y)
  const rightLat = radians(right.y)
  const deltaLat = radians(right.y - left.y)
  const deltaLon = radians(right.x - left.x)
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(leftLat) * Math.cos(rightLat) * Math.sin(deltaLon / 2) ** 2
  return radiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function isCoordinate(coordinates: Coordinates): boolean {
  return Number.isFinite(coordinates.x) && Number.isFinite(coordinates.y)
}

function categoryCodes(categories: readonly PlaceCategory[] | undefined): ReadonlySet<string> {
  if (categories === undefined || categories.includes("any")) return new Set()
  return new Set(
    categories.filter(isConcreteCategory).map((category) => placeCategoryCodes[category]),
  )
}

function isConcreteCategory(category: PlaceCategory): category is keyof typeof placeCategoryCodes {
  return category !== "any"
}

function matchesCategory(
  categoryCode: string | undefined,
  requestedCodes: ReadonlySet<string>,
): boolean {
  return (
    requestedCodes.size === 0 || (categoryCode !== undefined && requestedCodes.has(categoryCode))
  )
}

function categoryRank(
  categoryCode: string | undefined,
  requestedCodes: ReadonlySet<string>,
): number {
  if (requestedCodes.size === 0) return 0
  return categoryCode !== undefined && requestedCodes.has(categoryCode) ? 0 : 1
}

function radians(value: number): number {
  return (value * Math.PI) / 180
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ")
}
