#!/usr/bin/env node

import { access, readFile, writeFile } from "fs/promises";
import readline from "readline/promises";
import { stdin as input, stdout as output } from "process";

const CONFIG_PATH = "config.json";

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

function printUsage() {
  console.log("Usage:");
  console.log("  node scripts/setup-config.js [--config <path>] [--force] [--help]");
  console.log("");
  console.log("Description:");
  console.log("  Interactive helper that asks for email and password, fetches userToken from Rebrickable,");
  console.log("  picks the first available API key, and writes config.json.");
  console.log("");
  console.log("Flags:");
  console.log("  --config <path>  Path to config file. Default: config.json");
  console.log("  --force          Overwrite without confirmation prompt");
  console.log("  --help           Show this help and exit");
}

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function loadConfig(path) {
  if (!(await fileExists(path))) {
    return {};
  }

  const raw = await readFile(path, "utf-8");
  const parsed = JSON.parse(raw);

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${path} must be a JSON object.`);
  }

  return parsed;
}

async function promptYesNo(rl, message) {
  while (true) {
    const answer = (await rl.question(`${message} [y/N]: `)).trim().toLowerCase();
    if (answer === "y" || answer === "yes") {
      return true;
    }
    if (answer === "" || answer === "n" || answer === "no") {
      return false;
    }

    console.log("Please answer with y/yes or n/no.");
  }
}

async function promptHidden(queryText) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const stdout = process.stdout;

    let value = "";
    const originalRawMode = stdin.isRaw;

    function cleanup() {
      stdin.removeListener("data", onData);
      if (stdin.isTTY) {
        stdin.setRawMode(Boolean(originalRawMode));
      }
      stdout.write("\n");
    }

    function onData(char) {
      const ch = String(char);

      if (ch === "\u0003") {
        cleanup();
        reject(new Error("Input cancelled by user."));
        return;
      }

      if (ch === "\r" || ch === "\n") {
        cleanup();
        resolve(value);
        return;
      }

      if (ch === "\u007f" || ch === "\b") {
        if (value.length > 0) {
          value = value.slice(0, -1);
          stdout.write("\b \b");
        }
        return;
      }

      value += ch;
      stdout.write("*");
    }

    stdout.write(queryText);

    if (stdin.isTTY) {
      stdin.setRawMode(true);
    }
    stdin.setEncoding("utf8");
    stdin.resume();
    stdin.on("data", onData);
  });
}

async function fetchUserToken(emailOrUsername, password, apiKey) {
  const endpoint = "https://rebrickable.com/api/v3/users/_token/";

  const formBody = new URLSearchParams({
    username: emailOrUsername,
    password,
  });

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `key ${apiKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: formBody,
  });

  const bodyText = await response.text();
  let body;

  try {
    body = bodyText ? JSON.parse(bodyText) : {};
  } catch {
    body = { detail: bodyText || "Unknown response body" };
  }

  if (!response.ok) {
    if (response.status === 401 && /Authentication credentials were not provided/i.test(body.detail ?? "")) {
      throw new Error(
        "Failed to obtain Rebrickable user token: API key is required for this request. Set REBRICKABLE_API_KEY or provide apiKey in config."
      );
    }

    throw new Error(`Failed to obtain Rebrickable user token (${response.status}): ${body.detail ?? "Unknown error"}`);
  }

  if (!body.user_token) {
    throw new Error("Rebrickable response did not include user_token.");
  }

  return body.user_token;
}

function resolveFirstAvailableApiKey(existingConfig) {
  return (
    process.env.REBRICKABLE_API_KEY ??
    existingConfig.apiKey ??
    existingConfig["api-key"] ??
    null
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help === "true" || args.h === "true") {
    printUsage();
    return;
  }

  const configPath = args.config ?? CONFIG_PATH;
  const force = args.force === "true";

  const rl = readline.createInterface({ input, output });

  try {
    const existingConfig = await loadConfig(configPath);

    const hasExistingValues = Object.keys(existingConfig).length > 0;
    if (hasExistingValues && !force) {
      const shouldOverwrite = await promptYesNo(
        rl,
        `${configPath} already contains data. Overwrite credentials?`
      );
      if (!shouldOverwrite) {
        console.log("Aborted. Existing config was not modified.");
        return;
      }
    }

    const emailOrUsername = (await rl.question("Rebrickable email (or username): ")).trim();
    if (!emailOrUsername) {
      throw new Error("Email/username is required.");
    }

    let apiKey = resolveFirstAvailableApiKey(existingConfig);
    if (!apiKey) {
      console.log("No API key found in environment or existing config.");
      const enteredApiKey = (await rl.question("Enter Rebrickable API key: ")).trim();
      if (!enteredApiKey) {
        throw new Error("API key is required to request userToken from Rebrickable.");
      }
      apiKey = enteredApiKey;
    }

    const password = await promptHidden("Rebrickable password: ");
    if (!password) {
      throw new Error("Password is required.");
    }

    console.log("Requesting user token from Rebrickable...");
    const userToken = await fetchUserToken(emailOrUsername, password, apiKey);

    const nextConfig = {
      ...existingConfig,
      apiKey,
      userToken,
    };

    await writeFile(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`, "utf-8");

    console.log(`Saved ${configPath}.`);
    console.log("Email and password were used only for this request and were not stored.");
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  console.error(`Setup failed: ${error.message}`);
  process.exitCode = 1;
});
