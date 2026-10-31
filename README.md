# Localfolio

Release notes and validation: [v0.2.0](docs/releases/v0.2.0.md) (earlier: [v0.1.0](docs/releases/v0.1.0.md)).

A self-hosted, single-owner portfolio tracker inspired by Ghostfolio. It reads a Ghostfolio JSON export, caches Yahoo Finance prices and USD/EUR rates with a Python `yfinance` worker, and shows EUR performance on a password-protected dashboard. Scope and acceptance criteria: [docs/user-stories.md](docs/user-stories.md).

Optional AI-client integration: [local MCP server setup and write safeguards](docs/mcp.md).

## Setup

You do not need to write code to use Localfolio. **Self-hosted** means the app and your financial records live on a computer you control. That computer must be running when you want to use the app.

### Before you start

- Install and open [Docker Desktop](https://www.docker.com/products/docker-desktop/) on Windows or macOS. On Linux, install [Docker Engine and the Compose plugin](https://docs.docker.com/engine/install/).
- Install [Git](https://git-scm.com/downloads) to download the project and get updates.
- Open a terminal: **PowerShell** on Windows or **Terminal** on macOS/Linux. This is the window where you type commands. Run one code block at a time and wait for it to finish.

Check that Docker is ready. Both commands should print a version number:

```sh
docker --version
docker compose version
```

Download the project and enter its folder:

```sh
git clone https://github.com/wenzelt/localfolio.git
cd localfolio
```

Run the remaining commands from this folder. If you downloaded a ZIP instead, extract it and open a terminal in the extracted folder. Git is needed for the update commands later in this guide.

**Node.js is not required to start the app or add data in the browser.** Install Node.js 26 on the host computer only if you want the optional command-line tools, backups or developer checks. Docker supplies the app's runtime.

1. Create the configuration. `.env` is git-ignored; see [.env.example](.env.example) for every variable.

   ```sh
   cp .env.example .env
   openssl rand -hex 32   # use as SESSION_SECRET
   ```

   On PowerShell, use `Copy-Item .env.example .env` instead of `cp`. You can also duplicate `.env.example` in your file manager and name the copy exactly `.env`, not `.env.txt`.

   Open `.env` in a text editor (for example, VS Code). It is a settings file: each line has a name on the left of `=` and its value on the right. Fill in these three values:

   | Setting | What to put there |
   | --- | --- |
   | `POSTGRES_PASSWORD` | A long, unique database password. You do not type this into the website. |
   | `APP_PASSWORD` | A different strong password. This is what you use to sign in to Localfolio. |
   | `SESSION_SECRET` | The random output from `openssl rand -hex 32` above. It protects your signed-in session. |

   If OpenSSL is unavailable, use a password manager to generate a random 64-character hexadecimal string for `SESSION_SECRET` (letters a–f and digits 0–9). Do not reuse one of your passwords for it. Save the file before continuing.

   **Keep `.env` private.** Do not share it, include it in screenshots, or commit it to Git. `.env` is git-ignored, meaning Git normally skips it. Leave the other settings at their defaults for your first local setup. If you already have a `.env`, keep it rather than overwriting it.

2. Start the database and the dashboard:

   ```sh
   docker compose --profile app up -d --build
   ```

   The dashboard is at <http://127.0.0.1:3000>. Sign in with the `APP_PASSWORD` from your `.env`. The dashboard stays empty until you add data in the next steps. PostgreSQL data lives in the named volume `portfolio-db` and survives restarts and rebuilds.

3. Add your data in the browser. Choose whichever route fits you:

   - **Coming from Ghostfolio?** Download the JSON file from Ghostfolio's activities export. Open <http://127.0.0.1:3000/import/ghostfolio>, select that file and choose **Import export**. JSON is a structured data file; you do not need to edit it. The page reports how many records were created or skipped. Uploading the identical export again adds nothing; an invalid export saves nothing.
   - **Just trying the app?** Download [the sample export](docs/examples/ghostfolio-export.sample.json) and upload it the same way. It contains fictional example data. Use a separate test installation if you do not want example records mixed with real ones.
   - **No Ghostfolio data?** Use **Manage accounts** and **Add buy** below, or **Import positions** for a spreadsheet.

   More about supported exports: [docs/local-import.md](docs/local-import.md). The optional command-line route is documented after the setup steps.

4. Create accounts with **Manage accounts** on the dashboard (`/accounts`): enter a name, EUR or USD currency, and an optional comment. Exact duplicate names are rejected. The page lists account activity and lets you permanently delete an account and all its transactions after typing its exact name. Deletion cannot be undone; back up first if needed.

   Details and validation rules: [docs/local-import.md](docs/local-import.md#manual-entry).
   Purchases can also be added in the web app (**Add buy**), with search-as-you-type symbol lookup: [docs/local-import.md](docs/local-import.md#adding-a-buy-in-the-web-app).

   Current holdings can be loaded from a spreadsheet with **Import positions** on the dashboard (`/import`). Download the CSV template there; its header is `account,symbol,quantity,average_price,currency,date`. You get a preview before anything is saved, and repeat uploads skip identical rows. Rules: [docs/local-import.md](docs/local-import.md#bulk-import-through-the-ui).

5. Fetch prices and rates with the worker ([docs/yfinance-worker.md](docs/yfinance-worker.md)). Until this has run once, the dashboard has holdings but no prices. The one-off refresh derives everything it needs from your ledger:

   ```sh
   docker compose run --rm --entrypoint python worker -m worker.refresh --dry-run   # preview the range, no network
   docker compose run --rm --entrypoint python worker -m worker.refresh
   ```

   The optional `scheduler` profile repeats the refresh every `REFRESH_INTERVAL_SECONDS` (default 86400) set in `.env`.
   For intraday prices, also start the `live` profile (`docker compose --profile live up -d live`): it re-fetches only the last week of prices for held symbols and today's FX every `LIVE_REFRESH_INTERVAL_SECONDS` (default 300), and the open dashboard reloads its data every minute while the tab is visible. Yahoo quotes can be delayed by up to about 15 minutes depending on the exchange.

Yahoo Finance is an unofficial source: it may rate limit or change without notice. A failed refresh keeps the previously cached values, and the dashboard warns when prices or exchange rates are more than seven days old.

### What the setup commands do

Docker runs separate **containers** (isolated processes) for the website, database and price worker. **Compose** starts these services together. A **profile** selects an optional service, such as `app` for the website. `--build` prepares its software, and `-d` leaves it running in the background. The first build can take several minutes.

The address `127.0.0.1` refers to this computer. Open the link in a browser on the same computer running Docker, not on a different phone or laptop. For a home server, read the networking section below before changing this setting.

A **volume** is Docker's persistent storage. Your `portfolio-db` volume holds the records even when the app container is replaced. It is not a backup: losing the computer or deleting the volume can still lose the data.

### Stop, restart and update

Stop the website and database without deleting your data:

```sh
docker compose --profile app stop
```

Start them again:

```sh
docker compose --profile app up -d
```

After Docker or the host restarts, the database, the web app and the optional `live` and `scheduler` services restart automatically. Anything you stopped yourself, for example with `docker compose stop` or `docker compose --profile app stop`, stays stopped until you start it again.

To update a Git-cloned installation, make a backup first, then run:

```sh
git pull --ff-only
docker compose --profile app up -d --build
```

If Git reports local changes or a conflict, stop and resolve that before continuing; do not discard files just to get the update through. If you also run the optional `live` or `scheduler` services, stop/start or rebuild them with their profiles too.

**Do not run `docker compose down -v`: it deletes the database volume and your saved records.** A normal stop or rebuild does not delete it.

### Optional: command-line import and manual entry

Skip this section if you use the browser. These commands run on the **host**, meaning the computer running Docker, rather than inside a container. Install Node.js 26 first and run `npm ci` from the project folder to install the command-line dependencies.

Add the following line to `.env`, replacing `<POSTGRES_PASSWORD>` (including its angle brackets) with your database password. If it contains URL-special characters such as `@`, `:`, `/` or `#`, percent-encode those characters in this URL only; keep the original password in `POSTGRES_PASSWORD`.

```sh
DATABASE_URL=postgres://portfolio:<POSTGRES_PASSWORD>@127.0.0.1:55432/portfolio
```

Create a `private` folder and save your Ghostfolio export there as `ghostfolio-export.json`. That folder is git-ignored. Then import it:

```sh
npm ci
npm run import:ghostfolio -- private/ghostfolio-export.json
```

The command prints `created`, `skipped` and `rejected` counts. Alternatively, record accounts and transactions by hand:

```sh
npm run ledger:add -- account --name "Broker" --currency EUR
npm run ledger:add -- transaction --account <id> --type BUY --date 2026-01-02 --currency USD --symbol EXAMPLE --quantity 0.5 --unit-price 80.25 --fee 1
```

Replace `<id>` with the account ID returned by the account command; `EXAMPLE` is a placeholder for a real Yahoo ticker. Do not paste the transaction command unchanged. A **ledger** is the list of accounts and transactions used to calculate your portfolio.

For installations that imported before the normalized ledger existed, `npm run migrate:snapshots` moves stored snapshots into the current tables. It is safe to repeat and leaves old snapshot rows untouched. New installations do not need this command.

## Health checks

- Web app: `GET /api/health` returns `200 {"status":"ok"}` when the database answers, otherwise `503 {"status":"unavailable"}`. It needs no login and reveals nothing else. Compose uses it as the `app` container health check.
- Database: Compose health-checks it with `pg_isready`.
- Status: `docker compose ps` shows `healthy` or `unhealthy` for each service.

## Troubleshooting

- **A page says `This page could not load` and shows an error reference (older builds show `Application error` with a `Digest` number):** the usual cause is that the database is not running, often after Docker or the host restarted. Run `docker compose ps`. If `db` is not running, start it with `docker compose up -d --wait db` and reload. Your data is in the `portfolio-db` volume, which a stop does not delete. If `db` is running, the app log names the cause: run `docker compose --profile app logs app --tail 50` and look for the line with the same number.
- **`port is already allocated` on 3000 or 55432:** another program uses the port. Stop it, or change the host port in `compose.yaml`.
- **`Incorrect password` on the login page:** use the `APP_PASSWORD` from `.env`. After changing `.env`, run `docker compose --profile app up -d` again so the container picks it up.
- **`docker` is not recognised or cannot connect:** check that Docker is installed and running. Reopen the terminal after installing it.
- **Compose cannot find its configuration file:** your terminal is in the wrong folder. Run `cd localfolio` (or open a terminal in the project folder).
- **`DATABASE_URL is required` from `npm run import:ghostfolio`:** add the `DATABASE_URL` line from the optional command-line section to `.env`. Check that the database is up with `docker compose ps`.
- **Prices missing or stale:** run the refresh in step 5 and read its summary. Yahoo can hit a rate limit; wait and try again, since failed refreshes keep the previous values.
- **Setup stops with `Set POSTGRES_PASSWORD`:** the variable is empty in `.env`.

## Upgrading

```sh
git pull
docker compose --profile app up -d --build
```

Back up first (below). Tables are created on demand with `CREATE TABLE IF NOT EXISTS`, so there are no separate migration steps in this version. Check `docker compose ps` and `/api/health` afterwards.

## Browser and iOS home screen icons

Localfolio includes a browser favicon and an opaque 180×180 iOS home screen icon based on the dashboard's chart mark. Next.js serves `app/favicon.ico`, `app/icon.svg` and `app/apple-icon.png` and adds their icon links to every page, including sign-in. These assets are included in the existing Docker build.

After pulling this change, rebuild the hosted app with `docker compose --profile app up -d --build`. On iPhone or iPad, remove any old Localfolio home screen shortcut, open the hosted site in Safari, then choose **Share → Add to Home Screen** again to pick up the icon. Browsers may cache the old favicon; reload the site if it has not updated yet.

## Reverse proxy and TLS

The dashboard speaks plain HTTP and binds to `127.0.0.1` by default (`APP_BIND_IP`). To reach it from other devices, put a TLS-terminating reverse proxy (Caddy, nginx, Traefik) in front and keep the app on loopback or a private network. Do not expose port 3000 or the database port directly to the internet. The session cookie is `HttpOnly` and `SameSite=Strict`, and gets the `Secure` flag when the request arrives over HTTPS, so make sure the proxy forwards the original `https` protocol.

## Backup and restore

Transfer the full portfolio state with PostgreSQL's portable custom-format `.dump` archive, using `pg_dump` for backup and `pg_restore` for restore inside the database container. It includes accounts and exclusions, all transactions and import records, tags, cached prices/FX and other database tables. IDs, exact decimals and timestamps are preserved. This is a full restore, not a CSV merge import.

From the project directory with the Compose database running (Node.js and Docker Compose required; no host PostgreSQL tools or npm install required):

```sh
npm run portfolio:backup -- /safe/path/portfolio-2026-10-21.dump
```

The backup is a consistent database snapshot, created with owner-only file permissions. Existing files are never overwritten; a failed dump removes its partial file. Backups are not encrypted.

On the server, use the same application revision and PostgreSQL 17 (or a compatible newer version). Copy the archive privately, configure `.env` separately, and start **only** the database. Keep the app and workers stopped until restore completes, so they cannot create tables or write data during restore:

```sh
docker compose up -d --wait db
npm run portfolio:restore -- /safe/path/portfolio-2026-10-21.dump
docker compose --profile app up -d --build app
```

Restore requires an empty `portfolio` database and runs in a single transaction: an error rolls back the restore. Existing data is refused, never deleted. If the target already has data, stop here and back it up; do not remove the volume to bypass this guard. Restore only trusted archives, because a PostgreSQL dump can contain executable database definitions.

For a separately created empty database, append its name after the archive path. Both commands default to `portfolio`. The equivalent without npm is `node scripts/portfolio-transfer.mjs backup|restore /path/file.dump [database]`.

The archive does **not** include application code, uncommitted UI changes, `.env`/passwords, browser theme/privacy preferences or external files. Deploy the code separately; copy secrets securely, never commit them. Start any worker services you normally use after checking the restored dashboard.

Check the result with `psql`:

```sh
docker compose exec db psql -U portfolio -d portfolio -c "SELECT count(*) FROM transactions"
```

Dumps contain your financial records and are not encrypted: store them as carefully as the database itself. Also keep your `.env` somewhere safe; it is not part of the dump.

## Development checks

```sh
npm run typecheck
npm run lint
npm run test:coverage
```

Tests use the synthetic-only `portfolio_test` database and need the Python test environment described in [docs/yfinance-worker.md](docs/yfinance-worker.md).

Browser checks use Playwright Chromium, Firefox and WebKit:

```sh
npx playwright install chromium firefox webkit
npm run test:e2e
```

The browser suite starts its own app at `http://127.0.0.1:3100`, signs in with throwaway test credentials, and creates then drops the `e2e_dashboard` schema in `portfolio_test`. It reads connection details from `.env` but replaces the database name; it does not use the real portfolio or app password. Keep port 3100 free and run only one browser suite at a time.
