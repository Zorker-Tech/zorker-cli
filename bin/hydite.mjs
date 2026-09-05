#!/usr/bin/env node
import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname } from "node:path";

import {
  buildAuthorizeUrl,
  CLI_CALLBACK_PORT,
  CLI_CLIENT_ID,
  CLI_REDIRECT_URI,
  configPath,
  createPkce,
  DEFAULT_BASE_URL,
  errorMessage,
  normalizePublicPath,
  parseArguments,
} from "../src/core.mjs";

const HELP = `Zorker CLI

Usage:
  zorker login [--scopes scope,scope] [--base-url URL]
  zorker auth set-key KEY [--base-url URL]
  zorker logout
  zorker use PROJECT_REF
  zorker whoami
  zorker request METHOD /v1/path [--project REF] [--data JSON] [--file PATH] [--content-type TYPE]

Environment:
  HYDITE_API_KEY       Project API key; takes precedence over stored OAuth
  HYDITE_PROJECT_REF   Default project ref
  HYDITE_BASE_URL      Studio origin
  HYDITE_CONFIG_DIR    Override credential directory
`;

function fail(message, code = 1) {
  process.stderr.write(`Error: ${message}\n`);
  process.exitCode = code;
}

async function readConfig() {
  try {
    return JSON.parse(await readFile(configPath(), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
}

async function writeConfig(value) {
  const path = configPath();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  if (process.platform !== "win32") await chmod(path, 0o600);
}

function openBrowser(url) {
  const command =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  execFile(command[0], command[1], { windowsHide: true }, (error) => {
    if (error) process.stderr.write(`Open this URL in your browser:\n${url}\n`);
  });
}

async function oauthMetadata(baseUrl) {
  const response = await fetch(
    new URL("/.well-known/oauth-authorization-server", baseUrl),
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(errorMessage(body, "OAuth metadata is unavailable"));
  return body;
}

function requestedScopes(metadata, requested) {
  const supported = Array.isArray(metadata.scopes_supported)
    ? metadata.scopes_supported
    : [];
  const publicScopes = supported.filter(
    (scope) => scope !== "ide:access" && scope !== "ai:run",
  );
  if (!requested) return publicScopes;
  const selected = [
    ...new Set(
      String(requested)
        .split(/[\s,]+/)
        .filter(Boolean),
    ),
  ];
  const unknown = selected.filter((scope) => !publicScopes.includes(scope));
  if (unknown.length)
    throw new Error(`Unsupported scopes: ${unknown.join(", ")}`);
  return selected;
}

async function waitForAuthorization(expectedState) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.close();
      reject(new Error("OAuth authorization timed out"));
    }, 5 * 60_000);
    const server = createServer((request, response) => {
      const url = new URL(request.url || "/", CLI_REDIRECT_URI);
      if (url.pathname !== "/callback") {
        response.writeHead(404).end("Not found");
        return;
      }
      const state = url.searchParams.get("state");
      const code = url.searchParams.get("code");
      const oauthError = url.searchParams.get("error");
      if (state !== expectedState) {
        response
          .writeHead(400)
          .end("Invalid OAuth state. You may close this window.");
        clearTimeout(timeout);
        server.close();
        reject(new Error("OAuth state mismatch"));
        return;
      }
      if (!code || oauthError) {
        response
          .writeHead(400)
          .end("Authorization was denied. You may close this window.");
        clearTimeout(timeout);
        server.close();
        reject(new Error(oauthError || "Authorization code is missing"));
        return;
      }
      response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      response.end("VTSLX AO CLI is authorized. You may close this window.");
      clearTimeout(timeout);
      server.close();
      resolve(code);
    });
    server.on("error", reject);
    server.listen(CLI_CALLBACK_PORT, "127.0.0.1");
  });
}

