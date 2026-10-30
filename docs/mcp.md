# Local MCP access

Localfolio provides an optional Model Context Protocol server for local AI clients. It runs as a separate stdio process, not an HTTP endpoint. No web app or worker changes are required.

## Setup

Install Node.js 26 on the host, run `npm ci`, and start the database as described in the README. The host address for the default Docker database is `127.0.0.1:55432`, not `db:5432`.

Add this to your client's MCP configuration, replacing the absolute paths and placeholder credentials:

```json
{
  "mcpServers": {
    "localfolio": {
      "command": "/absolute/path/to/node",
      "args": [
        "--import", "/absolute/path/to/localfolio/node_modules/tsx/dist/loader.mjs",
        "/absolute/path/to/localfolio/src/cli/mcp.ts"
      ],
      "env": {
        "DATABASE_URL": "postgres://portfolio:YOUR_URL_ENCODED_PASSWORD@127.0.0.1:55432/portfolio",
        "MCP_ENABLE_WRITES": "false"
      }
    }
  }
}
```

URL-encode special password characters. Protect this configuration like `.env`; never commit credentials. Absolute paths avoid dependence on the client's working directory. This configuration does not load the repository `.env` automatically.

Alternatively, clients supporting a working directory can run `npm run --silent mcp` from the repository. That script loads `.env`. Keep npm's script banner off stdout: stdout is reserved for MCP messages.

## Tools

| Tool | Arguments | Result |
|---|---|---|
| `list_accounts` | None | Account IDs, names, currencies, exclusion flags |
| `list_activities` | Optional `accountId`, `type`, `from`, `to`, `limit`, `offset` | Activities and `nextOffset` (`null` at the end) |
| `get_valuation` | `asOf` (`YYYY-MM-DD`) | Per-account positions and EUR valuation statuses |
| `add_transaction` | See below; only when enabled | New transaction ID |

Activity date bounds are inclusive UTC days in `YYYY-MM-DD` format. Pages default to 50 entries, maximum 100. Follow `nextOffset` for subsequent pages. Entries are ordered by timestamp and insertion sequence; pagination is not a snapshot if the ledger changes concurrently.

Valuation reuses the existing report: its date cannot precede any imported trade. Quotes and exchange rates come from the cache; missing and stale data remain explicit statuses. No refresh, arbitrary SQL, account creation, deletion, bulk import, or duplicate override is exposed.

## Enable ledger writes deliberately

Set `MCP_ENABLE_WRITES` to exactly `"true"` and restart the process. The default is read-only; `"false"` is also accepted. Other values fail startup. Read-only mode omits the write tool and sets database transactions to read-only by default.

Configure your client to ask for approval before every `add_transaction` invocation. **The server does not enforce per-write human approval.** Tool descriptions and MCP annotations are advisory; a client allowed to invoke the enabled tool can add entries directly.

Example trade arguments (replace the synthetic account ID using `list_accounts`):

```json
{
  "accountId": "00000000-0000-4000-8000-000000000001",
  "type": "BUY",
  "date": "2026-01-02T10:00:00.000Z",
  "currency": "EUR",
  "symbol": "EXAMPLE",
  "quantity": "2.5",
  "unitPrice": "10.1",
  "fee": "0.2"
}
```

Types: `BUY`, `SELL`, `DIVIDEND`, `DEPOSIT`, `WITHDRAWAL`, `FEE`. Currencies: EUR and USD. Decimals must be strings. Trades use `symbol`, `quantity`, `unitPrice`, and optional `fee`. Cash entries use `amount` instead of quantity and unit price; only dividends may include a symbol. `comment` is optional. Dates accept a calendar date or a timestamp with an explicit timezone.

Existing validation, account locking, overselling protection, and duplicate detection apply. No `force` override is available. **Never automatically retry after a lost response or infrastructure error:** the write may have committed. Inspect activities first. Duplicate detection is not a general idempotency-key mechanism.

## Security and operations

- Local transport does not prevent the client from sending portfolio records to its model provider. Review its privacy settings.
- Names, comments, and symbols are untrusted data, not AI instructions.
- Browser cookies and the app password are not used. Local process access and database credentials define the trust boundary.
- For stronger read-only enforcement, use a database role restricted to SELECT; a read-only connection default is not a substitute for database privileges.
- Write mode reuses the ledger writer's schema initialization. An insert-only role may be insufficient. This feature does not create roles or grant privileges automatically.
- Diagnostics go to stderr. The pool closes on stdio closure, SIGINT, or SIGTERM.
- Tests use isolated schemas in `portfolio_test`; do not run manual write experiments on your real portfolio.

## Developer validation

```sh
npm test -- src/mcp.test.ts src/mcp-stdio.test.ts
npm run typecheck
npm run lint
npm run build
```
