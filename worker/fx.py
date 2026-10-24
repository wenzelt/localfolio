import argparse
import os
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation


def refresh_rates(connection, start, end, ticker_factory=None):
    observations = fetch_rates(start, end, ticker_factory)
    with connection.transaction():
        connection.execute('''
            CREATE TABLE IF NOT EXISTS fx_observations (
                observed_on date PRIMARY KEY,
                eur_per_usd numeric NOT NULL CHECK (eur_per_usd > 0 AND eur_per_usd < 'Infinity'::numeric),
                source text NOT NULL DEFAULT 'USDEUR=X' CHECK (source = 'USDEUR=X'),
                fetched_at timestamptz NOT NULL DEFAULT now()
            )
        ''')
        for observation in observations:
            connection.execute('''
                INSERT INTO fx_observations (observed_on, eur_per_usd)
                VALUES (%s, %s)
                ON CONFLICT (observed_on) DO UPDATE
                SET eur_per_usd = EXCLUDED.eur_per_usd, fetched_at = now()
            ''', (observation['date'], observation['eurPerUsd']))
    return len(observations)


def fetch_rates(start, end, ticker_factory=None):
    first = date.fromisoformat(start)
    last = date.fromisoformat(end)
    if first > last:
        raise ValueError('Start must not follow end')
    if ticker_factory is None:
        import yfinance
        ticker_factory = yfinance.Ticker

    history = ticker_factory('USDEUR=X').history(
        start=first.isoformat(), end=(last + timedelta(days=1)).isoformat(),
        interval='1d', auto_adjust=False, actions=False, timeout=20,
        raise_errors=True)
    observations = {}
    for timestamp, row in history.iterrows():
        observed = timestamp.date()
        try:
            rate = Decimal(str(row['Close']))
        except InvalidOperation as error:
            raise ValueError('Invalid historical FX observation') from error
        if not rate.is_finite() or rate <= 0:
            raise ValueError('Historical FX observation must be positive and finite')
        if not first <= observed <= last or observed in observations:
            raise ValueError('Unexpected historical FX observation date')
        observations[observed] = format(rate, 'f')
    if not observations:
        raise ValueError('No historical FX observations')
    return [{'date': observed.isoformat(), 'eurPerUsd': observations[observed]}
            for observed in sorted(observations)]


def main(argv=None):
    import psycopg
    parser = argparse.ArgumentParser(description='Cache historical USD/EUR daily observations')
    parser.add_argument('start', help='First observation date, inclusive (YYYY-MM-DD)')
    parser.add_argument('end', help='Last observation date, inclusive (YYYY-MM-DD)')
    args = parser.parse_args(argv)
    with psycopg.connect(os.environ['DATABASE_URL']) as connection:
        count = refresh_rates(connection, args.start, args.end)
    print(f'Cached {count} USD/EUR observations')


if __name__ == '__main__':
    main()
