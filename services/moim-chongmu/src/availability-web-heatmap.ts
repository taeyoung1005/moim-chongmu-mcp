import type { AvailabilityBoard, AvailabilitySlot } from "./domain/moim.js"

export function overlapAvailabilityGrid(board: AvailabilityBoard): string {
  const counts = slotCounts(board)
  const times = uniqueTimes(board.slots)
  const bestSlots = board.slots
    .map((slot) => ({ slot, count: counts.get(slot.id)?.count ?? 0 }))
    .sort((left, right) => right.count - left.count || left.slot.id.localeCompare(right.slot.id))
    .slice(0, 3)
  return [
    `<div class="result-head">${bestSlots.map((item, index) => bestSlotChip(item.slot, item.count, board.participants.length, index)).join("")}</div>`,
    `<div class="availability-matrix" style="--date-count:${board.dates.length}">`,
    `<div class="matrix-corner">시간</div>`,
    board.dates.map(dateHeader).join(""),
    times.map((time) => timeRow(time, board, counts)).join(""),
    "</div>",
    `<div class="legend"><span>적음</span><i class="legend-swatch level-1"></i><i class="legend-swatch level-2"></i><i class="legend-swatch level-3"></i><i class="legend-swatch level-4"></i><span>많음</span></div>`,
  ].join("")
}

function bestSlotChip(
  slot: AvailabilitySlot,
  count: number,
  participantCount: number,
  index: number,
): string {
  const [, month, day] = slot.date.split("-")
  const label =
    month === undefined || day === undefined
      ? `${slot.date} ${slot.time}`
      : `${month}/${day} ${slot.time}`
  return `<div class="best-chip"><span>${index + 1}</span><strong>${escapeHtml(label)}</strong><em>${count}/${participantCount}</em></div>`
}

function dateHeader(date: string): string {
  const [, month, day] = date.split("-")
  const label = month === undefined || day === undefined ? date : `${month}/${day}`
  return `<div class="matrix-date"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(date)}</span></div>`
}

function timeRow(
  time: string,
  board: AvailabilityBoard,
  counts: ReadonlyMap<string, SlotAvailability>,
): string {
  return [
    `<div class="matrix-time">${escapeHtml(time)}</div>`,
    board.dates
      .map((date) => {
        const slotId = `${date}T${time}`
        const availability = counts.get(slotId)
        if (availability === undefined) return `<div class="matrix-cell empty"></div>`
        const level = heatLevel(availability.count, board.participants.length)
        const names = availability.participants.join(", ") || "가능한 사람 없음"
        return `<div class="matrix-cell level-${level}" title="${escapeHtml(names)}"><strong>${availability.count}</strong><span>/${board.participants.length}</span></div>`
      })
      .join(""),
  ].join("")
}

type SlotAvailability = {
  readonly count: number
  readonly participants: readonly string[]
}

function slotCounts(board: AvailabilityBoard): ReadonlyMap<string, SlotAvailability> {
  const counts = new Map<string, { count: number; participants: string[] }>(
    board.slots.map((slot) => [slot.id, { count: 0, participants: [] }]),
  )
  for (const [participant, response] of Object.entries(board.responses)) {
    for (const slotId of response.availableSlotIds) {
      const current = counts.get(slotId)
      if (current !== undefined) {
        current.count += 1
        current.participants.push(participant)
      }
    }
  }
  return counts
}

function uniqueTimes(slots: readonly AvailabilitySlot[]): readonly string[] {
  return [...new Set(slots.map((slot) => slot.time))].sort()
}

function heatLevel(count: number, participantCount: number): number {
  if (count === 0 || participantCount === 0) return 0
  return Math.max(1, Math.min(4, Math.ceil((count / participantCount) * 4)))
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}
