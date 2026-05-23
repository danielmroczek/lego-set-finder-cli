#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname } from "path";
import { JSONFilePreset } from "lowdb/node";
import { RebrickableApi } from "./src/rebrickableApi.js";
import { renderHtmlReport } from "./src/reportGenerator.js";
import {
  buildOwnedPartMap,
  rankRecommendations,
} from "./src/recommendationEngine.js";

function partKey(partNum, colorId) {
  return `${partNum}|${colorId}`;
}

function parseArgs(argv) {
  const parsed = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const value = argv[i + 1];

    if (!value || value.startsWith("--")) {
      parsed[key] = "true";
      continue;
    }

    parsed[key] = value;
    i += 1;
  }

  return parsed;
}

async function loadConfig(configPath) {
  try {
    const raw = await readFile(configPath, "utf-8");
    const parsed = JSON.parse(raw);

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Config must be a JSON object.");
    }

    return parsed;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {};
    }

    throw new Error(`Invalid configuration file (${configPath}): ${error.message}`);
  }
}

function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return fallback;
}

function toPercentInRange(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parsed = Number.parseFloat(String(value));
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    throw new Error("Invalid value for --max-unused. Expected a number in range 0-100.");
  }

  return parsed;
}

function normalizeOwnedParts(rawParts) {
  return rawParts
    .map((item) => {
      const partNum = item.part?.part_num ?? item.part_num;
      const colorId = item.color_id ?? item.color?.id;
      const quantity = item.quantity ?? item.qty;
      return {
        partNum,
        colorId,
        quantity,
        partId: partNum,
      };
    })
    .filter(
      (part) =>
        part.partNum &&
        Number.isFinite(part.colorId) &&
        Number.isFinite(part.quantity) &&
        part.quantity > 0
    );
}

function extractLegoIdsFromExternalIds(externalIds) {
  if (!externalIds || typeof externalIds !== "object") {
    return [];
  }

  const ids = [];

  Object.entries(externalIds).forEach(([source, value]) => {
    if (!/lego/i.test(source)) {
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((entry) => {
        if (entry !== null && entry !== undefined && String(entry).trim() !== "") {
          ids.push(String(entry));
        }
      });
      return;
    }

    if (value && typeof value === "object") {
      Object.values(value).forEach((entry) => {
        if (Array.isArray(entry)) {
          entry.forEach((item) => {
            if (item !== null && item !== undefined && String(item).trim() !== "") {
              ids.push(String(item));
            }
          });
        } else if (entry !== null && entry !== undefined && String(entry).trim() !== "") {
          ids.push(String(entry));
        }
      });
      return;
    }

    if (value !== null && value !== undefined && String(value).trim() !== "") {
      ids.push(String(value));
    }
  });

  return [...new Set(ids)];
}

function mergePartMetadata(existing, incoming) {
  if (!existing) {
    return incoming ?? null;
  }
  if (!incoming) {
    return existing;
  }

  return {
    partNum: incoming.partNum ?? existing.partNum,
    colorId: incoming.colorId ?? existing.colorId,
    partName: incoming.partName ?? existing.partName,
    colorName: incoming.colorName ?? existing.colorName,
    imageUrl: incoming.imageUrl ?? existing.imageUrl,
    legoPartIds: [...new Set([...(existing.legoPartIds ?? []), ...(incoming.legoPartIds ?? [])])],
  };
}

function extractPartMetadata(item) {
  const partNum = item.part?.part_num ?? item.part_num;
  const colorId = item.color_id ?? item.color?.id;

  if (!partNum || !Number.isFinite(colorId)) {
    return null;
  }

  const legoPartIds = extractLegoIdsFromExternalIds(item.part?.external_ids);

  return {
    partNum,
    colorId,
    partName: item.part?.name ?? null,
    colorName: item.color?.name ?? null,
    imageUrl: item.part?.part_img_url ?? item.part_img_url ?? null,
    legoPartIds,
  };
}

function buildOwnedPartMetadataMap(rawOwnedParts) {
  const metadataMap = new Map();

  rawOwnedParts.forEach((item) => {
    const metadata = extractPartMetadata(item);
    if (!metadata) {
      return;
    }

    const key = partKey(metadata.partNum, metadata.colorId);
    const previous = metadataMap.get(key);
    metadataMap.set(key, mergePartMetadata(previous, metadata));
  });

  return metadataMap;
}

