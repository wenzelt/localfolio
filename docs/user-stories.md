# Portfolio Tracker User Stories

## Scope

This project is a self-hosted, Docker-deployed portfolio tracker inspired by Ghostfolio. It supports a personal user's manual ledger and initial import of a Ghostfolio JSON export.

- Reporting currency: EUR
- Supported account and transaction currencies: EUR and USD
- Market-data source: Yahoo Finance through a Python `yfinance` worker
- Cost-basis method: weighted-average cost basis
- Imported Ghostfolio performance setting (`ROAI`): preserved as metadata only; Ghostfolio-identical ROAI calculations are not in this milestone

## Out of Scope

- Broker synchronisation
- CSV import/export
- Crypto wallets
- Tax reporting
- Currencies beyond EUR and USD
- Advanced performance analytics or Ghostfolio-compatible ROAI calculations

## Story 1: Run the application locally

**As a** home-server operator,
**I want** to start the application and its database with Docker Compose,
**so that** I can run the tracker privately without a hosted service.

### Acceptance Criteria

- Docker Compose starts the web app, PostgreSQL database, and price-refresh worker.
- PostgreSQL data persists in a named Docker volume.
- The app has a health endpoint and Compose health checks.
- Required configuration is documented in `.env.example` and the README without exposing secrets.

### Test Targets

- Container configuration declares all required services and persistent storage.
- The application health endpoint reports healthy only when its dependencies are available.

---

## Story 2: Set up and sign in to a local account

**As a** portfolio owner,
**I want** to create the first local account and sign in,
**so that** my financial records are protected from unauthorised visitors.

### Acceptance Criteria

- The first user can complete initial setup using an email and password.
- Passwords are stored only as secure hashes.
- An unauthenticated visitor cannot access portfolio data.
- Authenticated users can access only records they own.

> **Decision (single owner):** the application keeps one shared dashboard password (`APP_PASSWORD`) instead of user accounts. First-user setup by email and "only records they own" are not applicable because there is exactly one owner. Unauthenticated visitors are still rejected and the session is signed.

### Test Targets

- First-user setup accepts valid credentials and rejects invalid input.
- Password verification accepts the correct password and rejects an incorrect password.
- Protected routes reject unauthenticated requests.
- Data access filters records by the authenticated user.

---

## Story 3: Manage investment accounts

**As a** portfolio owner,
**I want** to create and view accounts with their native currencies,
**so that** I can distinguish brokers and cash accounts.

### Acceptance Criteria

- An account stores its name, EUR or USD account currency, optional comment, and excluded status.
- The signed-in owner can list accounts and add an account through **Manage accounts** on the dashboard; exact duplicate names are rejected.
- Deletion requires typing the exact account name and permanently removes the account, its transactions, and associated balances/tag links atomically; cancelling leaves it unchanged.
- Account balances and dated historical balance snapshots can be retained.
- A user can view only their own accounts.
- The design can preserve Ghostfolio account IDs for idempotent imports.

### Test Targets

- Valid EUR and USD accounts are accepted.
- Unsupported currencies and empty account names are rejected.
- Balance snapshots retain their dates and decimal values.
- A duplicate external Ghostfolio account ID is not imported twice.

---

## Story 4: Record a manual investment ledger

**As a** portfolio owner,
**I want** to record transactions for my investments,
**so that** the application can calculate my current holdings and performance.

### Acceptance Criteria

- A transaction supports `BUY`, `SELL`, `DIVIDEND`, `DEPOSIT`, `WITHDRAWAL`, and `FEE` activity types.
- Investment transactions preserve ticker, timestamp, quantity, unit price, fee, comment, and their transaction currency.
- Fractional quantities are supported without floating-point loss.
- A EUR account may contain USD transactions and vice versa.
- Invalid amounts, dates, currencies, and unsupported types are rejected before persistence.

### Test Targets

- Valid buy/sell transactions preserve all supplied fields.
- Fractional quantities such as `2.8` remain exact.
- Fee, price, quantity, and currency validation failures return useful errors.
- A transaction cannot be written to an account belonging to another user.

---

## Story 5: Import a Ghostfolio export once without duplicate records

**As a** portfolio owner migrating from Ghostfolio,
**I want** to upload my Ghostfolio JSON export,
**so that** my accounts, historical balances, purchases, sales, and tags appear in the self-hosted tracker.

### Acceptance Criteria

- The importer accepts the supported Ghostfolio export version and validates its schema before any records are saved.
- The importer creates or links accounts using Ghostfolio account IDs, retaining account name, currency, comment, exclusion status, balance, and snapshots.
- Activities retain account association, Yahoo symbol, type, quantity, unit price, fee, timestamp, currency, comment, and tags.
- Imported tags, such as `ETF`, are stored and associated with their imported activities.
- The importer records that symbols use the `YAHOO` data source.
- Re-importing the identical export creates no duplicate accounts, activities, snapshots, tags, or tag assignments.
- A malformed export produces a clear error and does not partially persist data.
- The UI reports created, skipped, and rejected record counts.

