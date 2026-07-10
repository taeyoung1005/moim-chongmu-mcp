import { describe, expect, it } from "vitest"
import type { MoimFetcher, MoimResponse } from "./kakao-local.js"
import { loadMoimSources, sourcePolicies } from "./moim-sources.js"

describe("moim-coordinate source adapters", () => {
  it("uses deterministic fixture data and source status without network", async () => {
    let calls = 0
    const snapshot = await loadMoimSources(
      {
        origins: [{ label: "민지", address: "서울역" }],
        midpoint: { x: 126.98, y: 37.54 },
        categories: ["cafe"],
      },
      { MOIM_COORDINATOR_DATA_MODE: "fixture" },
      {
        fetcher: async () => {
          calls += 1
          return response("{}")
        },
      },
    )

    expect(calls).toBe(0)
    expect(snapshot.mode).toBe("fixture")
    expect(snapshot.resolvedOrigins[0]?.coordinates).toEqual({ x: 126.9723, y: 37.5547 })
    expect(snapshot.places.length).toBeGreaterThan(0)
    expect(snapshot.sources).toEqual([
      {
        key: "kakaoLocal",
        label: "Kakao Local address/category search",
        envKey: "KAKAO_REST_API_KEY",
        status: "fixture",
        note: "local fixture data",
      },
    ])
    expect(sourcePolicies.kakaoLocal.envKey).toBe("KAKAO_REST_API_KEY")
  })

  it("filters fixture places by requested category", async () => {
    const snapshot = await loadMoimSources(
      {
        origins: [{ label: "민지", address: "서울역" }],
        midpoint: { x: 126.98, y: 37.54 },
        categories: ["restaurant"],
        limit: 5,
      },
      { MOIM_COORDINATOR_DATA_MODE: "fixture" },
    )

    expect(snapshot.places.map((place) => place.name)).toEqual(["좌표 식당"])
    expect(snapshot.places.every((place) => place.categoryCode === "FD6")).toBe(true)
  })

  it("fetches Kakao Local through an injected live adapter", async () => {
    const requested: string[] = []
    const authHeaders: string[] = []
    const fetcher: MoimFetcher = async (url, init) => {
      requested.push(url)
      authHeaders.push(init?.headers.Authorization ?? "")
      if (url.includes("/v2/local/search/address")) {
        return response(
          JSON.stringify({
            documents: [
              {
                address_name: "서울 중구 세종대로",
                x: "126.9780",
                y: "37.5665",
              },
            ],
          }),
        )
      }
      return response(
        JSON.stringify({
          documents: [
            {
              id: "place-1",
              place_name: "시청 카페",
              address_name: "서울 중구",
              x: "126.9790",
              y: "37.5660",
              category_group_code: "CE7",
              place_url: "https://place.map.kakao.com/1",
            },
          ],
        }),
      )
    }

    const snapshot = await loadMoimSources(
      {
        origins: [{ label: "민지", address: "서울시청" }],
        midpoint: { x: 126.978, y: 37.5665 },
        categories: ["cafe"],
      },
      { MOIM_COORDINATOR_DATA_MODE: "live", KAKAO_REST_API_KEY: "valid-kakao-secret" },
      { fetcher },
    )

    expect(requested.some((url) => url.includes("/v2/local/search/address.json"))).toBe(true)
    expect(requested.some((url) => url.includes("/v2/local/search/category.json"))).toBe(true)
    expect(authHeaders.every((header) => header === "KakaoAK valid-kakao-secret")).toBe(true)
    expect(snapshot.resolvedOrigins[0]?.coordinates).toEqual({ x: 126.978, y: 37.5665 })
    expect(snapshot.places[0]?.name).toBe("시청 카페")
    expect(snapshot.sources[0]?.status).toBe("live-ready")
  })

  it("falls back safely when key is unavailable", async () => {
    const snapshot = await loadMoimSources(
      {
        origins: [{ label: "민지", address: "서울역" }],
        midpoint: { x: 126.98, y: 37.54 },
        categories: ["restaurant"],
      },
      { MOIM_COORDINATOR_DATA_MODE: "live", KAKAO_REST_API_KEY: "bad" },
    )

    expect(snapshot.mode).toBe("live")
    expect(snapshot.resolvedOrigins.length).toBeGreaterThan(0)
    expect(snapshot.sources[0]?.status).toBe("unavailable")
    expect(snapshot.sources[0]?.note).toContain("fixture fallback")
  })

  it("handles timeout, http, empty, malformed, and oversized upstreams without leaking details", async () => {
    const cases: ReadonlyArray<{
      readonly name: string
      readonly fetcher: MoimFetcher
      readonly note: string
      readonly maxBytes?: number
      readonly timeoutMs?: number
    }> = [
      {
        name: "timeout",
        fetcher: () => new Promise<MoimResponse>(() => undefined),
        note: "timeout",
        timeoutMs: 1,
      },
      {
        name: "http",
        fetcher: async () => response("secret https://kakao.example/raw", 500),
        note: "upstream http error",
      },
      { name: "empty", fetcher: async () => response(""), note: "empty result" },
      { name: "malformed", fetcher: async () => response("{bad"), note: "malformed upstream" },
      {
        name: "oversized",
        fetcher: async () => response("x".repeat(40)),
        note: "oversized upstream",
        maxBytes: 10,
      },
    ]

    for (const edgeCase of cases) {
      const snapshot = await loadMoimSources(
        {
          origins: [{ label: "민지", address: "서울역" }],
          midpoint: { x: 126.98, y: 37.54 },
          categories: ["cafe"],
        },
        {
          MOIM_COORDINATOR_DATA_MODE: "live",
          MOIM_COORDINATOR_LIVE_TIMEOUT_MS: edgeCase.name === "timeout" ? "1" : "7000",
          KAKAO_REST_API_KEY: "valid-kakao-secret",
        },
        {
          fetcher: edgeCase.fetcher,
          maxBytes: edgeCase.maxBytes,
          timeoutMs: edgeCase.timeoutMs,
        },
      )
      const note = snapshot.sources.map((source) => source.note).join(" ")

      expect(snapshot.sources[0]?.status).toBe("unavailable")
      expect(note).toContain(edgeCase.note)
      expect(note).not.toContain("valid-kakao-secret")
      expect(note).not.toContain("kakao.example")
      expect(note).not.toContain("/raw")
    }
  })

  it("stops reading live upstream streams once the byte cap is exceeded", async () => {
    const fetcher: MoimFetcher = async () => ({
      ok: true,
      status: 200,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("0123456789"))
          controller.enqueue(new TextEncoder().encode("overflow"))
          controller.close()
        },
      }),
      text: async () => {
        throw new Error("streaming response must not use full text buffering")
      },
    })

    const snapshot = await loadMoimSources(
      {
        origins: [{ label: "민지", address: "서울역" }],
        midpoint: { x: 126.98, y: 37.54 },
        categories: ["cafe"],
      },
      { MOIM_COORDINATOR_DATA_MODE: "live", KAKAO_REST_API_KEY: "valid-kakao-secret" },
      { fetcher, maxBytes: 10 },
    )

    expect(snapshot.sources[0]?.status).toBe("unavailable")
    expect(snapshot.sources[0]?.note).toContain("oversized upstream")
  })

  it("treats non-finite live place coordinates as malformed upstream", async () => {
    const fetcher: MoimFetcher = async (url) => {
      if (url.includes("/v2/local/search/address")) {
        return response(
          JSON.stringify({
            documents: [{ address_name: "서울역", x: "126.9723", y: "37.5547" }],
          }),
        )
      }
      return response(
        JSON.stringify({
          documents: [
            {
              id: "bad-coordinate",
              place_name: "깨진 장소",
              address_name: "서울 중구",
              x: "not-number",
              y: "37.54",
              category_group_code: "CE7",
            },
          ],
        }),
      )
    }

    const snapshot = await loadMoimSources(
      {
        origins: [{ label: "민지", address: "서울역" }],
        midpoint: { x: 126.98, y: 37.54 },
        categories: ["cafe"],
      },
      { MOIM_COORDINATOR_DATA_MODE: "live", KAKAO_REST_API_KEY: "valid-kakao-secret" },
      { fetcher },
    )

    expect(snapshot.sources[0]?.status).toBe("unavailable")
    expect(snapshot.sources[0]?.note).toContain("malformed upstream")
    expect(snapshot.places.every((place) => Number.isFinite(place.distanceMeters))).toBe(true)
  })
})

function response(body: string, status = 200): MoimResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  }
}
