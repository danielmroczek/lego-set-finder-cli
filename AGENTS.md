# AGENTS.md

## Project Overview

`lego-set-finder-cli` is a Node.js CLI that analyzes a Rebrickable part list and suggests likely LEGO set combinations that maximize use of owned parts and minimize missing parts to buy.

Current behavior:
- Reads Rebrickable credentials and a part-list ID from CLI, environment variables, or `config.json`.
- Fetches owned parts from the Rebrickable API.
- Builds candidate sets from part/color matches, then ranks set combinations with a beam-search heuristic.
- Caches detailed set-part responses in lowdb at `.cache/set-parts-cache.json`.
- Writes ranked results to `result.json`.

Key stack:
- Node.js with ESM modules.
- `lowdb` for local JSON cache storage.
- `vitest` for unit tests.

## Repository Map

- `index.js`: CLI entrypoint, argument/config parsing, API orchestration, cache handling, and output writer.
- `src/rebrickableApi.js`: Rebrickable API client with pagination, retry, and HTTP error handling.
- `src/recommendationEngine.js`: owned-part map building, combination scoring, and ranking logic.
- `tests/recommendationEngine.test.js`: unit tests for scoring and ranking.
- `assets/`: source inventory/sample data files kept for historical context.
- `notes/`: working notes and analysis history.

## Setup Commands

- Install dependencies: `npm install`
- Optional clean install: `npm ci`
- Run the CLI: `node .`
- Show help: `node . --help`

Prerequisites:
- Node.js 18+ is recommended.

Required runtime inputs:
- `--api-key` or `REBRICKABLE_API_KEY`
- `--user-token` or `REBRICKABLE_USER_TOKEN`
- `--part-list-id`

## Development Workflow

- Prefer small, local edits. Most work should stay in `index.js` or `src/recommendationEngine.js`.
- Keep the CLI behavior verifiable with a quick `node . --help` or a small `--candidate-sets` run.
- The configuration precedence is: CLI arguments > environment variables > `config.json`.
- Default `config.json` is optional; missing file is allowed.

Useful CLI flags:
- `--no-cache`: bypass cache reads but still refresh the cache with API results.
- `--cache-ttl-days <n>`: cache TTL in days for set-part responses. Default is `7`.
- `--max-unused <n>`: filter final recommendations so unused owned bricks stay at or below `n%`.

Common iteration loop:
1. Make the smallest change that addresses the behavior.
2. Run `node . --help` if you touched CLI parsing or docs.
3. Run a focused CLI invocation such as `node . --candidate-sets 5 --top 3`.
4. Run `npm test` when ranking or scoring logic changes.

## Testing Instructions

- Run all tests: `npm test`
- Run one test file: `vitest run tests/recommendationEngine.test.js`
- Test location: `tests/**/*.test.js`

Current coverage focus:
- `evaluateCombination` metrics.
- `rankRecommendations` ordering and filtering behavior.

Testing expectations:
- Add or update tests when changing scoring, ranking, or filtering behavior.
- Keep at least one happy-path test and one edge-case test for algorithm changes.

## Code Style and Conventions

- Use ESM `import`/`export` syntax.
- Keep indentation consistent with the existing source files, which use 2 spaces in `index.js` and related CLI code.
- Prefer clear, explicit helper functions over deeply nested logic.
- Keep functions pure where practical, especially in ranking and scoring code.
- Avoid unnecessary dependencies. `lowdb` was added specifically for local cache persistence.

Naming and organization:
- Put API/client logic in `src/rebrickableApi.js`.
- Put ranking/scoring logic in `src/recommendationEngine.js`.
- Keep CLI-only orchestration in `index.js`.

## Build and Deployment

- There is no build step.
- There is no deployment pipeline in this repository.
- Runtime artifacts are local files: `result.json` and `.cache/set-parts-cache.json`.

If build or release automation is introduced later, document:
- exact build command,
- output artifacts,
- environment requirements,
- release/deployment steps.

## Security and Secrets

- Do not commit real Rebrickable credentials.
- Prefer environment variables for secrets when possible.
- Treat all API responses as untrusted input.
- Keep local config files such as `config.json` out of version control unless they are sanitized examples.

## Pull Request Guidelines for Agents

- Keep diffs focused on one behavior change.
- Validate CLI changes with `node . --help` and one representative run.
- Validate ranking changes with `npm test`.
- Summarize user-visible behavior changes in the PR description.
- Mention any limitations intentionally left for later, such as API rate limiting or cache behavior.

## Debugging and Troubleshooting

Common issues:
- Rebrickable may rate-limit or intermittently block requests.
- Large candidate sets can make ranking slow.
- Cache entries in `.cache/set-parts-cache.json` can be bypassed with `--no-cache`.

Useful debug patterns:
- Use smaller values like `--candidate-sets 5 --top 3` when iterating.
- Use `--no-cache` to confirm API behavior separately from cache behavior.
- Use `--max-unused` carefully; it filters the ranked combinations before the final `top` selection.

## Agent Working Agreement

- Keep the CLI reliable and understandable before adding broader features.
- Prefer correctness and observability over cleverness.
- Update this file when commands, cache behavior, or file layout change.