async function exchangeToken(baseUrl, params) {
  const response = await fetch(new URL("/oauth/token", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(errorMessage(body, "OAuth token exchange failed"));
  return body;
}

async function login(flags) {
  const baseUrl = String(
    flags.base_url || process.env.HYDITE_BASE_URL || DEFAULT_BASE_URL,
  ).replace(/\/$/, "");
  const metadata = await oauthMetadata(baseUrl);
  const scopes = requestedScopes(metadata, flags.scopes);
  if (!scopes.length) throw new Error("At least one permission is required");
  const { verifier, challenge } = createPkce();
  const state = crypto.randomUUID();
  const callback = waitForAuthorization(state);
  const authorizeUrl = buildAuthorizeUrl({ baseUrl, scopes, state, challenge });
  process.stdout.write(`Opening Studio authorization…\n${authorizeUrl}\n`);
  openBrowser(authorizeUrl);
  const code = await callback;
  const tokens = await exchangeToken(baseUrl, {
    grant_type: "authorization_code",
    client_id: CLI_CLIENT_ID,
    redirect_uri: CLI_REDIRECT_URI,
    code_verifier: verifier,
    code,
    resource: new URL("/api", baseUrl).toString().replace(/\/$/, ""),
  });
  const current = await readConfig();
  await writeConfig({
    ...current,
    baseUrl,
    oauth: {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + Number(tokens.expires_in || 3600) * 1000,
      scopes: String(tokens.scope || "")
        .split(/\s+/)
        .filter(Boolean),
    },
  });
  process.stdout.write(
    `Authorized with ${
      String(tokens.scope || "")
        .split(/\s+/)
        .filter(Boolean).length
    } permissions.\n`,
  );
}

async function accessToken(config) {
  const apiKey = process.env.HYDITE_API_KEY || config.apiKey;
  if (apiKey) return apiKey;
  const oauth = config.oauth;
  if (!oauth?.refreshToken)
    throw new Error(
      "Not authenticated. Run zorker login or zorker auth set-key.",
    );
  if (oauth.accessToken && Number(oauth.expiresAt) > Date.now() + 30_000)
    return oauth.accessToken;
  const baseUrl =
    process.env.HYDITE_BASE_URL || config.baseUrl || DEFAULT_BASE_URL;
  const tokens = await exchangeToken(baseUrl, {
    grant_type: "refresh_token",
    client_id: CLI_CLIENT_ID,
    refresh_token: oauth.refreshToken,
    resource: new URL("/api", baseUrl).toString().replace(/\/$/, ""),
  });
  const next = {
    ...config,
    oauth: {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + Number(tokens.expires_in || 3600) * 1000,
      scopes: String(tokens.scope || "")
        .split(/\s+/)
        .filter(Boolean),
    },
  };
  await writeConfig(next);
  return next.oauth.accessToken;
}

async function apiRequest(positional, flags) {
  const [, methodInput, pathInput] = positional;
  if (!methodInput || !pathInput)
    throw new Error("Usage: hydite request METHOD /v1/path");
  if (flags.data && flags.file)
    throw new Error("Use only one of --data or --file");
  const config = await readConfig();
  const projectRef =
    flags.project || process.env.HYDITE_PROJECT_REF || config.projectRef;
  if (!projectRef)
    throw new Error(
      "Project ref is required; use --project or zorker use PROJECT_REF",
    );
  const token = await accessToken(config);
  const baseUrl = String(
    process.env.HYDITE_BASE_URL || config.baseUrl || DEFAULT_BASE_URL,
  ).replace(/\/$/, "");
  const path = normalizePublicPath(pathInput);
  const url = `${baseUrl}/api/v1/projects/${encodeURIComponent(projectRef)}/openlink${path}`;
  const headers = { authorization: `Bearer ${token}` };
  let body;
  if (flags.file) {
    body = await readFile(String(flags.file));
    headers["content-type"] = String(
      flags.content_type || "application/octet-stream",
    );
  } else if (flags.data) {
    JSON.parse(String(flags.data));
    headers["content-type"] = "application/json";
    body = String(flags.data);
  }
  const method = String(methodInput).toUpperCase();
  const response = await fetch(url, {
    method,
    headers,
    body: ["GET", "HEAD", "DELETE"].includes(method) ? undefined : body,
  });
  const text = await response.text();
  if (!response.ok) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
    throw new Error(
      errorMessage(parsed, `${response.status} ${response.statusText}`),
    );
  }
  process.stdout.write(
    text ? `${text}\n` : `${response.status} ${response.statusText}\n`,
  );
}

async function main() {
  const { positional, flags } = parseArguments(process.argv.slice(2));
  const command = positional[0];
  if (!command || command === "help" || flags.help) {
    process.stdout.write(HELP);
    return;
  }
  if (command === "login") return login(flags);
  if (command === "logout") {
    await rm(configPath(), { force: true });
    process.stdout.write("Logged out.\n");
    return;
  }
  if (command === "use") {
    const ref = positional[1];
    if (!/^[0-9a-f-]{36}$/i.test(ref || ""))
      throw new Error("A valid project ref is required");
    await writeConfig({ ...(await readConfig()), projectRef: ref });
    process.stdout.write(`Using project ${ref}.\n`);
    return;
  }
  if (command === "auth" && positional[1] === "set-key") {
    const key = positional[2];
    if (
      !/^zrk_(live|test)_[0-9a-f]{32}_[A-Za-z0-9_-]{40,64}$/.test(key || "")
    ) {
      throw new Error("Invalid project API key");
    }
    const current = await readConfig();
    await writeConfig({
      ...current,
      baseUrl: flags.base_url || current.baseUrl || DEFAULT_BASE_URL,
      apiKey: key,
      oauth: undefined,
    });
    process.stdout.write("Project API key stored.\n");
    return;
  }
  if (command === "whoami") {
    const config = await readConfig();
    process.stdout.write(
      `${JSON.stringify(
        {
          authentication:
            process.env.HYDITE_API_KEY || config.apiKey
              ? "api-key"
              : config.oauth
                ? "oauth"
                : "none",
          projectRef:
            process.env.HYDITE_PROJECT_REF || config.projectRef || null,
          scopes: config.oauth?.scopes || null,
          baseUrl:
            process.env.HYDITE_BASE_URL || config.baseUrl || DEFAULT_BASE_URL,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }
  if (command === "request") return apiRequest(positional, flags);
  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) =>
  fail(error instanceof Error ? error.message : String(error)),
);
