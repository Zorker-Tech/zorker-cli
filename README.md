# Zorker CLI

[![npm version](https://img.shields.io/npm/v/@zorker/cli.svg)](https://www.npmjs.com/package/@zorker/cli)
[![CI](https://github.com/Zorker-Tech/zorker-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/Zorker-Tech/zorker-cli/actions/workflows/ci.yml)

Open-source command-line access to Hydite public project APIs.

> The `0.0.x` line is experimental. Commands and output formats may change before `0.1.0`.

## Requirements

- Node.js 20 or newer
- A Hydite account or project API key

## Install

```sh
npm install --global @zorker/cli
zorker help
```

You can also run it without installing:

```sh
npx @zorker/cli help
```

The package installs `zorker` as the primary command and `hydite` as a compatibility alias.

## Authentication

Authorize with OAuth 2.1 and PKCE:

```sh
zorker login
```

Or provide a project API key for automation:

```sh
export HYDITE_API_KEY=YOUR_PROJECT_API_KEY
```

Select a project and call a public capability:

```sh
zorker use YOUR_PROJECT_REF
zorker request GET /v1/browser/status
```

Run `zorker help` for all commands and environment variables. AI Gateway access is intentionally excluded from this public CLI.

## Current scope

Version `0.0.1` provides authentication, project selection, identity inspection, and generic public capability requests. High-level project creation and deployment commands are not included yet.

## Development

```sh
npm install
npm run build
npm test
npm pack --dry-run
```

## Security

The CLI is an untrusted public client. Authorization and scope enforcement happen on Hydite servers. Do not add platform credentials or service-role keys to this repository. See [SECURITY.md](SECURITY.md) for reporting instructions.

## License

Apache-2.0
