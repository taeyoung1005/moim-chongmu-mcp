import * as z from "zod/v4"

import type { Coordinates } from "../domain/moim.js"

export type OdsayResponse = {
  readonly ok: boolean
  readonly status: number
  readonly body?: ReadableStream<Uint8Array> | null
  text(): Promise<string>
}

export type OdsayFetcher = (
  url: string,
  init?: { readonly signal?: AbortSignal | undefined },
) => Promise<OdsayResponse>

export type OdsayOptions = {
  readonly fetcher?: OdsayFetcher | undefined
  readonly timeoutMs?: number | undefined
  readonly maxBytes?: number | undefined
}

export class OdsayTransitError extends Error {
  readonly name = "OdsayTransitError"

  constructor(readonly reason: "timeout" | "http" | "empty" | "malformed" | "oversized") {
    super(reason)
  }
}

export type OdsayTransitRoute = {
  readonly totalMinutes: number
  readonly paymentWon: number
  readonly totalWalkMeters: number
  readonly transferCount: number
  readonly mapObject: string
}

const routeInfoSchema = z.object({
  totalTime: z.number().finite().nonnegative(),
  payment: z.number().finite().nonnegative().default(0),
  totalWalk: z.number().finite().nonnegative().default(0),
  busTransitCount: z.number().int().nonnegative().default(0),
  subwayTransitCount: z.number().int().nonnegative().default(0),
  mapObj: z.string().min(1),
})

const routeResponseSchema = z.object({
  result: z.object({
    path: z.array(z.object({ info: routeInfoSchema })).min(1),
  }),
})

const laneResponseSchema = z.object({
  result: z.object({
    lane: z.array(
      z.object({
        section: z.array(
          z.object({
            graphPos: z.array(
              z.object({
                x: z.number().finite(),
                y: z.number().finite(),
              }),
            ),
          }),
        ),
      }),
    ),
  }),
})

export async function searchOdsayTransitRoute(input: {
  readonly origin: Coordinates
  readonly destination: Coordinates
  readonly apiKey: string
  readonly options?: OdsayOptions | undefined
}): Promise<OdsayTransitRoute> {
  const url = new URL("https://api.odsay.com/v1/api/searchPubTransPathT")
  url.searchParams.set("SX", String(input.origin.x))
  url.searchParams.set("SY", String(input.origin.y))
  url.searchParams.set("EX", String(input.destination.x))
  url.searchParams.set("EY", String(input.destination.y))
  url.searchParams.set("OPT", "0")
  url.searchParams.set("SearchType", "0")
  url.searchParams.set("apiKey", input.apiKey)
  const parsed = parseRouteResponse(await fetchText(url, input.options ?? {}))
  const route = parsed.result.path[0]
  if (route === undefined) throw new OdsayTransitError("empty")
  return {
    totalMinutes: Math.max(1, Math.round(route.info.totalTime)),
    paymentWon: Math.round(route.info.payment),
    totalWalkMeters: Math.round(route.info.totalWalk),
    transferCount: route.info.busTransitCount + route.info.subwayTransitCount,
    mapObject: route.info.mapObj,
  }
}

export async function loadOdsayTransitPolyline(input: {
  readonly mapObject: string
  readonly apiKey: string
  readonly options?: OdsayOptions | undefined
}): Promise<readonly Coordinates[]> {
  const url = new URL("https://api.odsay.com/v1/api/loadLane")
  url.searchParams.set("mapObject", input.mapObject)
  url.searchParams.set("apiKey", input.apiKey)
  const parsed = parseLaneResponse(await fetchText(url, input.options ?? {}))
  const coordinates = parsed.result.lane.flatMap((lane) =>
    lane.section.flatMap((section) =>
      section.graphPos.map((point) => ({ x: point.x, y: point.y })),
    ),
  )
  if (coordinates.length === 0) throw new OdsayTransitError("empty")
  return coordinates
}

async function fetchText(url: URL, options: OdsayOptions): Promise<string> {
  const timeoutMs = options.timeoutMs ?? 7000
  const maxBytes = options.maxBytes ?? 500_000
  const fetcher = options.fetcher ?? defaultFetcher
  const controller = new AbortController()
  let timeout: ReturnType<typeof setTimeout> | undefined

  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort()
        reject(new OdsayTransitError("timeout"))
      }, timeoutMs)
    })
    const response = await Promise.race([
      fetcher(url.toString(), { signal: controller.signal }),
      timeoutPromise,
    ])
    if (!response.ok) throw new OdsayTransitError("http")
    const text = await readBoundedText(response, maxBytes)
    if (text.trim().length === 0) throw new OdsayTransitError("empty")
    return text
  } catch (error) {
    if (error instanceof OdsayTransitError) throw error
    throw new OdsayTransitError("malformed")
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
  }
}

async function readBoundedText(response: OdsayResponse, maxBytes: number): Promise<string> {
  if (response.body === undefined || response.body === null) {
    const text = await response.text()
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw new OdsayTransitError("oversized")
    }
    return text
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let receivedBytes = 0
  try {
    while (true) {
      const result = await reader.read()
      if (result.done) return decodeChunks(chunks, receivedBytes)
      receivedBytes += result.value.byteLength
      if (receivedBytes > maxBytes) {
        await reader.cancel()
        throw new OdsayTransitError("oversized")
      }
      chunks.push(result.value)
    }
  } finally {
    reader.releaseLock()
  }
}

function parseJson(body: string, reason: "malformed"): unknown {
  try {
    return JSON.parse(body)
  } catch {
    throw new OdsayTransitError(reason)
  }
}

function parseRouteResponse(body: string): z.infer<typeof routeResponseSchema> {
  try {
    return routeResponseSchema.parse(parseJson(body, "malformed"))
  } catch (error) {
    if (error instanceof OdsayTransitError) throw error
    throw new OdsayTransitError("malformed")
  }
}

function parseLaneResponse(body: string): z.infer<typeof laneResponseSchema> {
  try {
    return laneResponseSchema.parse(parseJson(body, "malformed"))
  } catch (error) {
    if (error instanceof OdsayTransitError) throw error
    throw new OdsayTransitError("malformed")
  }
}

function decodeChunks(chunks: readonly Uint8Array[], totalBytes: number): string {
  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

const defaultFetcher: OdsayFetcher = (url, init) =>
  fetch(url, init?.signal === undefined ? undefined : { signal: init.signal })
