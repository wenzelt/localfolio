"""Explicit, low-frequency country metadata refresh; never part of intraday prices."""
import argparse
from datetime import date, datetime
import re
from decimal import Decimal
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import sys
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from worker.symbols import yahoo_symbol


CREATE_TABLE = '''CREATE TABLE IF NOT EXISTS security_countries (
    symbol text PRIMARY KEY, weights jsonb NOT NULL, source text NOT NULL,
    as_of date, fetched_at timestamptz NOT NULL DEFAULT now())'''
UPSERT = '''INSERT INTO security_countries (symbol, weights, source, as_of)
    VALUES (%s, %s::jsonb, %s, %s) ON CONFLICT (symbol) DO UPDATE
    SET weights=EXCLUDED.weights, source=EXCLUDED.source,
    as_of=EXCLUDED.as_of, fetched_at=now()'''


class CountryTable(HTMLParser):
    def __init__(self):
        super().__init__()
        self.active = False
        self.cell = None
        self.row = []
        self.rows = []

    def handle_starttag(self, tag, attrs):
        if tag == 'table' and (dict(attrs).get('data-testid') == 'etf-holdings_countries_table' or dict(attrs).get('id') == 'countriesTable'):
            self.active = True
        if self.active and tag == 'tr':
            self.row = []
        if self.active and tag == 'td':
            self.cell = ''

    def handle_data(self, data):
        if self.cell is not None:
            self.cell += data

    def handle_endtag(self, tag):
        if tag == 'td' and self.cell is not None:
            self.row.append(' '.join(self.cell.split()))
            self.cell = None
        if tag == 'tr' and self.active and self.row:
            self.rows.append(self.row)
        if tag == 'table':
            self.active = False


def parse_countries(html):
    table = CountryTable()
    table.feed(html)
    weights = {}
    total = Decimal(0)
    for row in table.rows:
        if len(row) != 2 or not row[1].endswith('%'):
            raise ValueError('Invalid country row')
        weight = Decimal(row[1][:-1].replace(',', ''))
        if not weight.is_finite() or weight < 0:
            raise ValueError('Invalid country weight')
        total += weight
        if row[0] != 'Other':
            if row[0] in weights:
                raise ValueError('Duplicate country')
            weights[row[0]] = str(weight)
    if not table.rows or total > 100 or total <= 0:
        raise ValueError('Missing or invalid country composition')
    return weights


def parse_source_date(html):
    match = re.search(r'data-testid="tl_etf-holdings_reference-date"[^>]*>\s*As of (\d{2}/\d{2}/\d{4})', html)
    if not match:
        return None
    return datetime.strptime(match[1], '%d/%m/%Y').date()


def fetch_page(url):
    request = Request(url, headers={'User-Agent': 'PortfolioTracker/1.0 (personal country metadata refresh)'})
    with urlopen(request, timeout=30) as response:
        return response.read(2_000_000).decode('utf-8')


def refresh_countries(connection, symbols, fund_isins, ticker_factory=None, fetch=fetch_page, pause=time.sleep):
    if ticker_factory is None:
        import yfinance
        ticker_factory = yfinance.Ticker
    with connection.transaction():
        connection.execute(CREATE_TABLE)
    count = 0
    for symbol in sorted(set(symbols)):
        try:
            if symbol in fund_isins:
                source = f'https://www.justetf.com/en/etf-profile.html?isin={fund_isins[symbol]}'
                pause(3)
                html = fetch(source)
                weights = parse_countries(html)
                as_of = parse_source_date(html)
            else:
                info = ticker_factory(yahoo_symbol(symbol)).get_info()
                if info.get('quoteType') != 'EQUITY' or not info.get('country'):
                    continue
                weights = {info['country']: '100'}
                source = f'https://finance.yahoo.com/quote/{yahoo_symbol(symbol)}/profile/'
                as_of = date.today()
            with connection.transaction():
                connection.execute(UPSERT, (symbol, json.dumps(weights), source, as_of))
            count += 1
        except Exception as error:
            reason = f'HTTP {error.code}' if isinstance(error, HTTPError) else type(error).__name__
            print(f'Country lookup failed for {symbol}: {reason}', file=sys.stderr)
    return count


def validate_supplied(symbol, entry):
    try:
        weights, source = entry['weights'], entry['source']
        as_of = date.fromisoformat(entry['as_of'])
        if not isinstance(weights, dict) or not weights or not source.startswith('https://'):
            raise ValueError
        parsed = {country: Decimal(value) for country, value in weights.items()}
        if any(not value.is_finite() or value < 0 for value in parsed.values()) or sum(parsed.values()) > 100:
            raise ValueError
    except (KeyError, TypeError, ValueError, ArithmeticError):
        raise ValueError(f'Invalid supplied country weights for {symbol}') from None
    return weights, source, as_of


def import_country_weights(connection, supplied):
    """Store owner-supplied weights from a published source; validated in full before any write."""
    rows = [(symbol, *validate_supplied(symbol, entry)) for symbol, entry in sorted(supplied.items())]
    with connection.transaction():
        connection.execute(CREATE_TABLE)
        for symbol, weights, source, as_of in rows:
            connection.execute(UPSERT, (symbol, json.dumps(weights), source, as_of))
    return len(rows)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mapping', type=Path, default=Path(__file__).with_name('country-funds.json'))
    parser.add_argument('--stocks-only', action='store_true', help='Fetch Yahoo equity headquarters only; never request fund profiles')
    parser.add_argument('--import-file', type=Path, help='Store owner-supplied weights from a JSON file; makes no network requests')
    args = parser.parse_args()
    import psycopg
    if args.import_file:
        supplied = json.loads(args.import_file.read_text())
        with psycopg.connect(os.environ.get('DATABASE_URL') or '') as connection:
            print(f'Country compositions imported: {import_country_weights(connection, supplied)}')
        return
    from worker.refresh import load_activities, plan_refresh
    mapping = {} if args.stocks_only else json.loads(args.mapping.read_text())
    with psycopg.connect(os.environ.get('DATABASE_URL') or '') as connection:
        symbols = plan_refresh(load_activities(connection), date.today())['symbols']
        print(f'Country compositions refreshed: {refresh_countries(connection, symbols, mapping)}')


if __name__ == '__main__':
    main()
