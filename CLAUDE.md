# eg-history

Web page with the record of a community's weekly game night sessions, served from a folder of files (see
the README). Nothing to do with Discord: the record is written by the bot,
[eg-discord-bot](https://github.com/hwfwalton/eg-discord-bot), and this site only reads it. Deployed with
Docker Compose (see the README). Personal, uncommitted notes (servers, deployment) live in the gitignored
`CLAUDE.local.md`, if present.

## Relationship with the bot

- One way: the bot writes the folder (`sessions.csv`, `games.csv`, `next.json`), the site reads it and
  never writes to it (its compose file mounts the folder read-only). The site has no Discord token and must
  keep working while the bot is down.
- `src/record.ts` (+ its test) is kept identical to `src/features/history/record.ts` in eg-discord-bot,
  which writes these files with the same code. Change both together, and keep the append functions here
  even though the site doesn't use them.
- `next.json` is the bot's `NextSession` plus `updatedAt` (`next.ts`). It is optional: missing, unreadable,
  invalid or in the past (in `TIMEZONE`) means no next session is shown, never an error on the page.
- The CSV columns and `next.json`'s shape are the contract between the two repos. Change them only together
  with the bot, and keep reading older files.

## Stack and conventions

- TypeScript run **directly by Node 24** (type stripping): no build step, no bundler. `tsc` is type-check only.
  - Relative imports must use the `.ts` extension.
  - No enums, namespaces, or constructor parameter properties (`erasableSyntaxOnly`).
  - Use `import type` for type-only imports (`verbatimModuleSyntax`).
- **No runtime dependencies**: Node built-ins only (`node:http`, `node:fs`, `node:module`, `Intl`). Dev
  dependencies are TypeScript, Vitest and `@types/node`.
- Layout: `config.ts` (env), `store.ts` (reads the folder, caches for 30 s), `record.ts` (CSV parsing),
  `next.ts` (`next.json`), `time.ts` (dates in `TIMEZONE`), `stats.ts` (every number the page shows, typed by `types.ts`), `server.ts` (the
  request handler), `index.ts` (starts the server). Pure logic in small modules with tests; `index.ts` is
  the only file with side effects.
- The page's script (`src/client/`) is browser TypeScript with its own `tsconfig.json` (DOM types);
  `server.ts` strips the types with `node:module` and serves each file under its `.ts` name, so: erasable
  syntax only, `.ts` import extensions, and only `import type` from outside `client/`. The page only draws:
  everything is computed on the server.
- A strict CSP is sent (no inline scripts or styles), and everything from the record goes into the page as
  text (`textContent`), never as HTML. Only http(s) links from `games.csv` are kept.
- The server is read-only: requests are only ever matched against a fixed table of routes, never joined onto
  a folder. Requests under a Host name that isn't an IP address, `localhost` or in `ALLOWED_HOSTS` are
  refused (DNS rebinding).
- The record holds the community's own data: it lives in the gitignored `data/` (or wherever `DATA_DIR`
  points), never in git. Test data is made up.
- Vitest for tests, colocated as `*.test.ts`. Run `npm run check` before calling work done.
- CI (`.github/workflows/ci.yml`) runs `npm run check` on pushes and pull requests, and on `master` publishes
  the image to `ghcr.io/hwfwalton/eg-history` (`latest` and `sha-<commit>`), which the deployment pulls.
  Actions are pinned to commit SHAs with the version in a comment.
- Config comes only from env (`src/config.ts`). A bad setting stops the site at startup with a clear message.
- Check page changes visually with `scripts/screenshot.sh` (light and dark, each section touched) before
  calling them done.
