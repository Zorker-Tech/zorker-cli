import { createHash, randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_BASE_URL = "https://auth.hydite.com";
export const CLI_CLIENT_ID = "hydite-cli";
export const CLI_CALLBACK_PORT = 45891;
export const CLI_REDIRECT_URI = `http://127.0.0.1:${CLI_CALLBACK_PORT}/callback`;

export function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

export function createPkce() {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function configPath(env = process.env) {
  const root =
    env.HYDITE_CONFIG_DIR ||
    (process.platform === "win32"
      ? join(env.APPDATA || join(homedir(), "AppData", "Roaming"), "hydite")
      : join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "hydite"));
  return join(root, "credentials.json");
}

export function parseArguments(argv) {
  const positional = [];
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) {
      positional.push(value);
      continue;
    }
    const [rawName, inline] = value.slice(2).split("=", 2);
    const name = rawName.replaceAll("-", "_");
    if (inline !== undefined) {
      flags[name] = inline;
    } else if (argv[index + 1] && !argv[index + 1].startsWith("--")) {
      flags[name] = argv[++index];
    } else {
      flags[name] = true;
    }
  }
  return { positional, flags };
}

export function normalizePublicPath(value) {
  if (typeof value !== "string" || !value.startsWith("/v1/")) {
    throw new Error("API path must start with /v1/");
  }
  let url;
  try {
    url = new URL(value, "https://gateway.invalid");
  } catch {
    throw new Error("Invalid API path");
  }
  const decoded = decodeURIComponent(url.pathname);
  if (
    !decoded.startsWith("/v1/") ||
    decoded.includes("\\") ||
    decoded.includes("\0") ||
    decoded.split("/").includes("..")
  ) {
    throw new Error("Invalid API path");
  }
  if (decoded === "/v1/ai/run" || decoded.startsWith("/v1/ai/")) {
    throw new Error("AI Gateway is not available through the public CLI");
  }
  return `${url.pathname}${url.search}`;
}

export function buildAuthorizeUrl({ baseUrl, scopes, state, challenge }) {
  const url = new URL("/zorker/authorize", baseUrl);
  url.search = new URLSearchParams({
    client_id: CLI_CLIENT_ID,
    response_type: "code",
    redirect_uri: CLI_REDIRECT_URI,
    scope: scopes.join(" "),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: new URL("/api", baseUrl).toString().replace(/\/$/, ""),
  }).toString();
  return url.toString();
}

export function errorMessage(body, fallback) {
  if (!body || typeof body !== "object") return fallback;
  if (typeof body.error === "string")
    return body.error_description || body.error;
  if (body.error && typeof body.error.message === "string")
    return body.error.message;
  return fallback;
}
