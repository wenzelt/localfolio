import sys
from worker.symbols import yahoo_symbol


def refresh_names(connection, symbols, ticker_factory=None):
    if ticker_factory is None:
        import yfinance
        ticker_factory = yfinance.Ticker
    with connection.transaction():
        connection.execute("""CREATE TABLE IF NOT EXISTS security_names (
            symbol text PRIMARY KEY, name text NOT NULL CHECK (btrim(name) <> ''),
            fetched_at timestamptz NOT NULL DEFAULT now())""")
    known = {row[0] for row in connection.execute('SELECT symbol FROM security_names').fetchall()}
    count = 0
    for symbol in sorted(set(symbols) - known):
        try:
            info = ticker_factory(yahoo_symbol(symbol)).get_info()
            name = (info.get('longName') or info.get('shortName') or '').strip()
            if not name:
                continue
            with connection.transaction():
                connection.execute("""INSERT INTO security_names (symbol, name) VALUES (%s, %s)
                    ON CONFLICT (symbol) DO UPDATE SET name = EXCLUDED.name, fetched_at = now()""", (symbol, name))
            count += 1
        except Exception as error:
            print(f'Name lookup failed for {symbol}: {type(error).__name__}', file=sys.stderr)
    return count
