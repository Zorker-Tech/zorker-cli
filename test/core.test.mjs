import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  buildAuthorizeUrl,
  DEFAULT_BASE_URL,
  normalizePublicPath,
  parseArguments,
} from "../src/core.mjs";

const execFileAsync = promisify(execFile);

test("parses positional arguments and flags", () => {
  assert.deepEqual(
    parseArguments([
      "request",
      "POST",
      "/v1/browser/actions/screenshot",
      "--project",
      "ref",
      '--data={"a":1}',
    ]),
    {
      positional: ["request", "POST", "/v1/browser/actions/screenshot"],
      flags: { project: "ref", data: '{"a":1}' },
    },
  );
});

test("builds an OAuth 2.1 PKCE authorization URL", () => {
  const url = new URL(
    buildAuthorizeUrl({
      baseUrl: "https://auth.hydite.com",
      scopes: ["openid", "browser:run"],
      state: "state",
      challenge: "challenge",
    }),
  );
  assert.equal(url.pathname, "/zorker/authorize");
  assert.equal(url.searchParams.get("client_id"), "hydite-cli");
  assert.equal(url.searchParams.get("scope"), "openid browser:run");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("resource"), "https://auth.hydite.com/api");
});

test("accepts public paths and rejects traversal and AI Gateway", () => {
  assert.equal(
    normalizePublicPath("/v1/browser/capabilities?limit=1"),
    "/v1/browser/capabilities?limit=1",
  );
  assert.throws(() => normalizePublicPath("/v1/ai/run"), /not available/);
  assert.throws(
    () => normalizePublicPath("/v1/%2e%2e/ai/run"),
    /Invalid API path/,
  );
});

test("uses the public auth origin by default", () => {
  assert.equal(DEFAULT_BASE_URL, "https://auth.hydite.com");
});

test("published binary exposes help and reports an isolated default configuration", async () => {
  const configDir = await mkdtemp(join(tmpdir(), "zorker-cli-test-"));
  try {
    const binary = new URL("../bin/hydite.mjs", import.meta.url);
    const help = await execFileAsync(
      process.execPath,
      [binary.pathname, "help"],
      {
        env: { ...process.env, HYDITE_CONFIG_DIR: configDir },
      },
    );
    assert.match(help.stdout, /zorker login/);
    assert.match(help.stdout, /zorker request/);

    const whoami = await execFileAsync(
      process.execPath,
      [binary.pathname, "whoami"],
      {
        env: { ...process.env, HYDITE_CONFIG_DIR: configDir },
      },
    );
    assert.deepEqual(JSON.parse(whoami.stdout), {
      authentication: "none",
      projectRef: null,
      scopes: null,
      baseUrl: "https://auth.hydite.com",
    });
  } finally {
    await rm(configDir, { recursive: true, force: true });
  }
});

test("package metadata is publishable under the requested name and version", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(manifest.name, "@zorker/cli");
  assert.equal(manifest.version, "0.0.1");
  assert.equal(manifest.license, "Apache-2.0");
  assert.equal(manifest.publishConfig.access, "public");
  assert.equal(manifest.bin.zorker, "bin/hydite.mjs");
});
