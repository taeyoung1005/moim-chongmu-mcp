import type { AvailabilityBoard } from "./availability.js"

export type BoardValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string }

export function validateAvailabilityBoardState(board: AvailabilityBoard): BoardValidationResult {
  if (board.slots.length > 168) return invalid()
  if (board.participants.length > 30) return invalid()
  const participants = new Set(board.participants)
  if (participants.size !== board.participants.length) return invalid()
  const slotIds = new Set(board.slots.map((slot) => slot.id))
  if (slotIds.size !== board.slots.length) return invalid()
  const responseEntries = Object.entries(board.responses)
  if (responseEntries.length > board.participants.length) return invalid()
  for (const [participant, response] of responseEntries) {
    const responseSlotIds = new Set(response.availableSlotIds)
    if (!participants.has(participant)) return invalid()
    if (responseSlotIds.size !== response.availableSlotIds.length) return invalid()
    if (response.availableSlotIds.length > board.slots.length) return invalid()
    if (response.availableSlotIds.some((slotId) => !slotIds.has(slotId))) return invalid()
  }
  return { ok: true }
}

function invalid(): BoardValidationResult {
  return { ok: false, message: "보드 상태를 확인해 주세요." }
}
