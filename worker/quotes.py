import argparse
import os
from decimal import Decimal, InvalidOperation

from worker.symbols import yahoo_symbol


def main(argv=None):
    import psycopg
    parser = argparse.ArgumentParser(description='Cache latest available security daily closes')
    parser.add_argument('symbols', nargs='+', help='Yahoo symbols to refresh')
    args = parser.parse_args(argv)
    with psycopg.connect(os.environ['DATABASE_URL']) as connection:
        count = refresh_quotes(connection, args.symbols)
    print(f'Processed {count} security quotes')


def refresh_quotes(connection, symbols, ticker_factory=None):
    quotes = [fetch_quote(symbol, ticker_factory) for symbol in symbols]
    with connection.transaction():
        connection.execute('''
            CREATE TABLE IF NOT EXISTS security_quotes (
                symbol text PRIMARY KEY,
                observed_on date NOT NULL,
                price numeric NOT NULL CHECK (price > 0 AND price < 'Infinity'::numeric),
                currency text NOT NULL CHECK (currency IN ('EUR', 'USD')),
                source text NOT NULL DEFAULT 'yfinance' CHECK (source = 'yfinance'),
                fetched_at timestamptz NOT NULL DEFAULT now()
            )
        ''')
        for quote in quotes:
            connection.execute('''
                INSERT INTO security_quotes (symbol, observed_on, price, currency)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (symbol) DO UPDATE
                SET observed_on = EXCLUDED.observed_on, price = EXCLUDED.price,
                    currency = EXCLUDED.currency, fetched_at = now()
                WHERE EXCLUDED.observed_on >= security_quotes.observed_on
            ''', (quote['symbol'], quote['observedOn'], quote['price'], quote['currency']))
    return len(quotes)


def fetch_quote(symbol, ticker_factory=None):
    if not symbol.strip():
        raise ValueError('Security symbol is required')
    if ticker_factory is None:
        import yfinance
        ticker_factory = yfinance.Ticker
    ticker = ticker_factory(yahoo_symbol(symbol))
    history = ticker.history(
        period='5d', interval='1d', auto_adjust=False, actions=False,
        timeout=20, raise_errors=True)
    rows = list(history.iterrows())
    if not rows:
        raise ValueError('No security quote')
    currency = ticker.get_history_metadata().get('currency')
    if currency not in ('EUR', 'USD'):
        raise ValueError('Unsupported quote currency')
    timestamp, row = max(rows, key=lambda item: item[0])
    try:
        price = Decimal(str(row['Close']))
    except InvalidOperation as error:
        raise ValueError('Invalid security price') from error
    if not price.is_finite() or price <= 0:
        raise ValueError('Invalid security price')
    return {
        'symbol': symbol, 'observedOn': timestamp.date().isoformat(),
        'price': format(price, 'f'), 'currency': currency, 'source': 'yfinance',
    }


if __name__ == '__main__':
    main()
