import { createHash, randomUUID } from "node:crypto"

import type { AvailabilityBoard } from "./domain/moim.js"

export type StoredAvailabilityBoard = {
  readonly id: string
  readonly board: AvailabilityBoard
  readonly participantPasswordHashes: Readonly<Record<string, string>>
  readonly expiresAtMs: number
}

export type AvailabilityBoardStore = {
  readonly save: (board: AvailabilityBoard) => StoredAvailabilityBoard
  readonly update: (id: string, board: AvailabilityBoard) => StoredAvailabilityBoard | undefined
  readonly verifyParticipantPassword: (
    id: string,
    participant: string,
    password: string,
  ) => PasswordVerification
  readonly find: (id: string) => StoredAvailabilityBoard | undefined
  readonly findByStateHash: (stateHash: string) => StoredAvailabilityBoard | undefined
}

export type PasswordVerification =
  | { readonly ok: true; readonly status: "registered" | "verified" }
  | { readonly ok: false; readonly reason: "missing_board" | "empty_password" | "invalid_password" }

export function createAvailabilityBoardStore(
  options: { readonly ttlMs?: number | undefined; readonly nowMs?: () => number } = {},
): AvailabilityBoardStore {
  const ttlMs = options.ttlMs ?? 1000 * 60 * 60 * 24 * 14
  const nowMs = options.nowMs ?? Date.now
  const boards = new Map<string, StoredAvailabilityBoard>()

  function save(board: AvailabilityBoard): StoredAvailabilityBoard {
    pruneExpired(boards, nowMs())
    const stored = {
      id: randomUUID().slice(0, 8),
      board,
      participantPasswordHashes: {},
      expiresAtMs: nowMs() + ttlMs,
    }
    boards.set(stored.id, stored)
    return stored
  }

  function update(id: string, board: AvailabilityBoard): StoredAvailabilityBoard | undefined {
    pruneExpired(boards, nowMs())
    const current = boards.get(id)
    if (current === undefined) return undefined
    const stored = {
      id,
      board,
      participantPasswordHashes: current.participantPasswordHashes,
      expiresAtMs: nowMs() + ttlMs,
    }
    boards.set(id, stored)
    return stored
  }

  function verifyParticipantPassword(
    id: string,
    participant: string,
    password: string,
  ): PasswordVerification {
    pruneExpired(boards, nowMs())
    const current = boards.get(id)
    if (current === undefined) return { ok: false, reason: "missing_board" }
    if (password.trim().length === 0) return { ok: false, reason: "empty_password" }
    const passwordHash = hashPassword(id, participant, password)
    const currentHash = current.participantPasswordHashes[participant]
    if (currentHash === undefined) {
      boards.set(id, {
        ...current,
        participantPasswordHashes: {
          ...current.participantPasswordHashes,
          [participant]: passwordHash,
        },
        expiresAtMs: nowMs() + ttlMs,
      })
      return { ok: true, status: "registered" }
    }
    if (currentHash !== passwordHash) return { ok: false, reason: "invalid_password" }
    return { ok: true, status: "verified" }
  }

  function find(id: string): StoredAvailabilityBoard | undefined {
    pruneExpired(boards, nowMs())
    return boards.get(id)
  }

  function findByStateHash(stateHash: string): StoredAvailabilityBoard | undefined {
    pruneExpired(boards, nowMs())
    for (const stored of boards.values()) {
      if (stored.board.stateHash === stateHash) return stored
    }
    return undefined
  }

  return { save, update, verifyParticipantPassword, find, findByStateHash }
}

function hashPassword(id: string, participant: string, password: string): string {
  return createHash("sha256").update(`${id}\u0000${participant}\u0000${password}`).digest("hex")
}

function pruneExpired(boards: Map<string, StoredAvailabilityBoard>, nowMs: number): void {
  for (const [id, stored] of boards.entries()) {
    if (stored.expiresAtMs <= nowMs) boards.delete(id)
  }
}
