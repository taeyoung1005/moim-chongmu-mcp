import * as z from "zod/v4"
import type { Coordinates, PlaceCandidate, PlaceCategory, ResolvedOrigin } from "../domain/moim.js"
import { placeCategoryCodes } from "../domain/moim.js"

export type MoimResponse = {
  readonly ok: boolean
  readonly status: number
  readonly body?: ReadableStream<Uint8Array> | null
  text(): Promise<string>
}

export type MoimFetcher = (
  url: string,
  init?: { readonly headers: { readonly Authorization: string }; readonly signal?: AbortSignal },
) => Promise<MoimResponse>

export type KakaoLocalOptions = {
  readonly fetcher?: MoimFetcher | undefined
  readonly timeoutMs?: number | undefined
  readonly maxBytes?: number | undefined
}

export class KakaoLocalError extends Error {
  readonly name = "KakaoLocalError"

  constructor(readonly reason: "timeout" | "http" | "empty" | "malformed" | "oversized") {
    super(reason)
  }
}

const addressDocumentSchema = z.object({
  address_name: z.string().optional(),
  x: z.string(),
  y: z.string(),
})

const addressResponseSchema = z.object({
  documents: z.array(addressDocumentSchema),
})

const placeDocumentSchema = z.object({
  id: z.string().optional(),
  place_name: z.string(),
  address_name: z.string(),
  x: z.string(),
  y: z.string(),
  category_group_code: z.string().optional(),
  place_url: z.string().optional(),
})

const placeResponseSchema = z.object({
  documents: z.array(placeDocumentSchema),
})

export async function resolveKakaoAddress(input: {
  readonly label: string
  readonly address: string
  readonly apiKey: string
  readonly options?: KakaoLocalOptions | undefined
}): Promise<ResolvedOrigin> {
  const url = new URL("https://dapi.kakao.com/v2/local/search/address.json")
  url.searchParams.set("query", input.address)
  url.searchParams.set("size", "1")

  const body = await fetchText(url, input.apiKey, input.options ?? {})
  const parsed = parseAddressResponse(body)
  const first = parsed.documents[0]
  if (first === undefined) throw new KakaoLocalError("empty")
  return {
    label: input.label,
    address: first.address_name ?? input.address,
    coordinates: parseCoordinates(first.x, first.y),
  }
}

export async function searchKakaoCategory(input: {
  readonly midpoint: Coordinates
  readonly category: PlaceCategory
  readonly apiKey: string
  readonly radiusMeters: number
  readonly options?: KakaoLocalOptions | undefined
}): Promise<readonly PlaceCandidate[]> {
  if (input.category === "any") return []
  const url = new URL("https://dapi.kakao.com/v2/local/search/category.json")
  url.searchParams.set("category_group_code", placeCategoryCodes[input.category])
  url.searchParams.set("x", String(input.midpoint.x))
  url.searchParams.set("y", String(input.midpoint.y))
  url.searchParams.set("radius", String(input.radiusMeters))
  url.searchParams.set("sort", "distance")

  const body = await fetchText(url, input.apiKey, input.options ?? {})
  const parsed = parsePlaceResponse(body)
  if (parsed.documents.length === 0) throw new KakaoLocalError("empty")
  return parsed.documents.map((document) => ({
    id: document.id,
    name: document.place_name,
    address: document.address_name,
    ...parseCoordinates(document.x, document.y),
    categoryCode: document.category_group_code,
    placeUrl: document.place_url,
  }))
}

function parseAddressResponse(body: string): z.infer<typeof addressResponseSchema> {
  try {
    const raw: unknown = JSON.parse(body)
    return addressResponseSchema.parse(raw)
  } catch (error) {
    if (error instanceof KakaoLocalError) throw error
    throw new KakaoLocalError("malformed")
  }
}

function parsePlaceResponse(body: string): z.infer<typeof placeResponseSchema> {
  try {
    const raw: unknown = JSON.parse(body)
    return placeResponseSchema.parse(raw)
  } catch (error) {
    if (error instanceof KakaoLocalError) throw error
    throw new KakaoLocalError("malformed")
  }
}

async function fetchText(url: URL, apiKey: string, options: KakaoLocalOptions): Promise<string> {
  const timeoutMs = options.timeoutMs ?? 7000
  const maxBytes = options.maxBytes ?? 300_000
  const fetcher = options.fetcher ?? defaultFetcher
  const controller = new AbortController()
  let timeout: ReturnType<typeof setTimeout> | undefined

  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort()
        reject(new KakaoLocalError("timeout"))
      }, timeoutMs)
    })
    const response = await Promise.race([
      fetcher(url.toString(), {
        headers: { Authorization: `KakaoAK ${apiKey}` },
        signal: controller.signal,
      }),
      timeoutPromise,
    ])
    if (!response.ok) throw new KakaoLocalError("http")
    const text = await readBoundedText(response, maxBytes)
    if (text.trim().length === 0) throw new KakaoLocalError("empty")
    return text
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
  }
}

async function readBoundedText(response: MoimResponse, maxBytes: number): Promise<string> {
  if (response.body === undefined || response.body === null) {
    const text = await response.text()
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw new KakaoLocalError("oversized")
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
        throw new KakaoLocalError("oversized")
      }
      chunks.push(result.value)
    }
  } finally {
    reader.releaseLock()
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

function parseCoordinates(x: string, y: string): Coordinates {
  const coordinates = { x: Number.parseFloat(x), y: Number.parseFloat(y) }
  if (!Number.isFinite(coordinates.x) || !Number.isFinite(coordinates.y)) {
    throw new KakaoLocalError("malformed")
  }
  return coordinates
}

const defaultFetcher: MoimFetcher = (url, init) => fetch(url, init)
