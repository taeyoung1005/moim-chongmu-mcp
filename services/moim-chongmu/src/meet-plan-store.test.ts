import { describe, expect, it } from "vitest"

import { createMeetPlanStore, type MeetPlan } from "./meet-plan-store.js"

const plan: MeetPlan = {
  origins: [{ label: "서울역", x: 126.9723, y: 37.5547 }],
  midpoint: { x: 127, y: 37.5 },
  fairness: [{ originLabel: "서울역", distanceMeters: 1200 }],
  places: [],
  mode: "fixture",
  sourceNote: "local fixture data",
}

describe("meet plan store", () => {
  it("saves and finds by an unguessable uuid", () => {
    const store = createMeetPlanStore()
    const stored = store.save(plan)
    expect(stored.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(store.find(stored.id)?.midpoint.x).toBe(127)
    expect(store.find(stored.id)?.origins[0]?.label).toBe("서울역")
  })

  it("returns undefined for an unknown id", () => {
    expect(createMeetPlanStore().find("does-not-exist")).toBeUndefined()
  })

  it("expires entries after the ttl", () => {
    let now = 1000
    const store = createMeetPlanStore({ ttlMs: 100, nowMs: () => now })
    const stored = store.save(plan)
    now = 1050
    expect(store.find(stored.id)).toBeDefined()
    now = 1200
    expect(store.find(stored.id)).toBeUndefined()
  })
})
