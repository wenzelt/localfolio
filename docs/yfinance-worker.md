# Yfinance market-data worker

The on-demand Python worker fetches historical FX, security daily-close history and latest available security daily closes. Yahoo `USDEUR=X` values mean **EUR per USD** and support historical EUR cost basis. Quotes and price history are cached separately; the web dashboard reads these caches (see `docs/dashboard.md`).

## Docker

With the existing private `.env` and database configured:

```sh
docker compose build worker
docker compose run --rm worker 2025-01-01 2025-12-31
```

Both dates are inclusive. Request seven days before the earliest trade to cover prior observations. The optional worker Compose profile does not start automatically with the database. Standard PostgreSQL environment variables provide the connection; secrets are not embedded in the image.

The worker upserts `fx_observations`: `observed_on`, positive numeric `eur_per_usd`, source `USDEUR=X` and `fetched_at`. Fetching/validation finish before writes start. Writes are transactional; failed refreshes preserve prior observations. Missing dates are not fabricated.

## Reporting

`readCachedPositionReport(sql)` from `src/fx-cache.ts` resolves required USD dates and delegates to the existing EUR calculator. `readCachedRates(sql, dates)` returns availability, actual observation date and source.

Use the latest cached observation on or before each trade's UTC date, at most **seven calendar days** old. Missing/stale data or an uninitialized cache flags the affected position `historical-fx-required`; EUR-only positions need no rate. Saved exports are unchanged.

These remain library APIs: no web UI or reusable TypeScript report CLI exists yet.

## Local tests

Use a working Python 3.14 installation:

```sh
python3 -m venv .venv/py314
.venv/py314/bin/python -m pip install -r worker/requirements-test.txt
.venv/py314/bin/python -m unittest discover -s worker -v
.venv/py314/bin/python -m coverage run --branch --source=worker -m unittest discover -s worker -v
.venv/py314/bin/python -m coverage report --omit='worker/test_*' --fail-under=80
npm run typecheck
npm run test:coverage
```

Cross-language Vitest tests require this Python environment, configured PostgreSQL and the synthetic-only `portfolio_test` database. Override `WORKER_PYTHON` for another Python environment. Yahoo responses are mocked. Never store real portfolio data in the test database.

Direct Python dependencies are pinned; transitive dependencies are not locked. Yahoo supplies floating-point observations: decimal conversion avoids further float arithmetic but cannot improve upstream precision. Daily Close is not intraday or broker settlement FX. Provider revisions can change later refresh results.

## Security quotes

The same image also supports an explicit, on-demand security quote command:

```sh
docker compose build worker
docker compose run --rm --entrypoint python worker -m worker.quotes AAPL
```

This makes a Yahoo network request and writes public market data to the configured database. Supply symbols explicitly; the command does not read private portfolio exports. For an isolated smoke test, add `-e PGDATABASE=portfolio_test` before `--entrypoint`.

A quote is the **latest available unadjusted daily Close** from a five-day history request, not a real-time price or guaranteed completed-session close. An in-progress daily bar can be provisional. The provider's history metadata must identify EUR or USD; missing/unsupported currencies are rejected, not inferred from account currency. Invalid/empty prices and provider errors fail the refresh without overwriting cached data.

`security_quotes` stores one latest observation per symbol: observation date, positive numeric price, currency, `yfinance` source, and fetch timestamp. All requested quotes are fetched and validated before one write transaction. Older observation dates cannot replace newer ones; same-date refreshes may update provisional/revised prices. The command's processed count is not a count of changed database rows.

`readCachedQuotes(sql, symbols)` from `src/quote-cache.ts` reads without network access and returns `available` with `observedOn`, `price`, `currency`, `source`, `fetchedAt`, or `missing`. A missing table is treated as missing data. Availability does not imply freshness: callers must inspect timestamps. No universal staleness cutoff or automatic price fallback is applied.

Quote tests use synthetic symbols and mocked Yahoo responses; PostgreSQL integration is confined to `portfolio_test`. No live security quote smoke request was made in this milestone.

## EUR holdings valuation

`readValuationReport(sql, asOf)` from `src/valuation-report.ts` returns per-account/per-symbol EUR valuations using only the stored ledger and cached market data. `asOf` is a validated `YYYY-MM-DD` date and must not precede any imported activity. This is a current-cache report, not historical portfolio reconstruction.

Quotes must be on or before `asOf` and at most seven calendar days old. USD quotes convert at the latest FX observation on/before the quote date, at most seven days earlier. Historical cost basis independently uses each trade's historical FX. The result includes quote and conversion provenance; the FX reader exposes date, rate and source, not a fetch timestamp. Daily bars can be provisional, and cached provider revisions may postdate `asOf`.

