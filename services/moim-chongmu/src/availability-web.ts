import type { AvailabilityBoardStore } from "./availability-board-store.js"
import type { AvailabilityBoard, AvailabilitySlot } from "./domain/moim.js"
import {
  markAvailability,
  summarizeBestTimes,
  validateAvailabilityBoardState,
} from "./domain/moim.js"

export async function handleAvailabilityBoardWebRequest(
  request: Request,
  store: AvailabilityBoardStore,
): Promise<Response | undefined> {
  const url = new URL(request.url)
  if (!url.pathname.startsWith("/boards")) return undefined
  const route = boardRoute(url.pathname)
  if (route === undefined) return htmlResponse(renderMessage("투표판을 찾을 수 없습니다."), 404)
  if (request.method === "GET" && route.action === "view") return renderBoard(route.id, url, store)
  if (request.method === "POST" && route.action === "availability") {
    return submitAvailability(route.id, request, store)
  }
  return htmlResponse(renderMessage("지원하지 않는 요청입니다."), 405)
}

function renderBoard(id: string, url: URL, store: AvailabilityBoardStore): Response {
  const stored = store.find(id)
  if (stored === undefined)
    return htmlResponse(renderMessage("투표판이 만료되었거나 없습니다."), 404)
  const validation = validateAvailabilityBoardState(stored.board)
  if (!validation.ok) return htmlResponse(renderMessage("투표판 상태를 읽을 수 없습니다."), 409)
  return htmlResponse(
    page(stored.board, {
      id,
      participant: url.searchParams.get("participant") ?? "",
      saved: url.searchParams.get("saved") === "1",
    }),
    200,
  )
}

async function submitAvailability(
  id: string,
  request: Request,
  store: AvailabilityBoardStore,
): Promise<Response> {
  const stored = store.find(id)
  if (stored === undefined)
    return htmlResponse(renderMessage("투표판이 만료되었거나 없습니다."), 404)
  const form = await request.formData()
  const participant = stringField(form, "participant")
  const password = stringField(form, "password")
  const note = stringField(form, "note")
  const availableSlotIds = form.getAll("slot").filter((value) => typeof value === "string")
  if (!stored.board.participants.includes(participant)) {
    return htmlResponse(
      page(stored.board, { id, participant, error: "참여자를 확인해 주세요." }),
      400,
    )
  }
  const passwordResult = store.verifyParticipantPassword(id, participant, password)
  if (!passwordResult.ok) {
    return htmlResponse(
      page(stored.board, { id, participant, error: passwordErrorMessage(passwordResult.reason) }),
      403,
    )
  }
  const result = markAvailability({
    state: stored.board,
    participant,
    availableSlotIds,
    expectedStateHash: stored.board.stateHash,
    ...(note.length === 0 ? {} : { note }),
  })
  if (!result.ok)
    return htmlResponse(page(stored.board, { id, participant, error: result.error.message }), 400)
  store.update(id, result.value)
  return redirect(
    `/boards/${encodeURIComponent(id)}?participant=${encodeURIComponent(participant)}&saved=1`,
  )
}

function page(
  board: AvailabilityBoard,
  view: {
    readonly id: string
    readonly participant: string
    readonly saved?: boolean | undefined
    readonly error?: string | undefined
  },
): string {
  const summary = summarizeBestTimes(board, { limit: 3 })
  const selected = new Set(board.responses[view.participant]?.availableSlotIds ?? [])
  return layout(
    board.title,
    [
      `<header class="header"><p class="eyebrow">모임좌표</p><h1>${escapeHtml(board.title)}</h1><p>${escapeHtml(board.note ?? "가능한 시간을 선택해 주세요.")}</p></header>`,
      statusLine(view, summary.missingRespondents),
      resultPanel(board, summary.missingRespondents),
      `<form class="panel" method="post" action="/boards/${encodeURIComponent(view.id)}/availability">`,
      participantField(view.participant),
      passwordField(),
      `<div class="grid">${board.dates.map((date) => dayColumn(date, board.slots, selected)).join("")}</div>`,
      `<label class="note"><span>메모</span><input name="note" maxlength="400" placeholder="늦게 도착, 선호 시간 등"></label>`,
      `<button class="submit" type="submit">가능 시간 저장</button>`,
      "</form>",
    ].join(""),
  )
}

function passwordField(): string {
  return [
    `<label class="field"><span>임시 비밀번호</span><input name="password" type="password" minlength="1" maxlength="80" autocomplete="current-password" required></label>`,
    `<p class="hint">처음 저장할 때 이 이름의 임시 비밀번호가 등록되고, 다음 수정부터 같은 비밀번호가 필요합니다.</p>`,
  ].join("")
}

