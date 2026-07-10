import { describe, expect, it } from "vitest"

import { createMoimChongmuService } from "./service.js"

async function callToolText(
  fetcher: (request: Request) => Response | Promise<Response>,
  name: string,
  args: Readonly<Record<string, unknown>>,
): Promise<string> {
  const response = await fetcher(
    new Request("http://127.0.0.1/mcp", {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    }),
  )
  const payload = (await response.json()) as { result?: { content?: readonly { text?: string }[] } }
  return payload.result?.content?.map((item) => item.text ?? "").join("\n") ?? ""
}

describe("lenient tool inputs (as LLMs actually call them)", () => {
  const service = createMoimChongmuService({ publicBaseUrl: "http://moim.test" })

  it("find_midpoint accepts a plain array of place-name strings", async () => {
    const text = await callToolText(service.fetch, "find_midpoint", {
      origins: ["강남역", "서울역"],
    })
    expect(text).toContain("중간지점")
    expect(text).toContain("/meet/")
    expect(text).not.toContain("계산할 수 없습니다")
  })

  it("recommend_midpoint_places accepts string origins", async () => {
    const text = await callToolText(service.fetch, "recommend_midpoint_places", {
      origins: ["강남역", "서울역"],
      categories: ["cafe"],
    })
    expect(text).toContain("/meet/")
  })

  it("find_midpoint accepts origins with {lat, lng} coordinates", async () => {
    const text = await callToolText(service.fetch, "find_midpoint", {
      origins: [
        { label: "집", coordinates: { lat: 37.5, lng: 127.0 } },
        { label: "회사", coordinates: { lat: 37.55, lng: 127.05 } },
      ],
    })
    expect(text).toContain("/meet/")
    expect(text).not.toContain("계산할 수 없습니다")
  })

  it("find_midpoint accepts flat {lat, lng} origins with no coordinates wrapper", async () => {
    const text = await callToolText(service.fetch, "find_midpoint", {
      origins: [
        { label: "나", lat: 37.5, lng: 127.0 },
        { lat: 37.55, lng: 127.05 },
      ],
    })
    expect(text).toContain("/meet/")
    expect(text).not.toContain("계산할 수 없습니다")
  })

  it("recommend_midpoint_places accepts a midpoint given as {lat, lng}", async () => {
    const text = await callToolText(service.fetch, "recommend_midpoint_places", {
      midpoint: { lat: 37.54, lng: 126.98 },
      categories: ["cafe"],
    })
    expect(text).toContain("장소 후보")
    expect(text).toContain("/meet/")
  })

  it("recommend_midpoint_places blames the coordinate, not origins, on a bad midpoint", async () => {
    const text = await callToolText(service.fetch, "recommend_midpoint_places", {
      midpoint: { foo: 1 },
      categories: ["cafe"],
    })
    expect(text).toContain("중간지점 좌표")
    expect(text).not.toContain("resolved origins")
  })

  it("create_availability_board accepts a 'HH:MM-HH:MM' string time window", async () => {
    const text = await callToolText(service.fetch, "create_availability_board", {
      title: "이번 주말 약속",
      dates: ["2026-07-11", "2026-07-12"],
      timeWindows: ["12:00-20:00"],
      participants: ["민지", "태영"],
      slotMinutes: 60,
    })
    expect(text).toContain("이번 주말 약속")
    expect(text).toContain("슬롯 선택 링크")
    expect(text).toContain("2026-07-11T12:00")
  })

  it("create_availability_board gives a clear error when participants are missing", async () => {
    const text = await callToolText(service.fetch, "create_availability_board", {
      title: "이번 주말 약속",
      dates: ["2026-07-11"],
      timeWindows: ["12:00-20:00"],
      slotMinutes: 60,
    })
    expect(text).toContain("참여자")
  })
})