A `valued` row contains EUR `marketValue` and `unrealizedGain` in decimal strings. The ledger uses exact rational arithmetic until final output (recurring decimals truncated to 26 places). `invested` is remaining cost basis, not total historical contributions. Valid closed positions have zero market value/gain without requiring a quote.

Unavailable states are `historical-fx-required`, `quote-required`, `quote-stale`, `quote-future`, and `current-fx-required`. No zero fallback or partial gain is fabricated. Historical-FX failure takes precedence and omits valuation entirely. Account identity and `isExcluded` remain visible; no portfolio totals or cash reconciliation are performed. Invalid economic trade sequences still throw rather than returning a per-position error.

## Valuation CLI

```sh
npm run report:valuation -- <YYYY-MM-DD>
```

Prints the report above as a tab-separated table (`account`, `symbol`, `status`, `quantity`, `invested`, `marketValue`, `unrealizedGain`); cells that are unavailable for the row's status are empty. It reads `DATABASE_URL` (from the environment or `.env`) over a `default_transaction_read_only` connection, so it cannot write. An unknown import id, an invalid date or wrong arguments print a message on stderr and exit 1. The import id is the SHA-256 shown when the export was imported. An import with no accounts is also reported as "Ledger is empty".

## Ledger-driven refresh and scheduling

`worker.refresh` derives what to fetch from the stored ledger (buys and sells) instead of taking dates and symbols by hand:

```sh
docker compose run --rm --entrypoint python worker -m worker.refresh --dry-run
docker compose run --rm --entrypoint python worker -m worker.refresh
```

- **FX range**: the earliest USD trade date (or 14 days before today if that is later) through today. The 14 days cover a quote up to seven days old plus FX up to seven days older than the quote.
- **Symbols**: those with a net positive quantity in at least one account, summed with exact `Decimal` arithmetic from the stored document.
- **`--dry-run`** prints the date range and the number of symbols, never the symbols, and makes no network request and no database write. Run it first and check the range.
- A real run sends the held ticker symbols to Yahoo and writes public FX and quote data to the configured database. FX is refreshed before quotes; if the FX request fails, quotes are not fetched. Quotes are refreshed one symbol at a time: a failure does not stop the others, and successful symbols are saved independently. The summary reports successful counts and each failed symbol with its error (or exception type for an empty message). A quote failure leaves the FX data already saved.

Intraday: `docker compose --profile live up -d live` runs `python -m worker.refresh --intraday --every ${LIVE_REFRESH_INTERVAL_SECONDS:-300}`. Each iteration fetches FX and daily prices for the last 7 days for symbols with an open position only, which updates today's bar in place while the market is open. It runs around the clock, cannot be combined with `--dry-run`, and does not replace the daily `scheduler`, which keeps the full history and quotes current.

Scheduling: `docker compose --profile scheduler up -d scheduler` runs the same refresh every `REFRESH_INTERVAL_SECONDS` (default 86400) and restarts with the Docker daemon. A failed iteration is logged on stderr and retried at the next interval. Each iteration re-fetches the whole FX range. There is no alerting; check `docker compose logs scheduler`.

UI freshness indicators remain pending.

## Price history and performance (backend only)

The ledger-driven refresh also backfills unadjusted daily closes into `security_prices`, per symbol; a failing symbol is reported and does not block the others. `readPerformanceReport(sql, asOf, period)` in `src/performance-report.ts` turns the stored ledger plus cached closes and FX into a daily EUR series for the periods `MAX`, `1Y`, `YTD`, `MTD`, `WTD` and `1D`.

- Percentage change is Modified Dietz, not Ghostfolio's ROAI, so figures differ slightly. Net change is closing value minus opening value minus net flows.
- Closes and FX use the latest observation on or before the day, at most seven days old. A symbol that cannot be priced is excluded and listed as unpriced.
- Accounts marked excluded in the export are left out.
- Yahoo `Close` may be split-adjusted while exported quantities are not, so splits can misstate history.
- MAX covers the available ledger and cached price history.
- Verify refreshed prices in your own deployment after rebuilding the worker and rerunning the refresh. Release validation: [release validation](releases/v0.1.0.md).

## Symbol mapping

Yahoo has no data for some Stuttgart ISIN symbols. `worker/symbols.py` maps them to the same fund's listing that Yahoo serves (`IE0001GSQ2O9.SG` -> `LWCR.DE`, `IE000YDZG487.SG` -> `HNSC.MI`, `LU2611732046.SG` -> `C001.DE`). Quotes and price history are requested under the Yahoo symbol but stored under the original symbol, so valuation and performance need no change. Prices come from another exchange and can differ slightly from Stuttgart. To add a mapping, edit `YAHOO_SYMBOLS`. Evidence: [release validation](releases/v0.1.0.md).
