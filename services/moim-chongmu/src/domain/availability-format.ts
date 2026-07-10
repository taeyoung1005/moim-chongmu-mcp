import type { AvailabilityBoard, AvailabilitySummary } from "./availability.js"

export function summarizeBestTimes(
  board: AvailabilityBoard,
  options: { readonly limit?: number | undefined } = {},
): AvailabilitySummary {
  const counts = new Map<string, number>(board.slots.map((slot) => [slot.id, 0]))
  for (const response of Object.values(board.responses)) {
    for (const slotId of response.availableSlotIds) {
      counts.set(slotId, (counts.get(slotId) ?? 0) + 1)
    }
  }

  const participantCount = board.participants.length
  const bestSlots = board.slots
    .map((slot) => ({
      id: slot.id,
      availableCount: counts.get(slot.id) ?? 0,
      participantCount,
    }))
    .sort(
      (left, right) =>
        right.availableCount - left.availableCount || left.id.localeCompare(right.id),
    )
    .slice(0, options.limit ?? 5)

  const respondents = new Set(Object.keys(board.responses))
  const missingRespondents = board.participants.filter(
    (participant) => !respondents.has(participant),
  )
  const heatmapRows = board.slots.map((slot) => {
    const availableCount = counts.get(slot.id) ?? 0
    return `${slot.id} ${heat(availableCount, participantCount)} ${availableCount}/${participantCount}`
  })

  return {
    bestSlots,
    missingRespondents,
    markdown: [
      `## ${board.title} 가능한 시간`,
      "",
      "### 많이 겹치는 시간",
      ...bestSlots.map(
        (slot, index) =>
          `${index + 1}. ${slot.id} - ${slot.availableCount}/${slot.participantCount}`,
      ),
      "",
      "### 시간표",
      ...heatmapRows,
      "",
      `미응답: ${formatMissingRespondents(missingRespondents)}`,
    ].join("\n"),
  }
}

export function makeChatShareMessage(input: {
  readonly board: AvailabilityBoard
  readonly bestSlotIds?: readonly string[] | undefined
  readonly placeName?: string | undefined
}): string {
  const summary = summarizeBestTimes(input.board)
  const bestSlots = input.bestSlotIds?.length
    ? input.bestSlotIds.join(", ")
    : summary.bestSlots.map((slot) => slot.id).join(", ") || "아직 집계 전"
  const place = input.placeName === undefined ? "장소는 아직 미정" : normalizeText(input.placeName)
  const missing = formatMissingRespondents(summary.missingRespondents)
  const reminder =
    summary.missingRespondents.length === 0
      ? "모두 응답했습니다. 확정 전 마지막으로 시간과 장소를 확인해 주세요."
      : `가능한 시간을 아직 안 적은 분들은 ${summary.missingRespondents.join(
          ", ",
        )}입니다. 가능한 시간만 표시해 주세요.`

  return [
    `## ${input.board.title}`,
    "",
    "### 공유 후보",
    `- 시간 후보: ${bestSlots}`,
    `- 장소 후보: ${place}`,
    `- 미응답: ${missing}`,
    "",
    "### 리마인드",
    reminder,
    "",
    "아직 메시지는 전송하지 않았습니다. 이 문구를 채팅방에 붙여넣어 공유해 주세요.",
  ].join("\n")
}

function heat(availableCount: number, participantCount: number): string {
  const ratio = participantCount === 0 ? 0 : availableCount / participantCount
  const filled = Math.max(0, Math.min(4, Math.round(ratio * 4)))
  return `[${"=".repeat(filled)}${"-".repeat(4 - filled)}]`
}

function formatMissingRespondents(missingRespondents: readonly string[]): string {
  return missingRespondents.length === 0 ? "없음" : missingRespondents.join(", ")
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ")
}
