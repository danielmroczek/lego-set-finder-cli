# lego-set-finder-cli

`lego-set-finder-cli` is a Node.js CLI that analyzes a Rebrickable part list and suggests likely LEGO set combinations. It tries to maximize the use of parts you already own and minimize the number of missing parts you would need to buy.

> [!NOTE]
> This project has no build step. It runs directly with Node.js and writes its results to `result.json`.

## Features

- Reads Rebrickable credentials from CLI arguments, environment variables, or `config.json`.
- Fetches owned parts from the Rebrickable API.
- Builds and scores candidate set combinations with a beam-search heuristic.
- Caches detailed set-part responses in lowdb at `.cache/set-parts-cache.json`.
- Supports progress logs for long-running runs.
- Exposes a `--max-unused` filter to keep only recommendations that leave a chosen percentage of owned parts unused or less.

## Requirements

- Node.js 18 or newer
- A Rebrickable API key
- A Rebrickable user token
- A Rebrickable part list ID

## Quick Start

```bash
npm install
node . --help
node . --api-key <API_KEY> --user-token <USER_TOKEN> --part-list-id <LIST_ID>
```

> [!TIP]
> Start with a small run such as `--candidate-sets 5 --top 3` while validating your credentials or tuning filters.

## Configuration

The CLI reads settings in this order:

1. CLI arguments
2. Environment variables
3. `config.json`

Supported environment variables:

- `REBRICKABLE_API_KEY`
- `REBRICKABLE_USER_TOKEN`

Example `config.json`:

```json
{
  "apiKey": "...",
  "userToken": "...",
  "partListId": 635126,
  "top": 8,
  "maxSets": 3,
  "candidateSets": 120,
  "beamWidth": 40,
  "maxUnused": 10,
  "cacheFile": ".cache/set-parts-cache.json",
  "cacheTtlDays": 7,
  "noCache": false
}
```

> [!IMPORTANT]
> Keep real credentials out of version control. The repository already ignores `config.json` and `.env`.

## CLI Reference

| Flag | Description | Default |
| --- | --- | --- |
| `--api-key <API_KEY>` | Rebrickable API key | required |
| `--user-token <TOKEN>` | Rebrickable user token | required |
| `--part-list-id <ID>` | Rebrickable part list ID to analyze | required |
| `--top <n>` | Number of recommendations returned | `8` |
| `--max-sets <n>` | Maximum number of sets in one combination | `3` |
| `--candidate-sets <n>` | Number of candidate sets kept after filtering | `120` |
| `--beam-width <n>` | Beam width used during combination search | `40` |
| `--max-unused <0-100>` | Keep only recommendations with unused owned bricks at or below this percentage | unset |
| `--cache-file <path>` | Path to the lowdb cache file | `.cache/set-parts-cache.json` |
| `--cache-ttl-days <n>` | Cache TTL in days for set-part responses | `7` |
| `--no-cache` | Skip cache reads and always refresh set parts from the API | off |
| `--help`, `-h` | Show CLI help | off |

## How It Works

The program performs three main stages:

1. Loads the owned parts for the chosen Rebrickable part list.
2. Builds candidate sets from matching part/color combinations and fetches their full part lists.
3. Ranks combinations with a heuristic that prefers higher part reuse, lower missing parts, and lower leftover parts.

## Output

The CLI writes the final report to `result.json` and prints the top recommendations to the console.

Each recommendation includes:

- coverage and buy ratios
- missing parts to buy
- unused owned bricks and unused percentage
- set metadata and direct Rebrickable URLs

## Cache Behavior

Set-part responses are cached in `.cache/set-parts-cache.json`.

- Cache hits are used by default.
- `--no-cache` forces a fresh API fetch but still refreshes the cache.
- `--cache-ttl-days` controls when cached set-part data becomes stale.

> [!TIP]
> Use `--no-cache` when you want to validate live API behavior, or keep the default cache path for faster repeated runs.

## Testing

Run the test suite with:

```bash
npm test
```

The repository currently uses Vitest. If you want to run the suite directly, use:

```bash
vitest run
```

Focused test file:

```bash
vitest run tests/recommendationEngine.test.js
```

## Project Structure

```text
index.js                     CLI entrypoint
src/rebrickableApi.js        Rebrickable API client
src/recommendationEngine.js  Combination scoring and ranking
tests/                       Vitest tests
assets/                      Historical sample data
notes/                       Working notes
```

## Troubleshooting

> [!NOTE]
> The Rebrickable API can rate-limit or occasionally block requests. If a run stalls or fails, try again later, reduce candidate counts, or use the cache.

- Use `node . --help` to confirm your arguments.
- Use a smaller run like `node . --candidate-sets 5 --top 3` while debugging.
- Use `--max-unused` carefully: it filters the full ranked candidate pool before the final `top` selection.
- If cached set details seem outdated, lower `--cache-ttl-days` or run with `--no-cache`.

