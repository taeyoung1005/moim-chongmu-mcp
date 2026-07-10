import type {
  MeetPlanFairness,
  MeetPlanOrigin,
  MeetPlanPlace,
  MeetPlanStore,
  StoredMeetPlan,
} from "./meet-plan-store.js"
import { meetInteractionScript } from "./meet-web-script.js"

export async function handleMeetWebRequest(
  request: Request,
  store: MeetPlanStore,
  kakaoMapJsKey?: string | undefined,
): Promise<Response | undefined> {
  const url = new URL(request.url)
  if (!url.pathname.startsWith("/meet")) return undefined
  const id = meetRoute(url.pathname)
  if (id === undefined) return htmlResponse(renderMessage("잘못된 주소입니다."), 404)
  if (request.method !== "GET") return htmlResponse(renderMessage("지원하지 않는 요청입니다."), 405)
  const plan = store.find(id)
  if (plan === undefined)
    return htmlResponse(renderMessage("중간장소 결과가 만료되었거나 없습니다."), 404)
  return htmlResponse(page(plan, kakaoMapJsKey), 200)
}

function meetRoute(pathname: string): string | undefined {
  const [, root, id] = pathname.split("/")
  if (root !== "meet" || id === undefined || id.length === 0) return undefined
  return id
}

function page(plan: StoredMeetPlan, kakaoMapJsKey: string | undefined): string {
  const hasMap = typeof kakaoMapJsKey === "string" && kakaoMapJsKey.trim().length > 0
  const body = [
    `<header class="header"><p class="eyebrow">모임좌표</p><h1>다 같이 만나기 좋은 곳</h1><p>출발지들의 중간지점과 만날 장소 후보예요.</p></header>`,
    hasMap ? `<div id="map" class="map" role="img" aria-label="중간지점 지도"></div>` : "",
    resultPanel(plan),
    `<button class="share" type="button" data-share>공유하기</button>`,
  ].join("")
  return document(
    "모임좌표 중간장소",
    body,
    plan,
    hasMap ? (kakaoMapJsKey as string).trim() : undefined,
  )
}

function resultPanel(plan: StoredMeetPlan): string {
  return [
    `<section class="panel">`,
    `<h2>중간지점</h2>`,
    `<p class="coord">좌표 ${escapeHtml(String(plan.midpoint.x))}, ${escapeHtml(String(plan.midpoint.y))}</p>`,
    fairnessBlock(plan.fairness, plan.origins),
    `</section>`,
    placePanel(plan.places),
    `<p class="source">데이터: ${plan.mode === "live" ? "실시간" : "샘플(fixture)"} · ${escapeHtml(plan.sourceNote)}</p>`,
  ].join("")
}

// One colour per origin — kept in sync with the map polylines/pins in meet-web-script.ts.
const ORIGIN_COLORS = [
  "#2563eb",
  "#dc2626",
  "#7c3aed",
  "#d97706",
  "#0891b2",
  "#db2777",
  "#4f46e5",
  "#65a30d",
] as const

function originColor(index: number): string {
  return ORIGIN_COLORS[index % ORIGIN_COLORS.length] ?? "#2563eb"
}

function fairnessBlock(
  fairness: readonly MeetPlanFairness[],
  origins: readonly MeetPlanOrigin[],
): string {
  if (fairness.length === 0) return ""
  const maxDist = Math.max(1, ...fairness.map((row) => row.distanceMeters))
  const maxTime = Math.max(1, ...origins.map((origin) => origin.route?.durationSeconds ?? 0))
  return [
    `<div class="fairness">`,
    ...fairness.map((row, index) => {
      const route = origins[index]?.route
      // With driving routes, the bar reflects real travel time; otherwise straight-line distance.
      const pct = route
        ? Math.max(6, Math.round((route.durationSeconds / maxTime) * 100))
        : Math.max(6, Math.round((row.distanceMeters / maxDist) * 100))
      const color = originColor(index)
      const value = route
        ? `약 ${formatMinutes(route.durationSeconds)} · ${formatMeters(route.distanceMeters)}`
        : formatMeters(row.distanceMeters)
      return [
        `<div class="fair-row">`,
        `<span class="fair-badge" style="background:${color}">${index + 1}</span>`,
        `<span class="fair-label">${escapeHtml(row.originLabel)}</span>`,
        `<span class="fair-track"><span class="fair-fill" style="width:${pct}%;background:${color}"></span></span>`,
        `<span class="fair-dist">${value}</span>`,
        `</div>`,
      ].join("")
    }),
    `</div>`,
  ].join("")
}