function participantField(selected: string): string {
  return `<label class="field"><span>참여자 이름</span><input name="participant" type="text" maxlength="40" autocomplete="off" value="${escapeHtml(selected)}" placeholder="이름을 입력하세요" required></label>`
}

function dayColumn(
  date: string,
  slots: readonly AvailabilitySlot[],
  selected: ReadonlySet<string>,
): string {
  const rows = slots
    .filter((slot) => slot.date === date)
    .map((slot) => {
      const checked = selected.has(slot.id) ? " checked" : ""
      return `<label class="slot"><input type="checkbox" name="slot" value="${escapeHtml(slot.id)}"${checked}><span>${escapeHtml(slot.time)}</span></label>`
    })
    .join("")
  return `<section class="day"><h2>${escapeHtml(date)}</h2>${rows}</section>`
}

function statusLine(
  view: { readonly saved?: boolean | undefined; readonly error?: string | undefined },
  missingRespondents: readonly string[],
): string {
  if (view.error !== undefined) return `<p class="alert error">${escapeHtml(view.error)}</p>`
  if (view.saved === true) return `<p class="alert success">가능 시간이 저장되었습니다.</p>`
  return `<p class="alert">미응답: ${escapeHtml(missingRespondents.join(", ") || "없음")}</p>`
}

function resultPanel(board: AvailabilityBoard, missingRespondents: readonly string[]): string {
  if (missingRespondents.length > 0) {
    return [
      `<section class="panel compact result-locked"><h2>현재 많이 겹치는 시간</h2>`,
      `<p>모든 참여자가 투표하면 결과가 표시됩니다.</p>`,
      `<p class="muted">남은 사람: ${escapeHtml(missingRespondents.join(", "))}</p>`,
      "</section>",
    ].join("")
  }
  return `<section class="panel compact"><h2>현재 많이 겹치는 시간</h2>${overlapHeatmap(board)}</section>`
}

function passwordErrorMessage(
  reason: "missing_board" | "empty_password" | "invalid_password",
): string {
  switch (reason) {
    case "missing_board":
      return "투표판이 만료되었거나 없습니다."
    case "empty_password":
      return "임시 비밀번호를 입력해 주세요."
    case "invalid_password":
      return "임시 비밀번호가 맞지 않습니다. 본인 이름으로 처음 저장한 비밀번호를 입력해 주세요."
    default:
      return assertNever(reason)
  }
}

function overlapHeatmap(board: AvailabilityBoard): string {
  const counts = slotCounts(board)
  return board.dates.map((date) => heatmapDay(date, board, counts)).join("")
}

function heatmapDay(
  date: string,
  board: AvailabilityBoard,
  counts: ReadonlyMap<string, number>,
): string {
  const rows = board.slots
    .filter((slot) => slot.date === date)
    .map((slot) => {
      const count = counts.get(slot.id) ?? 0
      const percent =
        board.participants.length === 0 ? 0 : Math.round((count / board.participants.length) * 100)
      return `<div class="heat-row"><span>${escapeHtml(slot.time)}</span><div class="heat-track"><div class="heat-fill" style="--heat:${percent}%"></div></div><strong>${count}/${board.participants.length}</strong></div>`
    })
    .join("")
  return `<section class="heat-day"><h3>${escapeHtml(date)}</h3>${rows}</section>`
}

function slotCounts(board: AvailabilityBoard): ReadonlyMap<string, number> {
  const counts = new Map<string, number>(board.slots.map((slot) => [slot.id, 0]))
  for (const response of Object.values(board.responses)) {
    for (const slotId of response.availableSlotIds) {
      counts.set(slotId, (counts.get(slotId) ?? 0) + 1)
    }
  }
  return counts
}