### Test Targets

- A fixture based on the supplied Ghostfolio export imports EUR and USD accounts and activities.
- EUR account / USD transaction combinations retain both currencies independently.
- Imported `BUY` and `SELL` activities retain fees, comments, and dates.
- Fractional VEU quantity imports exactly.
- `ETF` tag assignments are retained.
- Re-importing a fixture is idempotent.
- Unsupported export version, invalid numeric value, unknown currency, bad activity type, and missing account references fail atomically.

> **Status:** CLI import is implemented and tested for validation, account/activity field retention, exact decimals, tag assignments, idempotency, and rollback. Schema rejection tests check that all five imported tables remain unchanged for each invalid case above. The created/skipped/rejected counts are printed by the CLI. The signed-in owner can also upload the export at `/import/ghostfolio` (linked from the empty overview and from **Import positions**). The page validates the whole file first, then reports created, skipped and rejected counts, and shows a clear error with nothing saved for a malformed file. Covered by `src/ghostfolio-import.test.ts`, `src/ghostfolio-import-view.test.tsx` and `e2e/ghostfolio-import.e2e.ts`, so the UI criterion is closed. See [release validation](releases/v0.1.0.md).

---

## Story 6: Review holdings and realised performance

**As a** portfolio owner,
**I want** to see positions derived from my ledger,
**so that** I know what I still hold and how each holding has performed.

### Acceptance Criteria

- Holdings are computed from immutable transactions rather than stored editable totals.
- The system calculates quantity, weighted-average cost basis, fees, cash position, realised gain/loss, and unrealised gain/loss.
- A partial sale reduces quantity and realises the appropriate gain/loss.
- A full sale closes the position without leaving a residual holding.
- Dividends and fees affect the appropriate portfolio totals.
- Empty accounts and holdings without market prices render safely.

### Test Targets

- Buy-only, partial-sell, full-sell, dividend, fee, and empty-ledger fixtures have expected results.
- Attempts to sell more units than held are rejected.
- Decimal calculations use a decimal-safe implementation instead of JavaScript binary floating point.

> **Status:** buy, sell, fee-in-trade and decimal criteria are implemented and tested. Cycle 1 of dividends and cash is done at the calculation layer only: `calculatePosition` counts a dividend as realised income and `calculateCash` (`src/cash.ts`) derives per-account cash, dividends and fees in EUR. The overview lists a "Cash" position with a fixed EUR 0 placeholder (`cashEur` in `src/cash.ts`) until the owner supplies a balance. The position report (`positionReport`) now counts a dividend on a held symbol as realised income, and the historical USD/EUR rate lookup includes dividend dates (`usdRateDatesOf`). The valuation report counts dividends the same way. **Owner decisions closing this story:** cash stays a fixed EUR 0, fees beyond the per-trade fee are out of scope, and dividends stay out of portfolio value and the performance chart. Deposits and withdrawals are stored but are in no report total. See [release validation](releases/v0.1.0.md).

---

## Story 7: Display EUR totals with EUR and USD holdings

**As a** portfolio owner,
**I want** a EUR aggregate dashboard while retaining native values for each position,
**so that** I can assess my complete portfolio without losing currency context.

### Acceptance Criteria

- EUR is the dashboard reporting currency.
- EUR holdings display their native EUR values.
- USD holdings display their native USD values and an EUR-converted reporting value.
- Conversion uses a persisted, timestamped USD-to-EUR exchange-rate snapshot.
- The dashboard identifies stale or unavailable FX data.

### Test Targets

- EUR positions are not converted.
- USD positions convert with the supplied USD-to-EUR snapshot.
- Missing or stale FX snapshots produce an explicit stale/unavailable state without crashing the dashboard.

> **Status:** EUR conversion and the stale/unavailable FX warnings are implemented and unit-tested. The position detail of a USD-only holding now also shows its native USD cost basis and USD market value (quantity times the latest USD close) next to the EUR figures, masked in hide mode and browser-verified. Not shown: native USD figures for a holding that mixes EUR and USD trades, and per-position USD values on the overview tiles. See [release validation](releases/v0.1.0.md).

---

## Story 8: Refresh market data without blocking portfolio access

**As a** portfolio owner,
**I want** the tracker to refresh Yahoo Finance prices automatically,
**so that** current portfolio values are available while the tracker remains usable during provider outages.

### Acceptance Criteria

