function partKey(partNum, colorId) {
  return `${partNum}|${colorId}`;
}

export function buildOwnedPartMap(parts) {
  const map = new Map();

  parts.forEach((part) => {
    const key = partKey(part.partNum, part.colorId);
    map.set(key, (map.get(key) ?? 0) + part.quantity);
  });

  return map;
}

export function evaluateCombination(comboSets, ownedMap, totalOwnedQty) {
  const requiredMap = new Map();

  comboSets.forEach((set) => {
    set.partsMap.forEach((qty, key) => {
      requiredMap.set(key, (requiredMap.get(key) ?? 0) + qty);
    });
  });

  let matchedOwnedQty = 0;
  let missingQty = 0;
  let totalRequiredQty = 0;

  requiredMap.forEach((requiredQty, key) => {
    const ownedQty = ownedMap.get(key) ?? 0;
    matchedOwnedQty += Math.min(ownedQty, requiredQty);
    missingQty += Math.max(requiredQty - ownedQty, 0);
    totalRequiredQty += requiredQty;
  });

  const unusedOwnedQty = Math.max(totalOwnedQty - matchedOwnedQty, 0);
  const coverageRatio = totalOwnedQty === 0 ? 0 : matchedOwnedQty / totalOwnedQty;
  const buyRatio = totalRequiredQty === 0 ? 1 : matchedOwnedQty / totalRequiredQty;

  const score =
    unusedOwnedQty * 1000 +
    missingQty * 30 +
    comboSets.length * 5 +
    Math.max(totalRequiredQty - totalOwnedQty, 0);

  return {
    score,
    coverageRatio,
    buyRatio,
    matchedOwnedQty,
    missingQty,
    unusedOwnedQty,
    totalRequiredQty,
  };
}

function compareEvaluations(a, b) {
  if (a.metrics.score !== b.metrics.score) {
    return a.metrics.score - b.metrics.score;
  }
  if (a.metrics.unusedOwnedQty !== b.metrics.unusedOwnedQty) {
    return a.metrics.unusedOwnedQty - b.metrics.unusedOwnedQty;
  }
  if (a.metrics.missingQty !== b.metrics.missingQty) {
    return a.metrics.missingQty - b.metrics.missingQty;
  }
  if (a.metrics.matchedOwnedQty !== b.metrics.matchedOwnedQty) {
    return b.metrics.matchedOwnedQty - a.metrics.matchedOwnedQty;
  }
  return a.sets.length - b.sets.length;
}

function dedupeBySetSignature(items) {
  const seen = new Set();
  const output = [];

  items.forEach((item) => {
    const signature = item.sets
      .map((set) => set.set_num)
      .sort()
      .join("+");

    if (!seen.has(signature)) {
      seen.add(signature);
      output.push(item);
    }
  });

  return output;
}

function passesUnusedFilter(metrics, totalOwnedQty, maxUnusedPercent) {
  if (maxUnusedPercent === null || maxUnusedPercent === undefined) {
    return true;
  }

  if (totalOwnedQty <= 0) {
    return maxUnusedPercent >= 0;
  }

  const unusedPercent = (metrics.unusedOwnedQty / totalOwnedQty) * 100;
  return unusedPercent <= maxUnusedPercent;
}

export function rankRecommendations(candidateSets, ownedMap, options = {}) {
  const maxSets = options.maxSets ?? 3;
  const beamWidth = options.beamWidth ?? 40;
  const top = options.top ?? 10;
  const totalOwnedQty = options.totalOwnedQty ?? 0;
  const maxUnusedPercent = options.maxUnusedPercent ?? null;
  const onProgress =
    typeof options.onProgress === "function" ? options.onProgress : null;

  const evaluatedAll = [];

  const seed = candidateSets.map((set, index) => ({
    sets: [set],
    indices: [index],
    metrics: evaluateCombination([set], ownedMap, totalOwnedQty),
  }));

  let beam = [...seed];

  beam.sort(compareEvaluations);
  beam = beam.slice(0, beamWidth);
  evaluatedAll.push(...seed);

  if (onProgress) {
    onProgress({
      phase: "seed",
      maxSets,
      beamWidth,
      candidates: candidateSets.length,
      kept: beam.length,
      evaluated: evaluatedAll.length,
    });
  }

  for (let size = 2; size <= maxSets; size += 1) {
    if (onProgress) {
      onProgress({
        phase: "expand-start",
        size,
        beamSize: beam.length,
        evaluated: evaluatedAll.length,
      });
    }

    const nextBeam = [];

    beam.forEach((entry) => {
      const lastIndex = entry.indices[entry.indices.length - 1];

      for (let i = lastIndex + 1; i < candidateSets.length; i += 1) {
        const newSets = [...entry.sets, candidateSets[i]];
        nextBeam.push({
          sets: newSets,
          indices: [...entry.indices, i],
          metrics: evaluateCombination(newSets, ownedMap, totalOwnedQty),
        });
      }
    });

    if (nextBeam.length === 0) {
      if (onProgress) {
        onProgress({
          phase: "expand-empty",
          size,
          evaluated: evaluatedAll.length,
        });
      }
      break;
    }

    nextBeam.sort(compareEvaluations);
    beam = nextBeam.slice(0, beamWidth);
    evaluatedAll.push(...nextBeam);

    if (onProgress) {
      onProgress({
        phase: "expand-done",
        size,
        generated: nextBeam.length,
        kept: beam.length,
        evaluated: evaluatedAll.length,
      });
    }
  }

  const unique = dedupeBySetSignature(evaluatedAll);
  unique.sort(compareEvaluations);
  const filteredByUnused = unique.filter((entry) =>
    passesUnusedFilter(entry.metrics, totalOwnedQty, maxUnusedPercent)
  );
  const result = filteredByUnused.slice(0, top);

  if (onProgress) {
    onProgress({
      phase: "done",
      evaluated: evaluatedAll.length,
      unique: unique.length,
      filtered: filteredByUnused.length,
      filteredOut: unique.length - filteredByUnused.length,
      maxUnusedPercent,
      returned: result.length,
    });
  }

  return result;
}
