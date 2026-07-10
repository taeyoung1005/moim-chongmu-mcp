import { deflateRawSync, inflateRawSync } from "node:zlib"

import type { AvailabilityBoard, Result } from "./availability.js"

export type EncodedAvailabilityBoardState = {
  readonly schemaVersion: "moim-coordinate-board/v1"
  readonly encoding: "deflate-base64url-json"
  readonly encodedState: string
}

const maxEncodedStateChars = 20_000
const maxDecodedStateBytes = 500_000

export function encodeAvailabilityBoardState(
  board: AvailabilityBoard,
): EncodedAvailabilityBoardState {
  const encodedState = deflateRawSync(Buffer.from(JSON.stringify(board), "utf8"), {
    level: 9,
  }).toString("base64url")
  if (encodedState.length > maxEncodedStateChars) {
    throw new Error("encoded board state too large")
  }
  return {
    schemaVersion: "moim-coordinate-board/v1",
    encoding: "deflate-base64url-json",
    encodedState,
  }
}

export function decodeAvailabilityBoardState(
  input: EncodedAvailabilityBoardState,
): Result<unknown, string> {
  if (input.encodedState.length > maxEncodedStateChars) {
    return { ok: false, error: "encoded board state too large" }
  }

  try {
    const inflated = inflateRawSync(Buffer.from(input.encodedState, "base64url"), {
      maxOutputLength: maxDecodedStateBytes,
    })
    return { ok: true, value: JSON.parse(inflated.toString("utf8")) }
  } catch (error) {
    if (error instanceof Error) return { ok: false, error: "encoded board state invalid" }
    return { ok: false, error: "encoded board state invalid" }
  }
}
