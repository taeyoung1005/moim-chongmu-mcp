import { describe, expect, it } from "vitest"

import { findMidpoint, placeCategoryCodes, recommendMidpointPlaces } from "./moim.js"

describe("moim-coordinate places domain", () => {
  it("finds a coordinate midpoint with haversine fairness rows", () => {
    const result = findMidpoint({
      origins: [
        { label: "민지", coordinates: { x: 126.978, y: 37.5665 } },
        { label: "태영", coordinates: { x: 127.0276, y: 37.4979 } },
        { label: "수현", coordinates: { x: 126.9368, y: 37.5559 } },
      ],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error.message)
    expect(result.value.midpoint).toEqual({ x: 126.9808, y: 37.5401 })
    expect(result.value.fairnessRows).toHaveLength(3)
    expect(result.value.fairnessRows[0]?.originLabel).toBe("민지")
    expect(result.value.fairnessRows.every((row) => row.distanceMeters > 0)).toBe(true)

    const insufficient = findMidpoint({
      origins: [
        { label: "민지", address: "서울역" },
        { label: "태영", coordinates: { x: 127.0276, y: 37.4979 } },
      ],
    })
    expect(insufficient).toEqual({
      ok: false,
      error: {
        kind: "insufficient_origins",
        message: "at least 2 resolved origins are required",
        resolvedCount: 1,
      },
    })
  })

  it("dedupes and ranks midpoint places with category codes and output caps", () => {
    expect(placeCategoryCodes).toEqual({
      cafe: "CE7",
      restaurant: "FD6",
      subway: "SW8",
      culture: "CT1",
      attraction: "AT4",
      parking: "PK6",
    })

    const places = recommendMidpointPlaces({
      midpoint: { x: 126.98, y: 37.54 },
      categories: ["any"],
      limit: 3,
      places: [
        {
          id: "same",
          name: "가까운 카페",
          address: "서울 중구 A",
          x: 126.981,
          y: 37.54,
          categoryCode: "CE7",
        },
        {
          id: "same",
          name: "가까운 카페 중복",
          address: "서울 중구 A",
          x: 126.981,
          y: 37.54,
          categoryCode: "CE7",
        },
        { name: "동명", address: "서울 중구 B", x: 126.982, y: 37.54, categoryCode: "FD6" },
        { name: "동명 ", address: " 서울 중구 B ", x: 126.982, y: 37.54, categoryCode: "FD6" },
        { name: "먼 카페", address: "서울 마포구", x: 126.94, y: 37.56, categoryCode: "CE7" },
        { name: "중간 식당", address: "서울 용산구", x: 126.99, y: 37.54, categoryCode: "FD6" },
      ],
    })

    expect(places).toHaveLength(3)
    expect(places.map((place) => place.name)).toEqual(["가까운 카페", "동명", "중간 식당"])
    expect(places[0]?.distanceMeters).toBeLessThan(places[2]?.distanceMeters ?? 0)
  })

  it("filters midpoint places by requested category before ranking", () => {
    const places = recommendMidpointPlaces({
      midpoint: { x: 126.98, y: 37.54 },
      categories: ["cafe"],
      limit: 5,
      places: [
        {
          name: "가까운 식당",
          address: "서울 중구 A",
          x: 126.9801,
          y: 37.54,
          categoryCode: "FD6",
        },
        {
          name: "중간 카페",
          address: "서울 중구 B",
          x: 126.982,
          y: 37.54,
          categoryCode: "CE7",
        },
        {
          name: "먼 카페",
          address: "서울 마포구",
          x: 126.94,
          y: 37.56,
          categoryCode: "CE7",
        },
      ],
    })

    expect(places.map((place) => place.name)).toEqual(["중간 카페", "먼 카페"])
    expect(places.every((place) => place.categoryCode === "CE7")).toBe(true)
  })
})
