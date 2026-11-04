import argparse
import os
import sys
import time
from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal

from worker.clock import local_today
from worker.fx import refresh_rates
from worker.prices import refresh_price_history
from worker.quotes import refresh_quotes

# Closes and rates are read up to this many days back, so a trade on a weekend or a holiday needs the week before it.
# A quote may also be this old, so its rate can lie up to twice as far back.
LOOKBACK_DAYS = 7

# The intraday refresh only re-fetches this many days; today's bar is the one that moves.
INTRADAY_WINDOW_DAYS = 7


def load_activities(connection):
    """Buys and sells from the normalized ledger; cash movements carry no instrument."""
    if connection.execute("SELECT to_regclass('transactions')").fetchone()[0] is None:
        return []
    rows = connection.execute(
        "SELECT account_id::text, type, symbol, currency, quantity::text, "
        "to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') "
        "FROM transactions WHERE type IN ('BUY', 'SELL') AND symbol IS NOT NULL ORDER BY occurred_at, seq").fetchall()
    return [{'accountId': account, 'type': kind, 'symbol': symbol, 'currency': currency, 'quantity': quantity, 'date': day}
            for account, kind, symbol, currency, quantity, day in rows]


def load_stored_ranges(connection):
    """The first and last stored day of each symbol's closes and of the USD/EUR rates."""
    prices, fx = {}, None
    if connection.execute("SELECT to_regclass('security_prices')").fetchone()[0] is not None:
        prices = {symbol: (first, last) for symbol, first, last in connection.execute(
            'SELECT symbol, min(observed_on), max(observed_on) FROM security_prices GROUP BY symbol').fetchall()}
    if connection.execute("SELECT to_regclass('fx_observations')").fetchone()[0] is not None:
        first, last = connection.execute('SELECT min(observed_on), max(observed_on) FROM fx_observations').fetchone()
        fx = None if first is None else (first, last)
    return {'prices': prices, 'fx': fx}


def refresh_start(first_needed, stored):
    """Where to start fetching. Stored rows do not change, so only the last week of them is fetched again, which picks up
    a late correction and today's bar. Without stored rows, or when a trade predates them, fetch from before that day."""
    lookback = timedelta(days=LOOKBACK_DAYS)
    if stored is None or stored[0] > first_needed:
        return first_needed - lookback
    return stored[1] - lookback


def plan_refresh(activities, today, stored=None):
    stored = stored or {'prices': {}, 'fx': None}
    usd_dates = [date.fromisoformat(a['date'][:10]) for a in activities if a['currency'] == 'USD']
    quantities = defaultdict(Decimal)
    first_trades = {}
    for a in activities:
        quantities[(a['accountId'], a['symbol'])] += Decimal(str(a['quantity'])) * (1 if a['type'] == 'BUY' else -1)
        day = date.fromisoformat(a['date'][:10])
        first_trades[a['symbol']] = min(first_trades.get(a['symbol'], day), day)
    history_starts = {symbol: refresh_start(first, stored['prices'].get(symbol)) for symbol, first in sorted(first_trades.items())}
    return {
        'fxStart': refresh_start(min(usd_dates + [today - timedelta(days=LOOKBACK_DAYS)]), stored['fx']),
        'fxEnd': today,
        'symbols': sorted({symbol for (_, symbol), quantity in quantities.items() if quantity > 0}),
        'historyStart': min(history_starts.values(), default=None),
        'historyStarts': history_starts,
        'historySymbols': list(history_starts),
    }


def failure_reason(error):
    return (str(error).splitlines() or [type(error).__name__])[0]


def refresh_import(connection, today, dry_run=False, rates=refresh_rates, quotes=refresh_quotes,
                   prices=refresh_price_history):
    plan = plan_refresh(load_activities(connection), today, load_stored_ranges(connection))
    start, end = plan['fxStart'].isoformat(), plan['fxEnd'].isoformat()
    history_start = plan['historyStart'].isoformat() if plan['historyStart'] else None
    if dry_run:
        history = f'{history_start}..{end}' if history_start else 'none'
        return (f"Dry run: FX {start}..{end}, {len(plan['symbols'])} quote symbols, "
                f"price history {history} for {len(plan['historySymbols'])} symbols; nothing fetched or written")
    fx_count = rates(connection, start, end)
    quote_count = price_count = 0
    failures = []
    for symbol in plan['symbols']:
        try:
            quote_count += quotes(connection, [symbol])
        except Exception as error:
            failures.append(f'{symbol} ({failure_reason(error)})')
    for symbol in plan['historySymbols']:
        try:
            price_count += prices(connection, [symbol], plan['historyStarts'][symbol].isoformat(), end)
        except Exception as error:
            failures.append(f'{symbol} history ({failure_reason(error)})')
    summary = (f'Processed {fx_count} FX observations, {quote_count} security quotes '
               f'and {price_count} price history rows')
    return f"{summary}; {len(failures)} failed: {', '.join(failures)}" if failures else summary


def refresh_intraday(connection, today, rates=refresh_rates, prices=refresh_price_history):
    """Re-fetch the recent window for held symbols so today's partial bar stays current."""
    start, end = (today - timedelta(days=INTRADAY_WINDOW_DAYS)).isoformat(), today.isoformat()
    symbols = plan_refresh(load_activities(connection), today)['symbols']
    fx_count = rates(connection, start, end)
    price_count = 0
    failures = []
    for symbol in symbols:
        try:
            price_count += prices(connection, [symbol], start, end)
        except Exception as error:
            failures.append(f'{symbol} ({failure_reason(error)})')
    summary = f'Processed {fx_count} FX observations and {price_count} price rows'
    return f"{summary}; {len(failures)} failed: {', '.join(failures)}" if failures else summary


def run_every(action, seconds, sleep=time.sleep):
    while True:
        try:
            print(action())
        except Exception as error:
            print(f'Refresh failed: {error}', file=sys.stderr)
        sleep(seconds)


def positive_seconds(value):
    try:
        seconds = int(value)
    except ValueError:
        seconds = 0
    if seconds <= 0:
        raise argparse.ArgumentTypeError('must be a positive number of seconds')
    return seconds


def main(argv=None):
    import psycopg
    parser = argparse.ArgumentParser(description='Refresh FX rates, quotes and price history for the stored ledger')
    parser.add_argument('--dry-run', action='store_true', help='Show the plan without fetching or writing')
    parser.add_argument('--every', type=positive_seconds, metavar='SECONDS', help='Repeat on this interval')
    parser.add_argument('--intraday', action='store_true',
                        help='Only re-fetch the last week of prices for held symbols, plus FX (for frequent runs)')
    args = parser.parse_args(argv)
    if args.intraday and args.dry_run:
        parser.error('--intraday cannot be combined with --dry-run')

    def run():
        today = local_today()
        with psycopg.connect(os.environ['DATABASE_URL']) as connection:
            if args.intraday:
                summary = refresh_intraday(connection, today)
            else:
                summary = refresh_import(connection, today, dry_run=args.dry_run)
            if not args.dry_run:
                from worker.names import refresh_names
                symbols = plan_refresh(load_activities(connection), today)['historySymbols']
                refresh_names(connection, symbols)
            return summary

    if args.every:
        run_every(run, args.every)
    else:
        print(run())


if __name__ == '__main__':
    main()
