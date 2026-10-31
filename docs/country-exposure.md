# Country exposure

The overview combines current priced EUR positions with cached country weights. Stocks use Yahoo headquarters countries; funds use reported country weights (weights covering at least 95% are scaled to 100%). This is not revenue exposure. Closed/excluded positions and positions without a current EUR value are excluded, just like daily movement.

## Source-access status

The public profile request returned HTTP 403 during follow-up verification. No alternate identity, proxy, or anti-bot workaround was attempted. The fetcher logs HTTP status codes, does not retry blocked requests, and preserves existing cache rows. Real cache population and deployment remain pending; do not interpret passing synthetic tests as confirmed live provider access.

Published [terms](https://www.justetf.com/en/about/legal-terms.html) link to [the conditions PDF](https://www.justetf.com/documents/justETF_general_terms_and_conditions.pdf). Section 3.1 prohibits excessive load and automated price inquiries. This does not establish permission for automated country-data extraction; obtain clarification or use a permitted source before operating it regularly. A robots.txt allowance is not a data licence.

## Freshness and map labels

Sources and dates lists priced holdings with missing weights explicitly. A source date more than 90 UTC calendar days old is marked stale (90 days is still current); a missing source date is marked unknown. Last fetched is displayed separately and does not reset the age of the underlying composition. Stale weights remain visible, not silently replaced or redistributed.

United States of America and Czech Republic are normalized to the map labels United States and Czechia before aggregation. Other labels are preserved; a country absent from the low-resolution map is labelled “not shown on map” in the text list and retains its allocation.

The populated cache/UI path is verified with synthetic browser fixtures at 1280px and 375px, including hidden amounts and source-row wrapping. This does not establish live provider access or populate the real cache.

## Refresh

Country metadata is separate from frequent prices. The explicit command is:

```sh
docker compose --profile worker build worker
docker compose --profile worker run --rm --entrypoint python worker -m worker.countries
```

To fill only stock headquarters countries from Yahoo, without loading `country-funds.json` or requesting any fund profile (no justETF traffic), add `--stocks-only`:

```sh
docker compose --profile worker run --rm --entrypoint python worker -m worker.countries --stocks-only
```

This creates `security_countries` if it does not exist. Until some refresh has run, the web app finds no table, reads an empty cache, and every holding shows as unavailable. After a stock-only refresh, funds still appear in **Other / not broken down** because no permitted fund source is available.

Fund weights published by issuers are stored in `worker/fund-country-weights.json` (`{symbol: {weights, source, as_of}}`) and loaded without any network request:

```sh
docker compose --profile worker build worker
docker compose --profile worker run --rm --no-deps --entrypoint python worker -m worker.countries --import-file worker/fund-country-weights.json
```

The importer validates every entry before writing: https source, valid date, non-negative numeric weights summing to at most 100. Weights are partial where the source publishes only top-N countries; the remainder stays in **Other / not broken down**. For funds tracking an index, the issuer publishes the index's country weights, so these describe the benchmark, not exact fund holdings (HSBC publishes holdings). Country labels were normalized to English names (German and French labels translated; "Mainland China" to China). The bundled sample uses public issuer or index-provider factsheet dates. Its VOO example uses United States 100 as an explicit modeling assumption: this rests on the S&P 500 index being a US-company index, not on a published fund breakdown. Review sample assumptions before using them.

**95% rule:** a holding whose published weights sum to at least 95% is treated as complete; its weights are scaled proportionally to 100% and it adds nothing to Other / not broken down (application policy). Below 95% (for example, a published composition covering only 90%) the remainder stays in Other. The Sources and dates list shows each holding's coverage and marks scaled ones.

Do not schedule frequent requests. The script waits three seconds between fund requests, identifies itself, and does not bypass access controls. Confirm provider terms before running it. It reads open symbols from the ledger and verified ISINs from `worker/country-funds.json`. The bundled map contains example verified fund identifiers; add mappings for your own symbols. It; unmatched ETFs/funds stay unknown. Only `EQUITY` symbols may use Yahoo's `country` field.

Cache: `security_countries(symbol, weights jsonb, source, as_of, fetched_at)`. Each successful symbol replaces its own cached composition transactionally; failures log the symbol and HTTP status or exception type and preserve previous data. The web app only reads this cache. Neither page loads nor intraday refreshes fetch geography.

JustETF normally supplies a few countries plus Other. Other, missing weights and unmapped funds all stay in **Other / not broken down**, shown as a grey share of the allocation bar. Nothing is proportionally redistributed. Holdings reference dates are distinct from fetch dates; a missing source date is labelled unavailable. Source dates are shown under Sources and dates for freshness review.

The map uses a fixed 0–50% intensity scale and bundled Natural Earth 110m admin-0 public-domain geometry. Geometry source: https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_110m_admin_0_countries.geojson . Country percentages also appear in a text list, including countries too small for the map. Hide mode removes EUR amounts but retains percentages.

## Validation

- `npm run test:coverage`: calculation, isolated cache reads, map privacy and overview integration.
- `.venv/py314/bin/python -m unittest worker.test_countries`: synthetic parser/fetch/cache/CLI cases (no real portfolio writes).
- Evidence: [release validation](releases/v0.1.0.md).
