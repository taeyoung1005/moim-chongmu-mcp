import { describe, expect, it } from "vitest"

import { createMoimChongmuService } from "./service.js"

const origins = [
  { label: "서울역", coordinates: { x: 126.9723, y: 37.5547 } },
  { label: "강남", coordinates: { x: 127.0276, y: 37.4979 } },
]

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
  const payload = (await response.json()) as {
    result?: { content?: readonly { text?: string }[] }
  }
  return payload.result?.content?.map((item) => item.text ?? "").join("\n") ?? ""
}

function extractMeetUrl(text: string): string {
  const matched = /http:\/\/moim\.test\/meet\/[0-9a-f-]+/.exec(text)
  if (matched === null) throw new Error(`missing meet url in: ${text}`)
  return matched[0]
}

describe("모임좌표 meet result page", () => {
  it("recommend_midpoint_places returns a /meet link and renders a fallback result page", async () => {
    const service = createMoimChongmuService({ publicBaseUrl: "http://moim.test" })
    const text = await callToolText(service.fetch, "recommend_midpoint_places", {
      origins,
      categories: ["cafe", "restaurant"],
      limit: 5,
    })
    const meetUrl = extractMeetUrl(text)
    expect(meetUrl).toMatch(/^http:\/\/moim\.test\/meet\/[0-9a-f-]+$/)

    const page = await service.fetch(new Request(meetUrl))
    const html = await page.text()
    expect(page.status).toBe(200)
    expect(html).toContain("중간지점")
    expect(html).toContain("장소 후보")
    expect(html).toContain("서울역")
    // Fallback: no Kakao map SDK is loaded without a JS key, but the static result still renders.
    expect(html).not.toContain("dapi.kakao.com")
  })

  it("find_midpoint returns a /meet link", async () => {
    const service = createMoimChongmuService({ publicBaseUrl: "http://moim.test" })
    const text = await callToolText(service.fetch, "find_midpoint", { origins })
    expect(text).toContain("/meet/")
  })

  it("renders the Kakao map when KAKAO_MAP_JS_KEY is set", async () => {
    const service = createMoimChongmuService({
      publicBaseUrl: "http://moim.test",
      kakaoMapJsKey: "test-js-key",
    })
    const text = await callToolText(service.fetch, "recommend_midpoint_places", {
      origins,
      categories: ["cafe"],
      limit: 3,
    })
    const html = await (await service.fetch(new Request(extractMeetUrl(text)))).text()
    expect(html).toContain("dapi.kakao.com/v2/maps/sdk.js")
    expect(html).toContain("appkey=test-js-key")
    expect(html).toContain("window.__MEET__")
    expect(html).toContain('id="map"')
  })

  it("returns 404 for an unknown meet id", async () => {
    const service = createMoimChongmuService({ publicBaseUrl: "http://moim.test" })
    const res = await service.fetch(
      new Request("http://moim.test/meet/00000000-0000-0000-0000-000000000000"),
    )
    expect(res.status).toBe(404)
  })
})
