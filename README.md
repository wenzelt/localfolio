# Localfolio

Release notes and validation: [v0.1.0](docs/releases/v0.1.0.md).

A self-hosted, single-owner portfolio tracker inspired by Ghostfolio. It reads a Ghostfolio JSON export, caches Yahoo Finance prices and USD/EUR rates with a Python `yfinance` worker, and shows EUR performance on a password-protected dashboard. Scope and acceptance criteria: [docs/user-stories.md](docs/user-stories.md).

## Setup

Requirements: Docker with Compose, and Node.js 26 for the checks below.

1. Create the configuration. `.env` is git-ignored; see [.env.example](.env.example) for every variable.

   ```sh
   cp .env.example .env
   openssl rand -hex 32   # use as SESSION_SECRET
   ```

   Set `POSTGRES_PASSWORD`, `APP_PASSWORD` and `SESSION_SECRET` in `.env`. Never commit it.

2. Start the database and the dashboard:

   ```sh
   docker compose --profile app up -d --build
   ```

   The dashboard is at <http://127.0.0.1:3000>. PostgreSQL data lives in the named volume `portfolio-db` and survives restarts and rebuilds.

3. Import your Ghostfolio export. This runs from the host and needs `DATABASE_URL` in `.env` (see [.env.example](.env.example)):

   ```sh
   npm ci
   npm run import:ghostfolio -- private/ghostfolio-export.json
   ```

   It prints `created`, `skipped` and `rejected` counts. Re-importing an identical export creates nothing, and an invalid export is rejected without saving anything. Details: [docs/local-import.md](docs/local-import.md).

   If you imported before the normalized ledger existed, move those stored snapshots into the new tables once with `npm run migrate:snapshots`. It is safe to repeat and leaves the old snapshot rows untouched.

4. Optionally record accounts and transactions by hand instead of (or alongside) importing:

   ```sh
   npm run ledger:add -- account --name "Broker" --currency EUR
   npm run ledger:add -- transaction --account <id> --type BUY --date 2026-01-02 --currency USD --symbol EXAMPLE --quantity 0.5 --unit-price 80.25 --fee 1
   ```

   Details and validation rules: [docs/local-import.md](docs/local-import.md#manual-entry).
   Purchases can also be added in the web app (**Add buy**), with search-as-you-type symbol lookup: [docs/local-import.md](docs/local-import.md#adding-a-buy-in-the-web-app).

5. Fetch prices and rates with the worker ([docs/yfinance-worker.md](docs/yfinance-worker.md)). The optional `scheduler` profile repeats the refresh every `REFRESH_INTERVAL_SECONDS` (default 86400) set in `.env`.
   For intraday prices, also start the `live` profile (`docker compose --profile live up -d live`): it re-fetches only the last week of prices for held symbols and today's FX every `LIVE_REFRESH_INTERVAL_SECONDS` (default 300), and the open dashboard reloads its data every minute while the tab is visible. Yahoo quotes can be delayed by up to about 15 minutes depending on the exchange.

Yahoo Finance is an unofficial source: it may rate limit or change without notice. A failed refresh keeps the previously cached values, and the dashboard warns when prices or exchange rates are more than seven days old.

## Health checks

- Web app: `GET /api/health` returns `200 {"status":"ok"}` when the database answers, otherwise `503 {"status":"unavailable"}`. It needs no login and reveals nothing else. Compose uses it as the `app` container health check.
- Database: Compose health-checks it with `pg_isready`.
- Status: `docker compose ps` shows `healthy` or `unhealthy` for each service.

## Upgrading

```sh
git pull
docker compose --profile app up -d --build
```

Back up first (below). Tables are created on demand with `CREATE TABLE IF NOT EXISTS`, so there are no separate migration steps in this version. Check `docker compose ps` and `/api/health` afterwards.

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