- A worker uses `yfinance` to retrieve quotes for imported Yahoo symbols and the USD/EUR FX rate.
- Quotes and FX rates are persisted with their timestamps and source metadata.
- The worker refreshes on a conservative, configurable schedule.
- A failed refresh keeps the last successful quote/rate available.
- The dashboard clearly marks stale data.

### Test Targets

- A mocked successful `yfinance` response persists a quote and FX snapshot.
- A missing Yahoo symbol is reported without preventing other symbols from refreshing.
- A provider failure retains the previous cached values.

> **Status (intraday refresh):** the optional `live` Compose profile re-fetches the last week of prices for held symbols and today's FX every `LIVE_REFRESH_INTERVAL_SECONDS` (default 300). The open dashboard reloads its data every minute while the tab is visible and shows "Updated HH:MM" from the newest fetch time. Unit-tested with fake timers; Playwright Chromium now verifies the visible-tab minute refresh request and updated-time label (using an accelerated browser clock). Live operation depends on provider availability and must be verified in your own deployment. The worker image now sets `PYTHONUNBUFFERED=1` so stdout/stderr are not buffered, including for Compose-overridden entrypoints. Packaging is regression-tested; the running image still needs rebuilding before this takes effect, and post-rebuild live log visibility is not yet verified. See [release validation](releases/v0.1.0.md).

---

## Story 9: Operate and recover the deployment

**As a** home-server operator,
**I want** clear installation, update, backup, and restore documentation,
**so that** I can safely operate the portfolio tracker over time.

### Acceptance Criteria

- The README documents initial setup, Docker Compose startup, upgrades, reverse-proxy/TLS recommendations, and health checks.
- The README documents PostgreSQL backup and restore procedures.
- The README documents `yfinance` availability/rate-limit limitations and cache behaviour.
- All project tests, linting, type checks, and coverage checks are documented and pass before release.

### Test Targets

- Coverage remains at least 80% for business logic.
- The complete test suite, type check, and lint commands succeed.

---

## Story 10: Hide sensitive figures

**As a** portfolio owner,
**I want** to hide monetary values and quantities with one toggle,
**so that** I can view the dashboard around other people.

### Acceptance Criteria

- Portfolio value, monetary change, position quantity, cost basis and chart readout amounts are masked; dates, symbols and percentages stay visible.
- Masked values are not exposed through accessible labels or tooltips.
- The setting is carried in the URL (`hide=1`) so it survives timeframe changes and navigation between the overview and a position.
- This is presentation privacy, not access control: the authenticated page still receives the underlying report.

> **Status:** implemented and unit-tested; verified in Playwright Chromium, including masking, accessible labels, and persistence across timeframe and position navigation. See [release validation](releases/v0.1.0.md).

---

## Story 11: Inspect an individual position

**As a** portfolio owner,
**I want** to open a holding and see its performance over the selected timeframe,
**so that** I can understand it without the whole portfolio.

### Acceptance Criteria

- A position is identified by account and symbol and is listed on the overview; excluded accounts are not listed.
- The detail view reuses the existing timeframe and hide controls, and the existing performance calculation scoped to that holding.
- Unknown or excluded positions return "not found" rather than portfolio totals; missing FX renders an explicit notice.

> **Status:** implemented. Closed positions (quantity 0) are no longer listed, though their URL still opens. Hidden detail figures, the missing-FX notice and same-symbol-in-two-accounts isolation are tested. Playwright Chromium verifies the `app/page.tsx` wiring for open EUR/USD holdings, closed/excluded listing omission, unknown-position 404, hidden detail figures and return navigation. Missing-FX and same-symbol account isolation remain unit-tested rather than browser-tested.

---

## Story 12: Update filters without pressing Apply

**As a** portfolio owner,
**I want** the view to update as soon as I change the timeframe,
**so that** I do not need an Apply button.

### Acceptance Criteria

- Changing the timeframe navigates immediately, keeps other URL parameters and shows a pending state.
- Without JavaScript, an Apply button remains as a fallback.
- This updates the report for a new filter only. It does not stream market prices or change the refresh schedule.

> **Status:** implemented and unit-tested with mocked router hooks. Playwright Chromium verifies immediate navigation, hide-param preservation, no Apply button with JavaScript, and successive changes settling on the last choice. Failed navigation is not browser-tested.

---

## Story 13: Inspect values over time on the chart

**As a** portfolio owner,
**I want** to hover, touch or keyboard-select a point on the chart,
**so that** I can see the date, value and return at that time.

### Acceptance Criteria

- Pointer hover and touch select the nearest plotted observation; a labelled slider and Escape give keyboard access.
- The readout shows date, EUR value and return, uses only real observations (no interpolation) and respects hide mode.
- Days without a return are skipped, not shown as zero.