function placePanel(places: readonly MeetPlanPlace[]): string {
  if (places.length === 0) {
    return `<section class="panel compact"><h2>장소 후보</h2><p class="muted">"중간장소 추천"으로 주변 카페·식당 후보를 볼 수 있어요.</p></section>`
  }
  return [
    `<section class="panel compact"><h2>장소 후보</h2>`,
    `<ul class="places">`,
    ...places.map((place) => placeCard(place)),
    `</ul>`,
    `</section>`,
  ].join("")
}

function placeCard(place: MeetPlanPlace): string {
  const category = categoryLabel(place.categoryCode)
  const name = place.placeUrl
    ? `<a class="place-name" href="${escapeHtml(place.placeUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(place.name)}</a>`
    : `<span class="place-name">${escapeHtml(place.name)}</span>`
  return [
    `<li class="place">`,
    `<div class="place-head">${name}${category === undefined ? "" : `<span class="chip">${escapeHtml(category)}</span>`}</div>`,
    `<p class="place-addr">${escapeHtml(place.address)}</p>`,
    `<p class="place-dist">중간지점에서 약 ${formatMeters(place.distanceMeters)}</p>`,
    `</li>`,
  ].join("")
}

function categoryLabel(code: string | undefined): string | undefined {
  switch (code) {
    case "CE7":
      return "카페"
    case "FD6":
      return "음식점"
    case "SW8":
      return "지하철"
    case "CT1":
      return "문화시설"
    case "AT4":
      return "관광명소"
    case "PK6":
      return "주차장"
    default:
      return undefined
  }
}

function formatMeters(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)}km`
  return `${meters.toLocaleString("ko-KR")}m`
}

function formatMinutes(seconds: number): string {
  return `${Math.max(1, Math.round(seconds / 60))}분`
}

function document(
  title: string,
  body: string,
  plan: StoredMeetPlan,
  kakaoMapJsKey: string | undefined,
): string {
  const sdk =
    kakaoMapJsKey === undefined
      ? ""
      : `<script src="//dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(kakaoMapJsKey)}&autoload=false"></script>`
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>${styles()}</style></head><body><main>${body}</main>${meetData(plan)}${sdk}${meetInteractionScript()}</body></html>`
}

function meetData(plan: StoredMeetPlan): string {
  const payload = {
    midpoint: plan.midpoint,
    origins: plan.origins.map((origin: MeetPlanOrigin) => ({
      label: origin.label,
      x: origin.x,
      y: origin.y,
      // Road-following route as [lng, lat] pairs when available (Kakao Mobility); else omitted.
      route: origin.route === undefined ? undefined : origin.route.path,
    })),
    places: plan.places.map((place) => ({ name: place.name, x: place.x, y: place.y })),
  }
  return `<script>window.__MEET__=${jsonForScript(payload)}</script>`
}

function jsonForScript(value: unknown): string {
  // Escape "<" so an embedded "</script>" cannot break out of the inline script tag.
  return JSON.stringify(value).replaceAll("<", "\\u003c")
}