function buildRecommendationPartBreakdown(comboSets, ownedPartMap, ownedPartMetadataMap) {
  const requiredMap = new Map();
  const requiredMetadataMap = new Map();

  comboSets.forEach((set) => {
    set.partsMap.forEach((requiredQty, key) => {
      requiredMap.set(key, (requiredMap.get(key) ?? 0) + requiredQty);
    });

    if (set.partDetailsByKey instanceof Map) {
      set.partDetailsByKey.forEach((metadata, key) => {
        requiredMetadataMap.set(
          key,
          mergePartMetadata(requiredMetadataMap.get(key), metadata)
        );
      });
    }
  });

  const missingParts = [];
  requiredMap.forEach((requiredQty, key) => {
    const ownedQty = ownedPartMap.get(key) ?? 0;
    const missingQty = Math.max(requiredQty - ownedQty, 0);
    if (missingQty <= 0) {
      return;
    }

    const metadata =
      mergePartMetadata(requiredMetadataMap.get(key), ownedPartMetadataMap.get(key)) ?? {};
    const [partNumRaw, colorIdRaw] = key.split("|");
    const partNum = metadata.partNum ?? partNumRaw;
    const colorId = metadata.colorId ?? Number.parseInt(colorIdRaw, 10);

    missingParts.push({
      key,
      partNum,
      colorId,
      partName: metadata.partName ?? null,
      colorName: metadata.colorName ?? null,
      imageUrl: metadata.imageUrl ?? null,
      rebrickablePartUrl: `https://rebrickable.com/parts/${partNum}/`,
      legoPartIds: metadata.legoPartIds ?? [],
      requiredQty,
      ownedQty,
      missingQty,
    });
  });

  const unusedParts = [];
  ownedPartMap.forEach((ownedQty, key) => {
    const requiredQty = requiredMap.get(key) ?? 0;
    const unusedQty = Math.max(ownedQty - requiredQty, 0);
    if (unusedQty <= 0) {
      return;
    }

    const metadata =
      mergePartMetadata(ownedPartMetadataMap.get(key), requiredMetadataMap.get(key)) ?? {};
    const [partNumRaw, colorIdRaw] = key.split("|");
    const partNum = metadata.partNum ?? partNumRaw;
    const colorId = metadata.colorId ?? Number.parseInt(colorIdRaw, 10);

    unusedParts.push({
      key,
      partNum,
      colorId,
      partName: metadata.partName ?? null,
      colorName: metadata.colorName ?? null,
      imageUrl: metadata.imageUrl ?? null,
      rebrickablePartUrl: `https://rebrickable.com/parts/${partNum}/`,
      legoPartIds: metadata.legoPartIds ?? [],
      ownedQty,
      usedQty: Math.min(ownedQty, requiredQty),
      unusedQty,
    });
  });

  missingParts.sort((a, b) => {
    if (a.missingQty !== b.missingQty) {
      return b.missingQty - a.missingQty;
    }
    return String(a.partNum).localeCompare(String(b.partNum));
  });

  unusedParts.sort((a, b) => {
    if (a.unusedQty !== b.unusedQty) {
      return b.unusedQty - a.unusedQty;
    }
    return String(a.partNum).localeCompare(String(b.partNum));
  });

  return {
    missingParts,
    unusedParts,
  };
}

function normalizeSetParts(rawParts) {
  const partsMap = new Map();
  const partDetailsByKey = new Map();
  let totalParts = 0;

  rawParts.forEach((item) => {
    if (item.is_spare) {
      return;
    }

    const partNum = item.part?.part_num ?? item.part_num;
    const colorId = item.color_id ?? item.color?.id;
    const quantity = item.quantity ?? item.qty;

    if (!partNum || !Number.isFinite(colorId) || !Number.isFinite(quantity)) {
      return;
    }

    const key = `${partNum}|${colorId}`;
    partsMap.set(key, (partsMap.get(key) ?? 0) + quantity);
    const metadata = extractPartMetadata(item);
    if (metadata) {
      partDetailsByKey.set(
        key,
        mergePartMetadata(partDetailsByKey.get(key), metadata)
      );
    }
    totalParts += quantity;
  });

  return {
    partsMap,
    partDetailsByKey,
    totalParts,
  };
}

