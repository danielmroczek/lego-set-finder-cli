const API_BASE_URL = "https://rebrickable.com/api/v3";

function wait(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export class RebrickableApi {
	constructor(apiKey, options = {}) {
		if (!apiKey) {
			throw new Error("Missing Rebrickable API key.");
		}

		this.apiKey = apiKey;
		this.baseUrl = options.baseUrl ?? API_BASE_URL;
		this.maxRetries = options.maxRetries ?? 5;
	}

	async #request(path, query = {}) {
		const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
		const baseUrlWithSlash = this.baseUrl.endsWith("/")
			? this.baseUrl
			: `${this.baseUrl}/`;
		const url = new URL(normalizedPath, baseUrlWithSlash);
		Object.entries(query).forEach(([key, value]) => {
			if (value !== undefined && value !== null) {
				url.searchParams.set(key, String(value));
			}
		});

		for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
			const response = await fetch(url, {
				headers: {
					Authorization: `key ${this.apiKey}`,
					Accept: "application/json",
					"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
				},
			});

			if (response.status === 429 && attempt < this.maxRetries) {
				const retryAfter = response.headers.get("retry-after");
				const seconds = Number.parseInt(retryAfter ?? "", 10);
				const waitMs = Number.isFinite(seconds) ? seconds * 1000 : 1500;
				await wait(waitMs);
				continue;
			}

			if (!response.ok) {
				let detail = "Unknown API error";
				const errorText = await response.text();
				const isCloudflareChallenge =
					response.status === 403 &&
					errorText.includes("Just a moment...") &&
					errorText.includes("challenges.cloudflare.com");

				if (isCloudflareChallenge) {
					throw new Error(
						"Rebrickable API blocked this request with a Cloudflare challenge (HTTP 403). Try again later, change network/VPN, and verify request limits (max ~1 req/sec)."
					);
				}

				if (errorText) {
					try {
						const errorJson = JSON.parse(errorText);
						detail = errorJson.detail ?? JSON.stringify(errorJson);
					} catch {
						detail = errorText;
					}
				}

				throw new Error(`Rebrickable API error ${response.status}: ${detail}`);
			}

			return response.json();
		}

		throw new Error("Rebrickable API error: retry limit exceeded.");
	}

	async #getAllPages(path, query = {}) {
		const allResults = [];
		let page = 1;

		while (true) {
			const response = await this.#request(path, {
				...query,
				page,
			});

			if (!Array.isArray(response.results)) {
				throw new Error(`Unexpected paginated response for ${path}`);
			}

			allResults.push(...response.results);

			if (!response.next) {
				break;
			}

			page += 1;
		}

		return allResults;
	}

	async getPartListParts(userToken, listId) {
		return this.#getAllPages(
			`/users/${encodeURIComponent(userToken)}/partlists/${encodeURIComponent(listId)}/parts/`,
			{
				page_size: 1000,
				inc_part_details: 1,
				inc_color_details: 1,
			}
		);
	}

	async getSetsForPartColor(partNum, colorId) {
		return this.#getAllPages(
			`/lego/parts/${encodeURIComponent(partNum)}/colors/${encodeURIComponent(colorId)}/sets/`,
			{
				page_size: 1000,
			}
		);
	}

	async getSetParts(setNum) {
		return this.#getAllPages(`/lego/sets/${encodeURIComponent(setNum)}/parts/`, {
			page_size: 1000,
			inc_part_details: 1,
			inc_color_details: 1,
		});
	}
}
