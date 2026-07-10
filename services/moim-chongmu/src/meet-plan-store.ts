import { randomUUID } from "node:crypto"

export type MeetRoute = {
  // Road-following polyline as [lng, lat] pairs, plus real driving distance/time.
  readonly path: readonly (readonly [number, number])[]
  readonly distanceMeters: number
  readonly durationSeconds: number
}

export type MeetPlanOrigin = {
  readonly label: string
  readonly address?: string | undefined
  readonly x: number
  readonly y: number
  readonly route?: MeetRoute | undefined
}

export type MeetPlanFairness = {
  readonly originLabel: string
  readonly distanceMeters: number
}

export type MeetPlanPlace = {
  readonly name: string
  readonly address: string
  readonly x: number
  readonly y: number
  readonly categoryCode?: string | undefined
  readonly placeUrl?: string | undefined
  readonly distanceMeters: number
}

export type MeetPlan = {
  readonly origins: readonly MeetPlanOrigin[]
  readonly midpoint: { readonly x: number; readonly y: number }
  readonly fairness: readonly MeetPlanFairness[]
  readonly places: readonly MeetPlanPlace[]
  readonly mode: "fixture" | "live"
  readonly sourceNote: string
}

export type StoredMeetPlan = MeetPlan & {
  readonly id: string
  readonly expiresAtMs: number
}

export type MeetPlanStore = {
  readonly save: (plan: MeetPlan) => StoredMeetPlan
  readonly find: (id: string) => StoredMeetPlan | undefined
}

export function createMeetPlanStore(
  options: { readonly ttlMs?: number | undefined; readonly nowMs?: () => number } = {},
): MeetPlanStore {
  const ttlMs = options.ttlMs ?? 1000 * 60 * 60 * 24 * 14
  const nowMs = options.nowMs ?? Date.now
  const plans = new Map<string, StoredMeetPlan>()

  function save(plan: MeetPlan): StoredMeetPlan {
    pruneExpired(plans, nowMs())
    // Full UUID (122-bit random) so the result link is an unguessable capability URL.
    const stored: StoredMeetPlan = { ...plan, id: randomUUID(), expiresAtMs: nowMs() + ttlMs }
    plans.set(stored.id, stored)
    return stored
  }

  function find(id: string): StoredMeetPlan | undefined {
    pruneExpired(plans, nowMs())
    return plans.get(id)
  }

  return { save, find }
}

function pruneExpired(plans: Map<string, StoredMeetPlan>, nowMs: number): void {
  for (const [id, stored] of plans.entries()) {
    if (stored.expiresAtMs <= nowMs) plans.delete(id)
  }
}
