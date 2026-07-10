import type { AvailabilityBoardStore } from "./availability-board-store.js"
import type { AvailabilityBoard } from "./domain/moim.js"
import { parseAvailabilityBoardInput } from "./service-schemas.js"

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const boardUrlPattern =
  /(?:^|\/)boards\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?:$|[?#])/i

export function resolveAvailabilityBoardReference(
  input: unknown,
  store: AvailabilityBoardStore,
): AvailabilityBoard | undefined {
  const embeddedBoard = parseAvailabilityBoardInput(input)
  if (embeddedBoard !== undefined) return embeddedBoard
  const boardId = parseBoardId(input)
  return boardId === undefined ? undefined : store.find(boardId)?.board
}

function parseBoardId(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined
  const value = input.trim()
  if (uuidPattern.test(value)) return value.toLowerCase()
  return boardUrlPattern.exec(value)?.[1]?.toLowerCase()
}
