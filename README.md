# eg-history

A web page with the record of a community's weekly game night: the most played games, favourites that are
due a return, styles of game by year, every week at a glance, and searchable tables of every session and
game. It is served from a folder of plain files (two CSV files and an optional `next.json`) by a small
Node server with no dependencies, written in TypeScript all the way to the page's own script, with no build
step (the server strips the types). The record is kept up to date by
[eg-discord-bot](https://github.com/hwfwalton/eg-discord-bot), which reads the community's Discord
announcements; this site never talks to Discord and only reads the files, so it keeps working while the
bot is down.

## The record

The record is two CSV files in `DATA_DIR` (default `data`, which git ignores). Edit them in any spreadsheet
app; the page picks up changes within half a minute.

- `sessions.csv`, one row per week:

  | Column | Meaning |
  | --- | --- |
  | `Session` | Its name, e.g. `EG289`. Empty for weeks off. |
  | `Date` | `YYYY-MM-DD` (dates a spreadsheet rewrote as `M/D/YYYY` are read too). The only required column. |
  | `Start` | Start time, as text. |
  | `Status` | `Played`, `Cancelled`, `No session` or `Special` (listed, but not counted). Empty means played. |
  | `Games` | What was played. Separate several games with `;`. |
  | `Planned` | What was announced, if something else was played. |
  | `Cost`, `Announced by`, `Source`, `Notes` | Free text. A cost starting with "Free", "Host" (gave out keys) or a price feeds the cost chart. |

- `games.csv` (optional), one row per game: `Game`, `Style` (your own genre label, e.g. "Social
  deduction"), `Mode` (Competitive, Co-op, …), `Where`, `Link`, `Tags` (comma-separated), `Developer`. A
  game without a row is shown as "Uncategorized".

Columns can be in any order and extra columns are ignored. Rows the page can't read (a bad date, say) are
skipped and listed at the bottom of the page, with their line numbers. So is a row dated after today
(usually a typo in the year).

The page offers the record as downloads (`/sessions.csv`, `/games.csv`) with the worked-out columns added
(times played, style, days since last played).

### How the bot keeps it up to date

With its game night feature on and `HISTORY_DIR` pointing at this folder,
[eg-discord-bot](https://github.com/hwfwalton/eg-discord-bot) works out what happened once each session
has started (from that week's announcement, or a "no official EG" post) and appends a row to
`sessions.csv`, marked `Announcement (auto)` in `Source`; the page shows those rows as not checked by
hand. A game it hasn't seen is added to `games.csv` without a style, and the page lists the games that
still need one. The bot only ever adds rows at the end: to correct a row, edit the file.

The relationship is one-way: the bot writes the folder, the site reads it. Without the bot the page simply
shows the files as they are.

### next.json

The bot also keeps `next.json` up to date with the upcoming session, which the page shows in its header:

```json
{
  "updatedAt": "2026-11-25T19:00:00.000Z",
  "date": "2026-11-28",
  "start": "10:30am",
  "status": "announced",
  "session": "EG290",
  "games": ["Spellsworn"]
}
```

`status` is `announced`, `cancelled` or `unannounced`; `session` is optional, and `games` only counts for an
announced session. The file is optional: when it is missing, isn't valid, or its `date` is before today
(in `TIMEZONE`), the header just doesn't show a next session.

## Configuration

Settings come from environment variables (see [`.env.example`](.env.example)). All of them are optional.

| Variable | Meaning |
| --- | --- |
| `PORT` | Port the page is served on (default `8480`) |
| `HOST` | Interface to listen on (default `127.0.0.1`: this machine only; the compose file sets `0.0.0.0`) |
| `DATA_DIR` | Folder with the record (default `data`) |
| `TITLE` | The page's heading, e.g. your community's name (default "Game night history") |
| `TIMEZONE` | IANA timezone of the sessions (default `America/Los_Angeles`): decides what "today" is |
| `ALLOWED_HOSTS` | Comma-separated host names the page may be opened under, besides IP addresses and `localhost` |
| `RELOAD` | `1` re-reads the page's own files on every request (for development) |

A bad `PORT` or `TIMEZONE` stops the site at startup with a message saying which setting is wrong.

## Local development

Requires Node 24+.

```bash
npm install
cp .env.example .env     # optional: every setting has a default
mkdir -p data            # then put sessions.csv and games.csv (and next.json, if you have one) in it
npm run dev              # serves http://localhost:8480/, restarts on file changes
npm run check            # type-check + tests
```

`npm run dev` sets `RELOAD=1`, so edits to the page's files (`src/client/`) show up on the next reload of
the browser tab; edits to the server restart it.

`scripts/screenshot.sh <url> <out.png> [width] [height]` takes a screenshot with headless Chrome (macOS)
and prints any console errors or Content-Security-Policy refusals, e.g. to check a section in dark mode:
`scripts/screenshot.sh "http://127.0.0.1:8480/?theme=dark#weeks" /tmp/weeks.png`.

## Deploying with Docker Compose

GitHub Actions ([`ci.yml`](.github/workflows/ci.yml)) runs the type-check and tests on every push and pull
request. When they pass on `master`, it builds the image and publishes it as `ghcr.io/hwfwalton/eg-history`,
tagged `latest` and `sha-<commit>` (x86-64 only). So the machine running the site needs only
`docker-compose.yml` and a `.env`, not the source:

1. Put [`docker-compose.yml`](docker-compose.yml) in a folder on that machine.
2. Next to it, create a `.env` with the settings you want (see `.env.example`): usually `TITLE`, and
   `RECORD_DIR`, the folder with the record. It is mounted read-only; the files in it must be readable by
   user 1000 (the image's `node` user).
3. Run `docker compose up -d`, then check `docker compose logs -f` for `Serving http://…`.

The page is then at `http://<host>:<PORT>/` for everything that can reach the host. To keep it to the host
itself, write the port as `"127.0.0.1:${PORT:-8480}:${PORT:-8480}"` in the compose file.

To update, push to `master`, wait for the CI run to finish, and run `docker compose up -d` again: the
compose file's `pull_policy: always` fetches the newest image. To roll back, change `latest` to an older
commit's `sha-…` tag (listed on the package's GitHub page).

The host pulls the image without logging in, so the package must be public. A package published from a
public repo has been public so far; if yours is private, make it public in the package's settings on
GitHub, or log the host in to ghcr.io. In a fork, Actions publishes `ghcr.io/<you>/<repo>` instead: point
`image:` at it. To build on the host from source instead, replace `image:` and `pull_policy:` with
`build: .`.

### Public access through a Cloudflare Tunnel

To let people outside your network open the page without opening a port on your router, run Cloudflare's
`cloudflared` next to the site. It makes an outbound connection to Cloudflare, which serves the page at
your domain over HTTPS (your home IP address stays private). You need a free Cloudflare account and a
domain whose DNS is on Cloudflare.

1. In the Cloudflare dashboard: **Zero Trust → Networks → Tunnels → Create a tunnel → Cloudflared**. Copy
   the token from the install command it shows (the long string starting `eyJ`); don't run the command.
2. Add a public hostname, e.g. `history.example.com`, with service type **HTTP** and URL `history:8480`
   (the site's service name and port inside the compose project; plain HTTP is right here, because that
   hop stays inside the host and Cloudflare provides the HTTPS).
3. In the `.env`: `TUNNEL_TOKEN=<the token>` and `ALLOWED_HOSTS=history.example.com` (the site refuses
   requests under names it doesn't know). Keep the `.env` readable by you only (`chmod 600`): the token
   lets anyone run your tunnel.
4. Uncomment the `tunnel` service in `docker-compose.yml` and run `docker compose up -d`.

The page has no login. To limit it to certain people, add a Cloudflare Access application for the hostname
(**Zero Trust → Access → Applications**). The tunnel doesn't need the `ports` line; remove it if the page
should only be reachable through Cloudflare.

### On a UGREEN NAS (UGOS)

The site is its own Docker project, next to the bot's, and reads the bot's record folder:

- Make a folder in the NAS's `docker` shared folder (e.g. `/volume1/docker/eg-history`) and create the
  `.env` there, with `RECORD_DIR` set to the absolute path of the bot's history folder (e.g.
  `RECORD_DIR=/volume1/docker/eg-discord-bot/history`), plus `PORT`, `TITLE`, `TIMEZONE` and
  `ALLOWED_HOSTS` as needed. The site mounts that folder read-only, so it can never change the record.
- In UGOS: **Docker → Project → Create**, set the storage path to that folder, paste `docker-compose.yml`
  into **Compose configuration**, and deploy. UGOS saves it as `docker-compose.yaml` in the folder.
- To update: once the CI run has finished, open the project's **Compose configuration** tab and click
  **Redeploy**. The compose file's `pull_policy: always` makes it fetch the newest image.
- UGOS's editor auto-indents YAML as you type, which can break a pasted file. If it does, paste the same
  configuration as one line of JSON instead (Compose accepts JSON).

If you build from source on the NAS instead, note that files from a shared folder reach the image as mode
0770; the Dockerfile makes them readable for the unprivileged `node` user.

## Who can see it

Anyone who can reach the port. There is no login, and the page shows the `Notes` column, so keep it on
your own network unless everything in the record is fine to publish. By default it listens on this machine
only (`HOST`).

The page answers under an IP address or `localhost`. To open it under a name (`nas.local`, a domain behind
a reverse proxy), list the name in `ALLOWED_HOSTS`. Requests under any other name are refused: that stops a
web page elsewhere from reading this one through a domain it controls that it points at your network
(DNS rebinding). The server only answers `GET` and `HEAD` for its own fixed set of files, and sends a strict
Content Security Policy.

## License

MIT (see [LICENSE](LICENSE)).
