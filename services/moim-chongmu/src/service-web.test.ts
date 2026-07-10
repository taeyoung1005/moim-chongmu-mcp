import { describe, expect, it } from "vitest"
import * as z from "zod/v4"

import { createMoimChongmuService } from "./service.js"

const textContentSchema = z.object({ type: z.literal("text"), text: z.string() })
const toolCallPayloadSchema = z.object({
  result: z
    .object({
      content: z.array(textContentSchema).optional(),
      isError: z.boolean().optional(),
    })
    .optional(),
})

describe("모임좌표 web availability board", () => {
  it("exposes a short board link and accepts slot selection through HTML form", async () => {
    const service = createMoimChongmuService({ publicBaseUrl: "http://moim.test" })
    const created = await callTool(service.fetch, "create_availability_board", {
      title: "주말 저녁",
      dates: ["2026-07-17"],
      timeWindows: [{ start: "18:00", end: "20:00" }],
      participants: ["민지", "태영"],
      slotMinutes: 60,
    })
    const createdText = textFromToolResult(created)
    const boardUrl = extractBoardUrl(createdText)

    expect(boardUrl).toMatch(/^http:\/\/moim\.test\/boards\/[a-z0-9-]+$/)

    const initialPage = await service.fetch(new Request(boardUrl))
    const initialHtml = await initialPage.text()

    expect(initialPage.status).toBe(200)
    expect(initialHtml).toContain("주말 저녁")
    expect(initialHtml).toContain("2026-07-17T18:00")
    expect(initialHtml).toContain("미응답: 민지, 태영")
    expect(initialHtml).toContain("임시 비밀번호")
    expect(initialHtml).toContain("참여자 이름")
    expect(initialHtml).not.toContain("<select")
    expect(initialHtml).not.toContain("<datalist")
    expect(initialHtml).toContain("모든 참여자가 투표하면 결과가 표시됩니다.")
    expect(initialHtml).not.toContain('<div class="availability-matrix"')

    const submitted = await service.fetch(
      new Request(`${boardUrl}/availability`, {
        method: "POST",
        body: new URLSearchParams({
          participant: "민지",
          password: "mint-pass",
          slot: "2026-07-17T18:00",
        }),
      }),
    )

    expect(submitted.status).toBe(303)
    expect(submitted.headers.get("location")).toContain("participant=%EB%AF%BC%EC%A7%80")

    const updatedPage = await service.fetch(new Request(`${boardUrl}?participant=민지&saved=1`))
    const updatedHtml = await updatedPage.text()

    expect(updatedPage.status).toBe(200)
    expect(updatedHtml).toContain("가능 시간이 저장되었습니다.")
    expect(updatedHtml).toContain("남은 사람: 태영")
    expect(updatedHtml).not.toContain('<div class="availability-matrix"')
    expect(updatedHtml).toContain('value="2026-07-17T18:00" checked')

    const rejected = await service.fetch(
      new Request(`${boardUrl}/availability`, {
        method: "POST",
        body: new URLSearchParams({
          participant: "민지",
          password: "wrong-pass",
          slot: "2026-07-17T19:00",
        }),
      }),
    )
    const rejectedHtml = await rejected.text()

    expect(rejected.status).toBe(403)
    expect(rejectedHtml).toContain("임시 비밀번호가 맞지 않습니다")

    const completed = await service.fetch(
      new Request(`${boardUrl}/availability`, {
        method: "POST",
        body: new URLSearchParams([
          ["participant", "태영"],
          ["password", "tae-pass"],
          ["slot", "2026-07-17T18:00"],
          ["slot", "2026-07-17T19:00"],
        ]),
      }),
    )

    expect(completed.status).toBe(303)

    const resultPage = await service.fetch(new Request(`${boardUrl}?saved=1`))
    const resultHtml = await resultPage.text()

    expect(resultHtml).toContain("availability-matrix")
    expect(resultHtml).toContain('class="matrix-cell level-4"')
    expect(resultHtml).toContain('class="matrix-cell level-2"')
    expect(resultHtml).toContain("<strong>2</strong><span>/2</span>")
    expect(resultHtml).toContain("<strong>1</strong><span>/2</span>")
  })
})

async function callTool(
  fetcher: (request: Request) => Response | Promise<Response>,
  name: string,
  args: Readonly<Record<string, unknown>>,
): Promise<z.infer<typeof toolCallPayloadSchema>> {
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
  expect(response.status).toBe(200)
  return toolCallPayloadSchema.parse(await response.json())
}

function textFromToolResult(payload: z.infer<typeof toolCallPayloadSchema>): string {
  return payload.result?.content?.map((item) => item.text).join("\n") ?? ""
}

function extractBoardUrl(text: string): string {
  const matched = /https?:\/\/\S+\/boards\/[a-z0-9-]+/.exec(text)
  if (matched === null) throw new Error("missing board url")
  return matched[0] ?? ""
}
