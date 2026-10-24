# Dashboard deployment

The Next.js app provides a password login, EUR invested-security value, Modified Dietz return, an SVG percentage chart (filled area, dashed 0% baseline and a marker on the latest day) and Max / 1 year / YTD / month-to-date / week-to-date / 1 day selection. Choose a timeframe and click Apply.

## Configure

Add these to your existing `.env` without replacing the database settings:

```dotenv
APP_BIND_IP=192.168.1.10
APP_PASSWORD=replace-with-a-long-unique-password
SESSION_SECRET=replace-with-at-least-32-random-characters
```

Use your server's actual LAN IPv4 address. Without APP_BIND_IP, the app binds only to 127.0.0.1. Generate SESSION_SECRET locally, for example with `openssl rand -hex 32`; do not paste secrets into chat or commit them. Missing credentials fail closed. Changing SESSION_SECRET invalidates all sessions. Sessions expire after 24 hours.

## Start

From the project directory on your server:

```sh
docker compose --profile app up -d --build app
```

Open `http://<server-LAN-IP>:3000`. The app reads the stored ledger and cached prices/FX; it does not import data. The only page that calls Yahoo or writes is the buy form at `/buy` (see `docs/local-import.md`). Existing worker and scheduler services remain separate. The dashboard's database connection defaults to read-only transactions; the buy form's save endpoint uses a separate read-write connection.

For local development: `npm run dev`. For a local production build: `npm run build` then `npm start`. Next.js loads `.env`; DATABASE_URL configures local database access. Compose uses its own PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE settings for the app.

## Security and scope

- Trusted LAN only. Do not forward port 3000 from your router or expose this service publicly. There is no login rate limiter yet.
- HTTP sends passwords and cookies unencrypted. Use HTTPS through a trusted reverse proxy before using it outside a trusted LAN. Proxy/forwarded-protocol handling has not been verified; direct HTTP LAN access is the tested configuration.
- Cookies are HttpOnly, SameSite=Strict and expire after 24 hours. POSTs require a matching Origin/Host. HTTPS requests receive Secure cookies.
- Logout clears this browser's cookie; it does not revoke a copied token before expiry.
- The image runs as a non-root user. `.env` and private exports are excluded from the build context.

## Valuation limits

- This is invested-security value, not full account net worth: cash balances and dividends are not included.
- Accounts marked excluded in the export are omitted.
- Historical price gaps carry forward the prior close when a later close exists on or before the report date. Values during those gaps are estimates, not observed prices. Trailing prices and FX older than seven days remain unavailable; days before the first close are not backfilled. Unpriced symbols are excluded and listed, so displayed value may be incomplete.
- Yahoo closes and exported quantities can differ in split treatment; exchange proxies can differ from Stuttgart execution prices.
- Current data comes from the scheduled worker, not from page loads. The dashboard has no freshness indicator yet.
- Real-portfolio visual comparison and home-server/LAN deployment remain user verification steps.

## Verification completed

- 209 TypeScript/React/configuration tests pass; typecheck and Next.js production build pass.
- Coverage: 99.03% statements, 97.85% branches, 100% functions/lines in configured src scope. Thin Next adapters and CSS are not part of that coverage denominator.
- Local production HTTP flow checked against `portfolio_test` with synthetic credentials: redirect, login page, wrong password, signed login, authenticated dashboard, logout.
- Docker image built; disposable container checked for redirect, login, CSS, signed login, and UID 1000. Container had no database connection. Real Compose app/database deployment has not been run by the agent.