function printUsage() {
  console.log("Usage:");
  console.log(
    "  node index.js [--config <path>] --api-key <API_KEY> --user-token <USER_TOKEN> --part-list-id <LIST_ID> [--top <n>] [--max-sets <n>] [--candidate-sets <n>] [--beam-width <n>] [--max-unused <n>] [--cache-file <path>] [--cache-ttl-days <n>] [--no-cache] [--help]"
  );
  console.log("");
  console.log("Description:");
  console.log(
    "  Finds the most likely LEGO set combinations for your Rebrickable part list by maximizing owned-part usage and minimizing missing parts to buy."
  );
  console.log("  Writes machine-readable output to result.json and a human-readable report to report.html.");
  console.log("");
  console.log("Arguments:");
  console.log("  --config <path>         Path to JSON config file. Default: ./config.json");
  console.log("  --api-key <API_KEY>     Rebrickable API key (required).");
  console.log("  --user-token <TOKEN>    Rebrickable user token for accessing your part lists (required).");
  console.log("  --part-list-id <ID>     Rebrickable part list ID to analyze (required).");
  console.log("  --top <n>               Number of recommendations returned. Default: 8.");
  console.log("  --max-sets <n>          Maximum number of sets in one combination. Default: 3.");
  console.log("  --candidate-sets <n>    Number of candidate sets kept after filtering. Default: 120.");
  console.log("  --beam-width <n>        Beam width for combination search (higher = broader/slower). Default: 40.");
  console.log("  --max-unused <n>        Keep only final recommendations with unused owned bricks <= n%. Range: 0-100.");
  console.log("  --cache-file <path>     Path to lowdb JSON cache for set parts. Default: ./.cache/set-parts-cache.json");
  console.log("  --cache-ttl-days <n>    Cache TTL in days for set parts. Older entries are refreshed. Default: 7.");
  console.log("  --no-cache              Skip cache reads and always fetch set parts from API, then update cache.");
  console.log("  --help, -h              Show this help message and exit.");
  console.log("");
  console.log("Configuration Priority:");
  console.log("  CLI arguments > Environment variables > Config file");
  console.log("");
  console.log("Environment Variables:");
  console.log("  REBRICKABLE_API_KEY     Alternative source for --api-key");
  console.log("  REBRICKABLE_USER_TOKEN  Alternative source for --user-token");
}

const args = parseArgs(process.argv.slice(2));

if (args.help === "true" || args.h === "true") {
  printUsage();
  process.exit(0);
}

const configPath = args.config ?? "config.json";
const config = await loadConfig(configPath);

const apiKey =
  args["api-key"] ??
  process.env.REBRICKABLE_API_KEY ??
  config.apiKey ??
  config["api-key"];

const userToken =
  args["user-token"] ??
  process.env.REBRICKABLE_USER_TOKEN ??
  config.userToken ??
  config["user-token"];

const partListId =
  args["part-list-id"] ??
  config.partListId ??
  config["part-list-id"] ??
  config.partList;

if (!apiKey || !userToken || !partListId) {
  printUsage();
  process.exit(1);
}

const top = toPositiveInt(args.top ?? config.top, 8);
const maxSets = toPositiveInt(args["max-sets"] ?? config.maxSets ?? config["max-sets"], 3);
const candidateLimit = toPositiveInt(
  args["candidate-sets"] ?? config.candidateSets ?? config["candidate-sets"],
  120
);
const beamWidth = toPositiveInt(
  args["beam-width"] ?? config.beamWidth ?? config["beam-width"],
  40
);
const maxUnusedPercent = toPercentInRange(
  args["max-unused"] ?? config.maxUnused ?? config["max-unused"]
);
const noCache =
  args["no-cache"] === "true" ||
  config.noCache === true ||
  config["no-cache"] === true;
const cacheFile = args["cache-file"] ?? config.cacheFile ?? config["cache-file"] ?? ".cache/set-parts-cache.json";
const cacheTtlDays = toPositiveInt(
  args["cache-ttl-days"] ?? config.cacheTtlDays ?? config["cache-ttl-days"],
  7
);
const cacheTtlMs = cacheTtlDays * 24 * 60 * 60 * 1000;

const api = new RebrickableApi(apiKey);

await mkdir(dirname(cacheFile), { recursive: true });
const setPartsCache = await JSONFilePreset(cacheFile, {
  setPartsBySetNum: {},
});
if (!setPartsCache.data?.setPartsBySetNum || typeof setPartsCache.data.setPartsBySetNum !== "object") {
  setPartsCache.data = {
    setPartsBySetNum: {},
  };
  await setPartsCache.write();
}

console.log(`Using part list ID=${partListId}`);
console.log(
  noCache
    ? `Set cache: read skipped (--no-cache), refreshing data from the API and writing to ${cacheFile}`
    : `Set cache: read/write enabled (${cacheFile}), ttl=${cacheTtlDays} days`
);

const rawOwnedParts = await api.getPartListParts(userToken, partListId);
const ownedParts = normalizeOwnedParts(rawOwnedParts);