function layout(title: string, body: string): string {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>${styles()}</style></head><body><main>${body}</main></body></html>`
}

function renderMessage(message: string): string {
  return layout(
    "모임좌표",
    `<section class="panel"><h1>모임좌표</h1><p>${escapeHtml(message)}</p></section>`,
  )
}

function styles(): string {
  return `:root{color-scheme:light;--bg:#f7f8f5;--panel:#ffffff;--panel-soft:#fbfcfa;--ink:#17201c;--muted:#66746c;--line:#dfe6df;--accent:#13795b;--accent-strong:#0d5d46;--accent-soft:#eef5ef;--ok:#e8f6ef;--bad:#fff0ee;--bad-text:#a33a2d;--neutral:#eef2ee;--on-accent:#ffffff;--content-max:920px;--slot-column-min:160px;--control-height:44px;--submit-height:48px;--slot-height:38px;--checkbox-size:18px;--heat-label-width:48px;--heat-count-width:40px;--space-0:0;--space-1:4px;--space-1-5:6px;--space-2:8px;--space-2-5:10px;--space-3:12px;--space-3-5:14px;--space-4:16px;--space-4-5:18px;--space-5:20px;--space-5-5:22px;--space-8:32px;--space-9:36px;--space-12:48px;--radius-control:6px;--radius-panel:8px;--text-eyebrow:12px;--text-label:13px;--text-day:15px;--text-body:16px;--text-h1:32px;--text-h1-mobile:26px;--line-heading:1.2;--weight-bold:700;--weight-heavy:800;--motion-fast:120ms}*{box-sizing:border-box}body{margin:var(--space-0);background:var(--bg);color:var(--ink);font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{width:min(100% - var(--space-8),var(--content-max));margin:var(--space-0) auto;padding:var(--space-8) var(--space-0) var(--space-12)}.header{padding:var(--space-2) var(--space-0) var(--space-5)}.eyebrow{margin:var(--space-0) var(--space-0) var(--space-2);color:var(--accent);font-size:var(--text-eyebrow);font-weight:var(--weight-bold)}.header h1{margin:var(--space-0);font-size:var(--text-h1);line-height:var(--line-heading)}.header p,.muted{color:var(--muted)}.panel{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius-panel);padding:var(--space-5);margin-top:var(--space-4)}.compact{padding:var(--space-4)}.field,.note{display:grid;gap:var(--space-2);margin-bottom:var(--space-4)}.field span,.note span{font-size:var(--text-label);font-weight:var(--weight-bold);color:var(--muted)}.hint{margin:calc(-1 * var(--space-2)) var(--space-0) var(--space-4);color:var(--muted);font-size:var(--text-label)}select,input{width:100%;min-height:var(--control-height);border:1px solid var(--line);border-radius:var(--radius-control);padding:var(--space-0) var(--space-3);font:inherit}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(var(--slot-column-min),1fr));gap:var(--space-3)}.day{border:1px solid var(--line);border-radius:var(--radius-panel);padding:var(--space-3);background:var(--panel-soft)}.day h2,.heat-day h3{margin:var(--space-0) var(--space-0) var(--space-2-5);font-size:var(--text-day)}.slot{display:flex;align-items:center;gap:var(--space-2);min-height:var(--slot-height);padding:var(--space-1-5) var(--space-2);border-radius:var(--radius-control);transition:background-color var(--motion-fast) ease-out}.slot:hover{background:var(--accent-soft)}.slot input{width:var(--checkbox-size);min-height:var(--checkbox-size);accent-color:var(--accent)}.submit{width:100%;min-height:var(--submit-height);margin-top:var(--space-4-5);border:0;border-radius:var(--radius-control);background:var(--accent);color:var(--on-accent);font:inherit;font-weight:var(--weight-heavy);transition:background-color var(--motion-fast) ease-out}.submit:hover{background:var(--accent-strong)}.alert{margin:var(--space-0);padding:var(--space-3) var(--space-3-5);border-radius:var(--radius-panel);background:var(--neutral);color:var(--muted)}.success{background:var(--ok);color:var(--accent-strong)}.error{background:var(--bad);color:var(--bad-text)}.heat-day{margin-top:var(--space-3)}.heat-row{display:grid;grid-template-columns:var(--heat-label-width) 1fr var(--heat-count-width);align-items:center;gap:var(--space-2);margin:var(--space-2) var(--space-0)}.heat-track{height:var(--space-3);border-radius:var(--radius-control);background:var(--neutral);overflow:hidden}.heat-fill{width:var(--heat);height:100%;border-radius:var(--radius-control);background:var(--accent)}.heat-row strong{text-align:right}@media (max-width:520px){main{width:min(100% - var(--space-5),var(--content-max));padding:var(--space-5) var(--space-0) var(--space-9)}.header h1{font-size:var(--text-h1-mobile)}.panel{padding:var(--space-3-5)}.grid{grid-template-columns:1fr}}`
}

function assertNever(value: never): never {
  throw new Error(`unexpected password error: ${value}`)
}

function boardRoute(
  pathname: string,
): { readonly id: string; readonly action: "view" | "availability" } | undefined {
  const [, root, id, action] = pathname.split("/")
  if (root !== "boards" || id === undefined || id.length === 0) return undefined
  if (action === undefined || action.length === 0) return { id, action: "view" }
  return action === "availability" ? { id, action: "availability" } : undefined
}

function stringField(form: FormData, key: string): string {
  const value = form.get(key)
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : ""
}

function htmlResponse(html: string, status: number): Response {
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  })
}

function redirect(location: string): Response {
  return new Response(null, { status: 303, headers: { location } })
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}