function renderMessage(message: string): string {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>모임좌표</title><style>${styles()}</style></head><body><main><section class="panel"><h1>모임좌표</h1><p>${escapeHtml(message)}</p></section></main></body></html>`
}

function styles(): string {
  return `:root{color-scheme:light;--bg:#f7f8f5;--panel:#ffffff;--panel-soft:#fbfcfa;--ink:#17201c;--muted:#66746c;--line:#e6ece6;--accent:#13795b;--accent-strong:#0d5d46;--accent-soft:#eef5ef;--on-accent:#ffffff;--place:#e08a2b;--radius-control:12px;--radius-panel:16px;--radius-pill:999px;--shadow-soft:0 1px 2px rgba(23,32,28,.05),0 10px 28px rgba(23,32,28,.06);--shadow-btn:0 8px 20px rgba(19,121,91,.22);--space-2:8px;--space-2-5:10px;--space-3:12px;--space-3-5:14px;--space-4:16px;--space-5:20px;--space-6:24px;--space-8:32px;--space-12:48px}*{box-sizing:border-box}html{width:100%;max-width:100%;overflow-x:hidden}body{width:100%;max-width:100%;overflow-x:hidden;margin:0;background:var(--bg);color:var(--ink);font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{width:min(100% - var(--space-8),620px);margin:0 auto;padding:var(--space-8) 0 var(--space-12)}.header{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius-panel);box-shadow:var(--shadow-soft);padding:var(--space-6)}.eyebrow{margin:0 0 var(--space-2);color:var(--accent);font-size:12px;font-weight:700;letter-spacing:.04em}.header h1{margin:0;font-size:26px;line-height:1.2}.header p{margin:var(--space-2-5) 0 0;color:var(--muted)}.muted{color:var(--muted)}.map{height:340px;margin-top:var(--space-4);border:1px solid var(--line);border-radius:var(--radius-panel);box-shadow:var(--shadow-soft);background:var(--panel-soft);overflow:hidden}.panel{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius-panel);box-shadow:var(--shadow-soft);padding:var(--space-5);margin-top:var(--space-4)}.compact{padding:var(--space-4) var(--space-5)}.panel h2{margin:0 0 var(--space-3);font-size:15px;font-weight:700}.coord{margin:0;color:var(--muted);font-size:13px}.fairness{display:grid;gap:var(--space-2-5);margin-top:var(--space-4)}.fair-row{display:grid;grid-template-columns:auto auto 1fr auto;align-items:center;gap:var(--space-2-5)}.fair-badge{display:grid;place-items:center;width:22px;height:22px;border-radius:50%;background:var(--accent);color:var(--on-accent);font-size:12px;font-weight:800}.fair-label{font-size:14px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:8em}.fair-track{height:8px;border-radius:var(--radius-pill);background:var(--accent-soft);overflow:hidden}.fair-fill{display:block;height:100%;border-radius:var(--radius-pill);background:var(--accent)}.fair-dist{font-size:13px;font-weight:700;color:var(--accent-strong);white-space:nowrap}.places{list-style:none;margin:0;padding:0;display:grid;gap:var(--space-2-5)}.place{border:1px solid var(--line);border-radius:var(--radius-control);padding:var(--space-3) var(--space-3-5);background:var(--panel-soft)}.place-head{display:flex;align-items:center;gap:var(--space-2);flex-wrap:wrap}.place-name{font-size:15px;font-weight:700;color:var(--ink);text-decoration:none}a.place-name{color:var(--accent-strong);text-decoration:underline;text-underline-offset:2px}.chip{font-size:11px;font-weight:700;color:var(--accent-strong);background:var(--accent-soft);border-radius:var(--radius-pill);padding:2px 8px}.place-addr{margin:var(--space-2) 0 0;font-size:13px;color:var(--muted)}.place-dist{margin:2px 0 0;font-size:12px;color:var(--muted)}.source{margin:var(--space-3) 0 0;font-size:12px;color:var(--muted)}.share{width:100%;min-height:52px;margin-top:var(--space-5);border:0;border-radius:var(--radius-pill);background:var(--accent);color:var(--on-accent);font:inherit;font-size:16px;font-weight:800;box-shadow:var(--shadow-btn);cursor:pointer;transition:background-color 120ms ease-out}.share:hover{background:var(--accent-strong)}.share.copied{background:var(--accent-strong)}.pin{position:relative;display:grid;place-items:center;min-width:26px;height:26px;padding:0 7px;border-radius:var(--radius-pill);font-size:12px;font-weight:800;color:var(--on-accent);box-shadow:0 2px 6px rgba(23,32,28,.35)}.pin::after{content:"";position:absolute;bottom:-5px;left:50%;transform:translateX(-50%);border:5px solid transparent}.pin-origin{background:var(--pin-color,var(--accent))}.pin-origin::after{border-top-color:var(--pin-color,var(--accent))}.pin-mid{background:var(--accent-strong)}.pin-mid::after{border-top-color:var(--accent-strong)}.pin-place{min-width:14px;width:14px;height:14px;padding:0;background:var(--place)}.pin-place::after{border-top-color:var(--place)}@media (max-width:640px){main{width:min(100% - var(--space-5),620px);padding:var(--space-5) 0 var(--space-8)}.header{padding:var(--space-5)}.map{height:300px}}`
}

function htmlResponse(html: string, status: number): Response {
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  })
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}