- On a position, the readout also shows the unit price with its currency (EUR or USD, as cached). When a day has no close of its own, the last close is shown and its date is named.

> **Status:** portfolio and position readouts implemented and unit-tested. Playwright Chromium verifies pointer selection/reset, keyboard selection/Escape, hidden readout amounts, visible dates/percentages, and USD position price display. Touch behaviour is not yet browser-tested.

## Story 14: See which countries I am exposed to

Operating notes: [Country exposure](country-exposure.md).

**As a** portfolio owner,
**I want** a world map shaded by how much of my portfolio is exposed to each country,
**so that** I can see geographic concentration at a glance, including exposure held through funds.

### Data Findings

- Ledger transactions need separate country composition data; imported exports may not include usable country weights.
- Yahoo Finance, through `yfinance`, returns a `country` (headquarters) for single stocks only. It returns no country field and no country weights for ETFs or funds. For some funds it lists up to ten top holdings with each holding's share of the fund (checked 2026-10-31: VOO, MEUD.PA and EXI2.DE yes, CW8.PA none).
- Portfolios may contain both single stocks and funds; missing weights are shown explicitly.
- A full per-country look-through for funds needs a source beyond Yahoo. The top holdings give a partial one.

> **Source status:** cached/manual country compositions are supported; live fund-country provider access remains blocked and unverified. A Yahoo top-holdings look-through is implemented. It was checked live on 2026-10-31 for VOO (United States 39.11 from the top ten) and returns nothing for funds that Yahoo lists no holdings for, such as CW8.PA.

> **Approved:** explicit low-frequency scripted justETF lookup for verified fund ISINs; Yahoo headquarters for stocks. Other and missing weights remain a separate grey category, never redistributed. US-listed funds without a verified country source remain unallocated. No scraping on each browser load or intraday price refresh.

> **Approved (extension):** for funds with no other cached source, the worker may use Yahoo's top holdings and each holding's headquarters country. Only the listed holdings count and the rest stays in the grey category. This also applies to US-listed funds.

### Acceptance Criteria

- The map is shaded by each country's share of the current EUR portfolio value, with a fixed legend.
- A single stock counts fully toward its headquarters country.
- A fund counts toward countries only by its recorded country weights; value without weights is shown as "Not broken down", never spread by guesswork or assigned to the fund's listing or domicile country. Weights taken from a fund's top holdings are recorded weights that cover only those holdings.
- Country weights record their source and as-of date, and stale or missing weights are visible on the page.

> **Implementation status:** missing weights are named by holding. Source dates older than 90 UTC calendar days are marked stale; missing dates are labelled unknown. Last-fetch dates are shown separately. Tested aliases (United States of America, Czech Republic) normalize before aggregation; countries absent from the map remain in the text list with an explicit label. A populated cached flow is browser-verified at 1280px and 375px, including map/list agreement, metadata, hide mode and no horizontal overflow. **Operational blocker:** permitted live fund-data access and real cache/deployment remain unresolved after the documented provider 403; synthetic verification does not close that blocker. See [release validation](releases/v0.1.0.md).
- The page lists the same countries and shares as text, so the map is not the only way to read them.
- Positions that are closed, excluded, or without a EUR value are left out, consistent with the daily movement view.
- Hide mode hides EUR amounts and keeps percentages.
- The web app makes no external requests; any fetching happens in the worker and is cached in the database.

### Test Targets

- Country shares from synthetic stocks and funds with weights that sum to 100% and to less than 100%.
- Unweighted fund value reported as "Not broken down", not distributed.
- Exact arithmetic: shares sum to the covered portfolio value without drift.
- Map and text list agree, and hide mode hides EUR amounts.

> **Status:** map, exact allocation and explicit metadata fetcher implemented and tested. Initial verified mapping covers four UCITS funds; remaining identity/source review is pending. No real metadata refresh or deployment yet.

---

## TDD Delivery Order

1. Establish application and test infrastructure.
2. Implement the decimal-safe ledger domain model.
3. Implement and test Ghostfolio export validation and parsing.
4. Persist imported accounts, balances, instruments, tags, and activities idempotently.
5. Implement calculations and the portfolio dashboard.
6. Add authentication and protected CRUD flows.
7. Add the `yfinance` worker, pricing cache, and EUR conversion.
8. Add operational health checks and deployment documentation.

Each delivery slice must follow RED → GREEN:

1. Add an independently executable test for the acceptance criterion.
2. Run the targeted test and record the intended failure.
3. Commit the RED checkpoint.
4. Implement the smallest production change that makes the test pass.
5. Re-run the same target, record the pass, and commit the GREEN checkpoint.
6. Run coverage after the slice; record factual results in [release validation](releases/v0.1.0.md).
