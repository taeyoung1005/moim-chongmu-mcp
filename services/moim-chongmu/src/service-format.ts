import type { SourceStatus } from "./adapters/moim-sources.js"
import {
  type AvailabilityBoard,
  encodeAvailabilityBoardState,
  type MarkAvailabilityError,
  summarizeBestTimes,
} from "./domain/moim.js"

export function formatBoardResult(
  board: AvailabilityBoard,
  options: { readonly voteUrl?: string | undefined } = {},
): string {
  return [
    summarizeBestTimes(board).markdown,
    ...formatVoteUrl(options.voteUrl),
    "",
    "### 상태",
    `stateHash: ${board.stateHash}`,
    "",
    "```boardState",
    JSON.stringify(encodeAvailabilityBoardState(board)),
    "```",
  ].join("\n")
}

function formatVoteUrl(voteUrl: string | undefined): readonly string[] {
  if (voteUrl === undefined) return []
  return ["", "### 웹 투표", `- 슬롯 선택 링크: ${voteUrl}`]
}

export function formatAvailabilityError(error: MarkAvailabilityError): string {
  switch (error.kind) {
    case "stale_state":
      return [
        "## 입력 오류",
        "",
        "가능 시간 보드가 오래되었습니다. 다시 불러온 뒤 최신 stateHash로 표시해 주세요.",
        `현재 stateHash: ${error.currentStateHash}`,
      ].join("\n")
    case "unknown_participant":
      return ["## 입력 오류", "", `참여자를 확인해 주세요: ${error.participant}`].join("\n")
    case "invalid_slot_ids":
      return ["## 입력 오류", "", "가능 시간을 확인해 주세요."].join("\n")
    default:
      return assertNever(error)
  }
}

export function formatBoardStateError(message = "보드 상태를 확인해 주세요."): string {
  return ["## 입력 오류", "", message].join("\n")
}

export function formatCreateBoardError(): string {
  return ["## 입력 오류", "", "보드 입력값을 확인해 주세요."].join("\n")
}

export function formatMidpointError(message: string): string {
  return ["## 입력 오류", "", `중간지점을 계산할 수 없습니다: ${message}`].join("\n")
}

export function formatSourceStatuses(sources: readonly SourceStatus[]): string {
  return sources.map((source) => `- ${source.label}: ${source.status} (${source.note})`).join("\n")
}

function assertNever(value: never): never {
  throw new Error(`unexpected availability error: ${JSON.stringify(value)}`)
}