if (ownedParts.length === 0) {
  throw new Error("The part list does not contain any items to analyze.");
}

const ownedPartMap = buildOwnedPartMap(ownedParts);
const ownedPartMetadataMap = buildOwnedPartMetadataMap(rawOwnedParts);
const totalOwnedQty = ownedParts.reduce((sum, part) => sum + part.quantity, 0);

console.log(`Loaded ${ownedParts.length} items, ${totalOwnedQty} bricks in total.`);

const candidateScore = new Map();

for (const part of ownedParts) {
  const sets = await api.getSetsForPartColor(part.partNum, part.colorId);

  sets.forEach((set) => {
    const current = candidateScore.get(set.set_num) ?? {
      set_num: set.set_num,
      name: set.name,
      year: set.year,
      num_parts: set.num_parts,
      hitQty: 0,
      hitPartTypes: 0,
    };

    current.hitQty += part.quantity;
    current.hitPartTypes += 1;
    candidateScore.set(set.set_num, current);
  });
}

const initialCandidates = [...candidateScore.values()]
  .sort((a, b) => {
    if (a.hitQty !== b.hitQty) {
      return b.hitQty - a.hitQty;
    }
    if (a.hitPartTypes !== b.hitPartTypes) {
      return b.hitPartTypes - a.hitPartTypes;
    }
    return (a.num_parts ?? 0) - (b.num_parts ?? 0);
  })
  .slice(0, candidateLimit);

console.log(`Candidates after filtering: ${initialCandidates.length}`);

const candidateSets = [];
const candidateBuildStart = Date.now();
let cacheHits = 0;
let cacheMisses = 0;
let apiFetches = 0;
let cacheWrites = 0;
let cacheStale = 0;

for (let index = 0; index < initialCandidates.length; index += 1) {
  const candidate = initialCandidates[index];
  const progressNo = index + 1;
  const cachedEntry = setPartsCache.data.setPartsBySetNum[candidate.set_num];
  const updatedAtMs = cachedEntry?.updatedAt ? Date.parse(cachedEntry.updatedAt) : Number.NaN;
  const isStale =
    !Number.isFinite(updatedAtMs) ||
    Date.now() - updatedAtMs > cacheTtlMs;
  let setPartsRaw;

  if (!noCache && cachedEntry && Array.isArray(cachedEntry.parts) && !isStale) {
    cacheHits += 1;
    setPartsRaw = cachedEntry.parts;
    console.log(
      `  [progress] cache hit for set ${candidate.set_num} (${progressNo}/${initialCandidates.length})`
    );
  } else {
    cacheMisses += 1;
    if (!noCache && cachedEntry && Array.isArray(cachedEntry.parts) && isStale) {
      cacheStale += 1;
    }

    let fetchReason = "cache miss";
    if (noCache) {
      fetchReason = "refreshing (--no-cache)";
    } else if (!noCache && cachedEntry && Array.isArray(cachedEntry.parts) && isStale) {
      fetchReason = `cache stale (> ${cacheTtlDays} days)`;
    }

    console.log(
      `  [progress] fetching set parts for ${candidate.set_num} (${progressNo}/${initialCandidates.length}) [${fetchReason}]...`
    );

    setPartsRaw = await api.getSetParts(candidate.set_num);
    apiFetches += 1;

    setPartsCache.data.setPartsBySetNum[candidate.set_num] = {
      setNum: candidate.set_num,
      updatedAt: new Date().toISOString(),
      parts: setPartsRaw,
    };
    await setPartsCache.write();
    cacheWrites += 1;
  }

  const { partsMap, partDetailsByKey, totalParts } = normalizeSetParts(setPartsRaw);

  if (totalParts === 0) {
    console.log(`  [progress] set ${candidate.set_num} skipped (no parts after filtering).`);
    continue;
  }

  candidateSets.push({
    ...candidate,
    partsMap,
    partDetailsByKey,
    totalParts,
  });

  if (
    progressNo % 10 === 0 ||
    progressNo === initialCandidates.length ||
    progressNo === 1
  ) {
    const elapsedSec = ((Date.now() - candidateBuildStart) / 1000).toFixed(1);
    console.log(
      `  [progress] candidates ready: ${candidateSets.length}/${progressNo}, cacheHits=${cacheHits}, apiFetches=${apiFetches}, elapsed=${elapsedSec}s`
    );
  }
}

if (candidateSets.length === 0) {
  throw new Error("Unable to build the candidate set list.");
}

