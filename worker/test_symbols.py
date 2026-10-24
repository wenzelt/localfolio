import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import Mock

from worker.prices import fetch_price_history
from worker.quotes import fetch_quote
from worker.symbols import yahoo_symbol

MAPPED = {
    'IE0001GSQ2O9.SG': 'LWCR.DE',
    'IE000YDZG487.SG': 'HNSC.MI',
    'LU2611732046.SG': 'C001.DE',
}


class History:
    def __init__(self, rows):
        self.rows = rows

    def iterrows(self):
        return iter(self.rows)


class YahooSymbolTests(unittest.TestCase):
    def test_maps_stuttgart_isin_symbols_to_listings_yahoo_serves(self):
        for symbol, expected in MAPPED.items():
            with self.subTest(symbol=symbol):
                self.assertEqual(yahoo_symbol(symbol), expected)

    def test_leaves_other_symbols_unchanged(self):
        self.assertEqual(yahoo_symbol('AAPL'), 'AAPL')


class MappedFetchTests(unittest.TestCase):
    def setUp(self):
        self.ticker = Mock()
        self.factory = Mock(return_value=self.ticker)
        self.ticker.get_history_metadata.return_value = {'currency': 'EUR'}
        self.ticker.history.return_value = History([(datetime(2025, 1, 6), {'Close': 120.5})])

    def test_quote_is_requested_under_the_yahoo_symbol_and_kept_under_the_original(self):
        quote = fetch_quote('IE0001GSQ2O9.SG', self.factory)
        self.factory.assert_called_once_with('LWCR.DE')
        self.assertEqual(quote['symbol'], 'IE0001GSQ2O9.SG')

    def test_price_history_is_requested_under_the_yahoo_symbol_and_kept_under_the_original(self):
        rows = fetch_price_history('LU2611732046.SG', '2025-01-01', '2025-01-10', self.factory)
        self.factory.assert_called_once_with('C001.DE')
        self.assertEqual([row['symbol'] for row in rows], ['LU2611732046.SG'])


class WorkerImageTests(unittest.TestCase):
    def test_image_ships_the_symbol_mapping(self):
        self.assertIn('symbols.py', (Path(__file__).parent / 'Dockerfile').read_text())
