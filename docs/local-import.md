# Local Ghostfolio ingestion

The supplied export is validated and stored in normalized PostgreSQL tables (`accounts`, `account_balances`, `tags`, `transactions`, `transaction_tags`). Every report, the dashboard and the price-refresh worker read these tables.

## Command line

```sh
npm run import:ghostfolio -- private/ghostfolio-export.json
```

Prints `created`, `skipped` and `rejected` rows with account and activity counts. `created` rows are new; `skipped` rows were already stored, so re-importing an identical export creates nothing and an extended export adds only its new activities. An invalid export exits non-zero with `Import rejected: …` and saves nothing, and a database error rolls the whole import back. Requires `DATABASE_URL`.

## Manual entry

```sh
npm run ledger:add -- account --name "Broker" --currency EUR [--comment "…"]
npm run ledger:add -- accounts
npm run ledger:add -- transaction --account <id> --type BUY --date 2026-01-02 --currency USD \
  --symbol EXAMPLE --quantity 0.5 --unit-price 80.25 [--fee 1] [--comment "…"] [--force]
npm run ledger:add -- transaction --account <id> --type DEPOSIT --date 2026-01-02 --currency EUR --amount 100
```

`accounts` prints one line per account (id, name, currency, comment, tab separated), so the id for `--account` can be copied from it. The other commands print `account` or `transaction` and the new id. Everything is validated before anything is saved, and a rejected entry exits non-zero with the reason.

- Types: `BUY`, `SELL`, `DIVIDEND`, `DEPOSIT`, `WITHDRAWAL`, `FEE`. Currencies: `EUR` and `USD`, and an account may hold transactions in either.
- Quantities, prices, fees and amounts are plain decimals (`0.1234567891`) kept exactly; negatives, zero quantities and exponent notation are rejected.
- Dates are `YYYY-MM-DD` (UTC midnight) or a full ISO timestamp with `Z` or an offset; impossible dates such as `2026-02-30` are rejected.
- `BUY` and `SELL` need `--symbol`, `--quantity` and `--unit-price`; the fee defaults to 0. `DEPOSIT`, `WITHDRAWAL`, `FEE` and `DIVIDEND` take `--amount` instead (a dividend may also name `--symbol`).
- A `SELL` is rejected if, at any point in time, it would sell more than the account holds of that symbol. This also stops a backdated sale from leaving a later sale uncovered.

- A new position is the first `BUY` of a symbol in an account, and an increase is another `BUY` of the same symbol in the same account; positions are derived from the ledger, so there is nothing else to update.
- A transaction identical to a saved one (same account, type, symbol, currency, quantity, price, fee and timestamp, compared by value so `2.0` equals `2`) is rejected as a likely double entry. A genuine repeat, such as two equal fills in the same minute, is saved with `--force`; a `--comment` helps tell them apart.
- A bought symbol is priced only after the next worker refresh. When a `BUY` names a symbol with no cached quote or price history, `ledger:add` prints a hint on stderr (stdout still carries only the new id). The entry is saved either way. Symbols are not checked against Yahoo at entry: the refresh handles each symbol separately and lists one it cannot fetch as `N failed: SYMBOL (reason)` in its summary, so a mistyped ticker leaves that one position unvalued without affecting the others.

Cash movements are stored but are not yet part of positions, performance or cash totals. Purchases can also be entered in the web app (see Adding a buy in the web app below); every other type is still entered here.

## Migrating earlier snapshots

Earlier versions stored each import as a JSON document in `ghostfolio_imports`. Move that data into the normalized tables once:

```sh
npm run migrate:snapshots
```

Prints `snapshots`, then `created` and `skipped` account and activity counts. Each stored snapshot is replayed through the normal import in creation order, so overlapping snapshots merge, a repeat run only skips, and the `ghostfolio_imports` rows are never changed or deleted. With no legacy table it does nothing. A snapshot that cannot be imported stops the run with `Snapshot <id> cannot be migrated: …`; snapshots migrated before it stay imported. Requires `DATABASE_URL`.

## Storage

- `src/ledger-store.ts` exposes `importGhostfolioExport(sql, jsonText)` and `readLedger(sql)`.
- Validation happens before writes, and the import runs in one transaction.
- Accounts are matched by their Ghostfolio account id, so an account is never created twice. Balance snapshots are keyed by account and date, and tags by name.
- Activities have no Ghostfolio id, so each is keyed by a digest of its content plus its position among identical activities in the export. Overlapping exports add only the new activities; two identical activities within one export are both kept.
- An account that already exists keeps its stored name, comment and balance; a later export does not overwrite it.
- Quantities, prices and fees are stored as exact `numeric` values and read back as strings.
- Historical account balances are preserved, not treated as deposits or added to trade-derived cash.
- PostgreSQL listens on localhost port 55432 and uses the `portfolio-db` named volume.
- Private source exports are in ignored `private/`; credentials are in ignored `.env`. Never commit these files.
- The application does not encrypt these records. Protect the host, permissions, disks and backups appropriately.

## Tests

Requires Node 22.18+ or a newer supported release, npm, Docker Compose, and a running container runtime.

With local `.env` configured:

```bash
docker compose up -d --wait db
```

Create the dedicated test database once on a fresh deployment:

```bash
docker compose exec -T db createdb -U portfolio portfolio_test
```

Run:

```bash
npm test
npm run typecheck
npm run test:coverage
```

Test scripts load `.env` when present. Integration tests require `DATABASE_URL` and substitute database name `portfolio_test`. This database must contain only synthetic test records. Tests do not delete or reset the database.

`docker compose down` stops the service without removing the data volume. Do not use `down -v` unless you intend to delete its data.

## Adding a buy in the web app

Signed in, open **Add buy** in the header (on a phone, under the page heading), or **Buy more** on a position, which opens the form with that account and symbol already chosen at `/buy`.

- **Symbol:** type a name or ticker; after a short pause matches from Yahoo Finance are listed (equities, ETFs and funds only). Use the arrow keys and Enter, or click, to pick one. Picking fetches the last price and fills in the currency and, if still empty, the price per unit. Change the price to what you actually paid.
- **Currency:** only EUR and USD can be recorded. A symbol Yahoo quotes in any other currency (for example pence on the London exchange) is refused, because the ledger could not value it correctly.
- **Account:** choose an existing account. Accounts are created with the CLI above; there is no account form.
- **Saving:** the server checks the symbol against Yahoo again, then saves through the same validation as the CLI. A new position is simply the first BUY of that symbol in the account; a later BUY increases it.
- **Duplicates:** an identical purchase (same account, symbol, date, quantity, price and fee) is refused with **Save anyway**, which saves it deliberately, as `--force` does.
- **Prices:** a symbol with no cached price is valued after the next worker refresh, and the form says so.
- Like the CLI, a BUY does not move cash.
- The save endpoint needs the same sign-in cookie and a same-origin request. It opens its own read-write connection from `DATABASE_URL` (or the `PG*` variables). Searching and quoting use Yahoo's unofficial public endpoints, so they can stop working without notice; the app then shows that search is unavailable, and the CLI still works. `YAHOO_BASE_URL` points them elsewhere, which the browser tests use.

## Removing a position

Open a position and choose **Remove position**. The confirmation names the account and symbol and requires typing the exact symbol before **Permanently remove** is enabled. Cancel leaves everything unchanged.

Removal deletes every transaction for that symbol in that account, including buys, sells and dividends, plus their tag links. It is not a sale: it changes historical performance and has no in-app undo. Make a backup first (README, Backup and restore). Other symbols, other accounts, account-level cash movements and shared market caches remain unchanged. Existing raw import records and backup files are retained; this is not secure erasure of all copies. A later import containing those activities may recreate them.

The authenticated `DELETE /api/positions` endpoint requires a same-origin request and exact-symbol confirmation and performs deletion in one database transaction.

## Bulk import through the UI

Choose **Import positions** on the dashboard or open `/import`, then download the CSV template:

```csv
account,symbol,quantity,average_price,currency,date
Broker,VWCE.DE,12.5,100.25,EUR,2026-01-02
```

Upload the file, choose **Preview import**, review every row, then **Confirm import**. Cancel or selecting another file clears the preview. Invalid files show a row-specific error; no rows are saved until confirmation. An import either saves all valid rows together or rolls back completely.

- Each row is an opening BUY on `date`, not a reconstruction of earlier trading history. Use your average cost per unit and opening/acquisition date. Earlier performance cannot be recovered from current holdings alone. This adds to existing holdings; it never replaces them or moves cash.
- Account names are matched exactly (case-sensitive). Missing accounts are created using the row's currency. A new account must use one currency across its rows; create it first if you need multiple transaction currencies. Duplicate account names are rejected as ambiguous.
- Identical BUYs (same account, symbol, date, currency, numeric quantity, numeric price and zero fee) are skipped, both within the file and across retries. Different buys are added, so uploading a changed quantity is not an update. Two intentionally identical lots are treated as one; use manual entry if you need the explicit duplicate override.
- Supported currencies are EUR and USD. Use Yahoo ticker symbols, dot-separated plain decimals (not exponents or thousands separators), and valid nonfuture `YYYY-MM-DD` dates. UTF-8 BOM, CRLF and quoted CSV fields are supported. Maximum 1000 rows and 1 MiB.
- Symbols are syntax-checked, not live-validated against Yahoo. Verify exchange suffixes and currencies yourself. Prices are populated by the next worker refresh; an unknown symbol remains unpriced.
- The authenticated API `/api/positions/import` enforces the same validation and same-origin protection on preview and confirmation. The server revalidates the CSV on every request; client preview data is never trusted.

This is the user-facing holdings importer, not the PostgreSQL backup/restore workflow. Ghostfolio JSON upload is not supported in the UI; use the existing CLI for that format.

## Outstanding work

A web form for types other than BUY remains unimplemented; the dashboard pages connect read-only, and only the buy, CSV import and position-removal endpoints write. A dividend on a symbol is counted as realised income in the position and valuation reports; it does not change quantity, cost basis, portfolio value or the performance chart. Deposits, withdrawals and fees can be stored but are not included in positions, valuation or performance, and cash stays a fixed EUR 0.
