# Contributing

Thanks for helping improve Zorker CLI.

## Development

Use Node.js 20 or newer:

```sh
npm install
npm run build
npm test
npm pack --dry-run
```

Keep changes focused and add tests for new commands, argument parsing, authentication behavior, and request construction. Never commit access tokens, project API keys, service-role credentials, or generated credential files.

## Pull requests

Explain the user-facing behavior, include verification steps, and call out compatibility or security implications. By submitting a contribution, you agree that it is licensed under Apache-2.0.
