import { describe, expect, test } from "vitest";
import {
  buildOwnedPartMap,
  evaluateCombination,
  rankRecommendations,
} from "../src/recommendationEngine.js";

function createSet(setNum, partsEntries) {
  const partsMap = new Map(partsEntries);
  const totalParts = [...partsMap.values()].reduce((sum, qty) => sum + qty, 0);
  return {
    set_num: setNum,
    name: `Set ${setNum}`,
    partsMap,
    totalParts,
  };
}

describe("recommendationEngine", () => {
  test("evaluateCombination counts matched, missing and unused parts", () => {
    const owned = buildOwnedPartMap([
      { partNum: "3001", colorId: 1, quantity: 4 },
      { partNum: "3002", colorId: 1, quantity: 2 },
    ]);

    const setA = createSet("1000-1", [
      ["3001|1", 3],
      ["3002|1", 4],
    ]);

    const metrics = evaluateCombination([setA], owned, 6);

    expect(metrics.matchedOwnedQty).toBe(5);
    expect(metrics.missingQty).toBe(2);
    expect(metrics.unusedOwnedQty).toBe(1);
    expect(metrics.totalRequiredQty).toBe(7);
  });

  test("rankRecommendations prefers combos that use all owned and require fewer new parts", () => {
    const owned = buildOwnedPartMap([
      { partNum: "3001", colorId: 1, quantity: 2 },
      { partNum: "3002", colorId: 1, quantity: 2 },
    ]);

    const candidates = [
      createSet("A", [["3001|1", 2]]),
      createSet("B", [["3002|1", 2]]),
      createSet("C", [["9999|1", 2]]),
    ];

    const ranked = rankRecommendations(candidates, owned, {
      maxSets: 2,
      beamWidth: 10,
      top: 3,
      totalOwnedQty: 4,
    });

    const best = ranked[0];
    const bestSetNums = best.sets.map((set) => set.set_num).sort();

    expect(bestSetNums).toEqual(["A", "B"]);
    expect(best.metrics.unusedOwnedQty).toBe(0);
    expect(best.metrics.missingQty).toBe(0);
  });
});