const candidateBuildDurationSec = ((Date.now() - candidateBuildStart) / 1000).toFixed(2);
console.log(
  `Built candidate details: ${candidateSets.length}/${initialCandidates.length} in ${candidateBuildDurationSec}s.`
);
console.log(
  `Cache summary: hits=${cacheHits}, misses=${cacheMisses}, stale=${cacheStale}, fetchedFromApi=${apiFetches}, writtenToCache=${cacheWrites}, ttlDays=${cacheTtlDays}`
);

console.log(`Analyzing combinations (maxSets=${maxSets}, beamWidth=${beamWidth})...`);
const rankingStart = Date.now();

const ranked = rankRecommendations(candidateSets, ownedPartMap, {
  maxSets,
  beamWidth,
  top,
  totalOwnedQty,
  maxUnusedPercent,
  onProgress: (progress) => {
    if (progress.phase === "seed") {
      console.log(
        `  [progress] seed: candidates=${progress.candidates}, kept=${progress.kept}`
      );
      return;
    }

    if (progress.phase === "expand-start") {
      console.log(
        `  [progress] expanding size=${progress.size} (beam=${progress.beamSize})...`
      );
      return;
    }

    if (progress.phase === "expand-done") {
      console.log(
        `  [progress] size=${progress.size}: generated=${progress.generated}, kept=${progress.kept}, evaluatedTotal=${progress.evaluated}`
      );
      return;
    }

    if (progress.phase === "expand-empty") {
      console.log(
        `  [progress] size=${progress.size}: no further combinations, stopping this phase.`
      );
      return;
    }

    if (progress.phase === "done") {
      const filteredInfo =
        progress.maxUnusedPercent === null || progress.maxUnusedPercent === undefined
          ? ""
          : `, afterUnusedFilter=${progress.filtered}, filteredOutByUnused=${progress.filteredOut}`;
      console.log(
        `  [progress] done: evaluated=${progress.evaluated}, unique=${progress.unique}${filteredInfo}, returned=${progress.returned}`
      );
    }
  },
});

const rankingDurationSec = ((Date.now() - rankingStart) / 1000).toFixed(2);
console.log(`Combination analysis completed in ${rankingDurationSec}s.`);

const output = ranked.map((entry, index) => {
  const breakdown = buildRecommendationPartBreakdown(
    entry.sets,
    ownedPartMap,
    ownedPartMetadataMap
  );

  return {
    rank: index + 1,
    score: entry.metrics.score,
    matchedOwnedQty: entry.metrics.matchedOwnedQty,
    unusedOwnedQty: entry.metrics.unusedOwnedQty,
    unusedPercent: Number(((entry.metrics.unusedOwnedQty / totalOwnedQty) * 100).toFixed(2)),
    missingQty: entry.metrics.missingQty,
    coverageRatio: Number(entry.metrics.coverageRatio.toFixed(4)),
    buyRatio: Number(entry.metrics.buyRatio.toFixed(4)),
    sets: entry.sets.map((set) => ({
      set_num: set.set_num,
      name: set.name,
      year: set.year,
      num_parts: set.num_parts,
      url: `https://rebrickable.com/sets/${set.set_num}/`,
    })),
    missingParts: breakdown.missingParts,
    unusedParts: breakdown.unusedParts,
  };
});

console.log("\nMost likely recommendations:\n");
output.forEach((item) => {
  const setNums = item.sets.map((set) => set.set_num).join(", ");
  console.log(
    `#${item.rank} | coverage=${(item.coverageRatio * 100).toFixed(1)}% | missingToBuy=${item.missingQty} | unused=${item.unusedOwnedQty} (${item.unusedPercent}%) | sets=${setNums}`
  );
});

const result = {
  createdAt: new Date().toISOString(),
  query: {
    partListId,
    top,
    maxSets,
    candidateLimit,
    beamWidth,
    maxUnusedPercent,
  },
  stats: {
    ownedPartTypes: ownedParts.length,
    ownedPartQty: totalOwnedQty,
    candidateSets: candidateSets.length,
    cache: {
      file: cacheFile,
      noCache,
      ttlDays: cacheTtlDays,
      hits: cacheHits,
      misses: cacheMisses,
      stale: cacheStale,
      fetchedFromApi: apiFetches,
      writes: cacheWrites,
    },
  },
  recommendations: output,
};

await writeFile("result.json", JSON.stringify(result, null, 2), "utf-8");
console.log("\nSaved results to result.json");

const htmlReport = await renderHtmlReport(result);
await writeFile("report.html", htmlReport, "utf-8");
console.log("Saved HTML report to report.html");

