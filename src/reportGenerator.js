import { readFile } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import Mustache from "mustache";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const templatePath = join(__dirname, "..", "templates", "report.mustache.html");

function formatPercent(ratio, decimals = 1) {
  return `${(ratio * 100).toFixed(decimals)}%`;
}

function toCommaNumber(value) {
  return Number(value ?? 0).toLocaleString("en-US");
}

function normalizePartRow(row, type) {
  return {
    partNum: row.partNum,
    colorId: row.colorId,
    partName: row.partName ?? "Unknown part",
    colorName: row.colorName ?? "Unknown color",
    imageUrl: row.imageUrl,
    hasImage: Boolean(row.imageUrl),
    rebrickablePartUrl: row.rebrickablePartUrl,
    legoPartIdsJoined:
      Array.isArray(row.legoPartIds) && row.legoPartIds.length > 0
        ? row.legoPartIds.join(", ")
        : "n/a",
    requiredQty: type === "missing" ? toCommaNumber(row.requiredQty) : null,
    ownedQty: toCommaNumber(row.ownedQty),
    missingQty: type === "missing" ? toCommaNumber(row.missingQty) : null,
    usedQty: type === "unused" ? toCommaNumber(row.usedQty) : null,
    unusedQty: type === "unused" ? toCommaNumber(row.unusedQty) : null,
  };
}

function toTemplateView(result) {
  const recommendations = (result.recommendations ?? []).map((recommendation) => {
    const missingRows = (recommendation.missingParts ?? []).map((part) =>
      normalizePartRow(part, "missing")
    );
    const unusedRows = (recommendation.unusedParts ?? []).map((part) =>
      normalizePartRow(part, "unused")
    );

    return {
      rank: recommendation.rank,
      score: toCommaNumber(recommendation.score),
      coveragePercent: formatPercent(recommendation.coverageRatio, 1),
      buyPercent: formatPercent(recommendation.buyRatio, 1),
      matchedOwnedQty: toCommaNumber(recommendation.matchedOwnedQty),
      missingQty: toCommaNumber(recommendation.missingQty),
      unusedOwnedQty: toCommaNumber(recommendation.unusedOwnedQty),
      unusedPercent: `${Number(recommendation.unusedPercent ?? 0).toFixed(2)}%`,
      sets: (recommendation.sets ?? []).map((set) => ({
        setNum: set.set_num,
        name: set.name,
        year: set.year ?? "n/a",
        numParts: toCommaNumber(set.num_parts ?? 0),
        url: set.url,
      })),
      hasMissingParts: missingRows.length > 0,
      hasUnusedParts: unusedRows.length > 0,
      missingRows,
      unusedRows,
    };
  });

  return {
    generatedAt: result.createdAt,
    partListId: result.query?.partListId ?? "n/a",
    top: result.query?.top ?? 0,
    maxSets: result.query?.maxSets ?? 0,
    candidateLimit: result.query?.candidateLimit ?? 0,
    beamWidth: result.query?.beamWidth ?? 0,
    maxUnusedPercent:
      result.query?.maxUnusedPercent === null || result.query?.maxUnusedPercent === undefined
        ? "not set"
        : `${result.query.maxUnusedPercent}%`,
    ownedPartTypes: toCommaNumber(result.stats?.ownedPartTypes ?? 0),
    ownedPartQty: toCommaNumber(result.stats?.ownedPartQty ?? 0),
    candidateSets: toCommaNumber(result.stats?.candidateSets ?? 0),
    cacheFile: result.stats?.cache?.file ?? "n/a",
    cacheHits: toCommaNumber(result.stats?.cache?.hits ?? 0),
    cacheMisses: toCommaNumber(result.stats?.cache?.misses ?? 0),
    cacheStale: toCommaNumber(result.stats?.cache?.stale ?? 0),
    fetchedFromApi: toCommaNumber(result.stats?.cache?.fetchedFromApi ?? 0),
    recommendations,
    hasRecommendations: recommendations.length > 0,
  };
}

export async function renderHtmlReport(result) {
  const template = await readFile(templatePath, "utf-8");
  return Mustache.render(template, toTemplateView(result));
}
