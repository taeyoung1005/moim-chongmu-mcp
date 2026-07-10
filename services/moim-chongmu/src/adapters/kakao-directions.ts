import * as z from "zod/v4"

import type { Coordinates } from "../domain/moim.js"

export type DrivingRoute = {
  // Road-following polyline as [lng, lat] pairs (Kakao x=lng, y=lat).
  readonly path: readonly (readonly [number, number])[]
  readonly distanceMeters: number
  readonly durationSeconds: number
}

const directionsResponseSchema = z.object({
  routes: z
    .array(
      z.object({
        result_code: z.number().optional(),
        summary: z
          .object({ distance: z.number().optional(), duration: z.number().optional() })
          .optional(),
        sections: z
          .array(
            z.object({ roads: z.array(z.object({ vertexes: z.array(z.number()) })).optional() }),
          )
          .optional(),
      }),
    )
    .optional(),
})

// Kakao Mobility car directions. Best-effort: any failure (no key, http error, timeout,
// malformed) resolves to undefined so the caller falls back to a straight line.
export async function fetchDrivingRoute(input: {
  readonly origin: Coordinates
  readonly destination: Coordinates
  readonly apiKey: string
  readonly timeoutMs?: number | undefined
}): Promise<DrivingRoute | undefined> {
  const { origin, destination, apiKey } = input
  const url = `https://apis-navi.kakaomobility.com/v1/directions?origin=${origin.x},${origin.y}&destination=${destination.x},${destination.y}&priority=RECOMMEND`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 5000)
  try {
    const response = await fetch(url, {
      headers: { Authorization: `KakaoAK ${apiKey}` },
      signal: controller.signal,
    })
    if (!response.ok) return undefined
    const parsed = directionsResponseSchema.safeParse(await response.json())
    if (!parsed.success) return undefined
    const route = parsed.data.routes?.[0]
    if (route === undefined || (route.result_code ?? 0) !== 0) return undefined
    const path: [number, number][] = []
    for (const section of route.sections ?? []) {
      for (const road of section.roads ?? []) {
        for (let index = 0; index + 1 < road.vertexes.length; index += 2) {
          const lng = road.vertexes[index]
          const lat = road.vertexes[index + 1]
          if (lng !== undefined && lat !== undefined) path.push([lng, lat])
        }
      }
    }
    if (path.length < 2) return undefined
    return {
      path,
      distanceMeters: route.summary?.distance ?? 0,
      durationSeconds: route.summary?.duration ?? 0,
    }
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}
