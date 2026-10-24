# README hosting pass: TDD evidence

Source plan: none; journeys were derived during this run.

## Journey

As a stranger who found the repository, I want to host, import and install Localfolio from the README alone, so that I do not need to read the source.

## Cycle

| Stage | Command | Result |
|-------|---------|--------|
| RED | `npx vitest run src/readme.test.ts` | 9 of 10 failed (missing LICENSE, DATABASE_URL line, sign-in note, refresh command, sample export, CSV import docs, Node scope, troubleshooting, stale doc claims) |
| GREEN | `npx vitest run src/readme.test.ts` | 10 of 10 passed |
| Full | `npm run test:coverage` | 57 files, 697 tests passed; 86.38% statements |
| Full | `npm run typecheck` | exit 0 |
| Full | `npm run lint` | no errors; 29 warnings, 19 infos (unchanged) |

## What the tests guarantee

| # | Guarantee | Test (`src/readme.test.ts`) |
|---|-----------|-----------------------------|
| 1 | MIT `LICENSE` exists and `package.json` declares it | ships an MIT license |
| 2 | The exact `DATABASE_URL` line for the host import is in the README | shows the exact DATABASE_URL line |
| 3 | Sign-in with `APP_PASSWORD` and the empty-dashboard state are explained | tells the operator how to sign in |
| 4 | The one-off `worker.refresh` command is in the README | gives the one-off refresh command |
| 5 | The export source is explained and the linked sample parses with `parseGhostfolioJson` | explains where the export comes from |
| 6 | The CSV import is documented with the exact template header | documents the CSV positions import |
| 7 | Node.js 26 is scoped to host-side commands | scopes the Node.js requirement |
| 8 | Troubleshooting covers port clashes, login, missing `DATABASE_URL` and rate limits | has a troubleshooting section |
| 9 | Every relative README link resolves | links only to files that exist |
| 10 | `docs/dashboard.md` and `docs/yfinance-worker.md` no longer contradict the app | docs no longer contradict |

## Known gaps

- The commands were checked against the code and compose file, not run on a fresh machine with an empty database.
- The Ghostfolio export instructions describe the file format; Ghostfolio's own menu names may change.
- The copyright line is the generic "Localfolio contributors".
