from datetime import date, timedelta
from decimal import Decimal, InvalidOperation

from worker.symbols import yahoo_symbol


def refresh_price_history(connection, symbols, start, end, ticker_factory=None):
    rows = [row for symbol in symbols for row in fetch_price_history(symbol, start, end, ticker_factory)]
    with connection.transaction():
        connection.execute('''
            CREATE TABLE IF NOT EXISTS security_prices (
                symbol text NOT NULL,
                observed_on date NOT NULL,
                close numeric NOT NULL CHECK (close > 0 AND close < 'Infinity'::numeric),
                currency text NOT NULL CHECK (currency IN ('EUR', 'USD')),
                source text NOT NULL DEFAULT 'yfinance' CHECK (source = 'yfinance'),
                fetched_at timestamptz NOT NULL DEFAULT now(),
                PRIMARY KEY (symbol, observed_on)
            )
        ''')
        for row in rows:
            connection.execute('''
                INSERT INTO security_prices (symbol, observed_on, close, currency)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (symbol, observed_on) DO UPDATE
                SET close = EXCLUDED.close, currency = EXCLUDED.currency, fetched_at = now()
            ''', (row['symbol'], row['observedOn'], row['close'], row['currency']))
    return len(rows)


def fetch_price_history(symbol, start, end, ticker_factory=None):
    if not symbol.strip():
        raise ValueError('Security symbol is required')
    if date.fromisoformat(start) > date.fromisoformat(end):
        raise ValueError('Price history start must not be after end')
    if ticker_factory is None:
        import yfinance
        ticker_factory = yfinance.Ticker
    ticker = ticker_factory(yahoo_symbol(symbol))
    history = ticker.history(
        start=start, end=(date.fromisoformat(end) + timedelta(days=1)).isoformat(),
        interval='1d', auto_adjust=False, actions=False, timeout=20, raise_errors=True)
    rows = sorted(history.iterrows(), key=lambda item: item[0])
    if not rows:
        raise ValueError('No price history')
    currency = ticker.get_history_metadata().get('currency')
    if currency not in ('EUR', 'USD'):
        raise ValueError('Unsupported quote currency')
    return [{
        'symbol': symbol, 'observedOn': timestamp.date().isoformat(),
        'close': format(positive_close(row['Close']), 'f'), 'currency': currency,
    } for timestamp, row in rows]


def positive_close(value):
    try:
        close = Decimal(str(value))
    except InvalidOperation as error:
        raise ValueError('Invalid security price') from error
    if not close.is_finite() or close <= 0:
        raise ValueError('Invalid security price')
    return close
