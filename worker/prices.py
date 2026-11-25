from datetime import date, timedelta
from decimal import Decimal, InvalidOperation

from worker.symbols import yahoo_symbol


def refresh_price_history(connection, symbols, start, end, ticker_factory=None, full_start=None):
    """Store daily closes and any stock splits seen in them.

    Yahoo reports closes adjusted for splits, so a split makes every older stored close stale. When a split that is
    not stored yet turns up and the fetched window starts after full_start (the symbol's first trade), the history is
    fetched again from full_start, so the whole series is adjusted. Closes and splits are written together, which
    means a split is never recorded while old closes still carry the old scale.
    """
    fetched = []
    for symbol in symbols:
        rows, splits = fetch_history(symbol, start, end, ticker_factory)
        if splits and full_start is not None and full_start < start and has_new_split(connection, splits):
            rows, splits = fetch_history(symbol, full_start, end, ticker_factory)
        fetched.append((rows, splits))
    rows = [row for symbol_rows, _ in fetched for row in symbol_rows]
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
        if any(splits for _, splits in fetched):
            ensure_splits_table(connection)
            for _, splits in fetched:
                for split in splits:
                    connection.execute('''
                        INSERT INTO security_splits (symbol, effective_on, ratio)
                        VALUES (%s, %s, %s)
                        ON CONFLICT (symbol, effective_on) DO UPDATE
                        SET ratio = EXCLUDED.ratio, fetched_at = now()
                    ''', (split['symbol'], split['effectiveOn'], split['ratio']))
    return len(rows)


def ensure_splits_table(connection):
    # ratio is new shares per old share: 60 for a 1:60 split, 0.1 for a 10:1 reverse split.
    connection.execute('''
        CREATE TABLE IF NOT EXISTS security_splits (
            symbol text NOT NULL,
            effective_on date NOT NULL,
            ratio numeric NOT NULL CHECK (ratio > 0 AND ratio < 'Infinity'::numeric),
            source text NOT NULL DEFAULT 'yfinance' CHECK (source = 'yfinance'),
            fetched_at timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (symbol, effective_on)
        )
    ''')


def has_new_split(connection, splits):
    if connection.execute("SELECT to_regclass('security_splits')").fetchone()[0] is None:
        return True
    return any(connection.execute('SELECT 1 FROM security_splits WHERE symbol = %s AND effective_on = %s',
                                  (split['symbol'], split['effectiveOn'])).fetchone() is None for split in splits)


def fetch_price_history(symbol, start, end, ticker_factory=None):
    return fetch_history(symbol, start, end, ticker_factory)[0]


def fetch_history(symbol, start, end, ticker_factory=None):
    """The daily closes and the stock splits in the range, as (rows, splits)."""
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
        interval='1d', auto_adjust=False, actions=True, timeout=20, raise_errors=True)
    rows = sorted(history.iterrows(), key=lambda item: item[0])
    if not rows:
        raise ValueError('No price history')
    currency = ticker.get_history_metadata().get('currency')
    if currency not in ('EUR', 'USD'):
        raise ValueError('Unsupported quote currency')
    prices = [{
        'symbol': symbol, 'observedOn': timestamp.date().isoformat(),
        'close': format(positive_close(row['Close']), 'f'), 'currency': currency,
    } for timestamp, row in rows]
    splits = [{'symbol': symbol, 'effectiveOn': timestamp.date().isoformat(), 'ratio': ratio}
              for timestamp, row in rows if (ratio := split_ratio(row)) is not None]
    return prices, splits


def split_ratio(row):
    value = row.get('Stock Splits', 0)
    if value is None or value == 0:
        return None
    try:
        ratio = Decimal(str(value))
    except InvalidOperation as error:
        raise ValueError('Invalid split ratio') from error
    if not ratio.is_finite() or ratio <= 0:
        raise ValueError('Invalid split ratio')
    return format(ratio.normalize(), 'f')


def positive_close(value):
    try:
        close = Decimal(str(value))
    except InvalidOperation as error:
        raise ValueError('Invalid security price') from error
    if not close.is_finite() or close <= 0:
        raise ValueError('Invalid security price')
    return close
