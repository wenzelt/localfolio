import unittest
from datetime import datetime
from unittest.mock import MagicMock, Mock, patch

from worker.prices import fetch_price_history, refresh_price_history


class History:
    def __init__(self, rows):
        self.rows = rows

    def iterrows(self):
        return iter(self.rows)


class FetchPriceHistoryTests(unittest.TestCase):
    def setUp(self):
        self.ticker = Mock()
        self.factory = Mock(return_value=self.ticker)
        self.ticker.get_history_metadata.return_value = {'currency': 'USD'}
        self.ticker.history.return_value = History([
            (datetime(2025, 1, 3), {'Close': 119}),
            (datetime(2025, 1, 6), {'Close': 120.5}),
        ])

    def fetch(self, symbol='ONE'):
        return fetch_price_history(symbol, '2025-01-01', '2025-01-10', self.factory)

    def test_returns_one_row_per_trading_day(self):
        self.assertEqual(self.fetch(), [
            {'symbol': 'ONE', 'observedOn': '2025-01-03', 'close': '119', 'currency': 'USD'},
            {'symbol': 'ONE', 'observedOn': '2025-01-06', 'close': '120.5', 'currency': 'USD'},
        ])

    def test_requests_unadjusted_daily_closes_including_the_end_date(self):
        self.fetch()
        self.factory.assert_called_once_with('ONE')
        self.ticker.history.assert_called_once_with(
            start='2025-01-01', end='2025-01-11', interval='1d', auto_adjust=False,
            actions=False, timeout=20, raise_errors=True)

    def test_rejects_blank_symbol(self):
        with self.assertRaisesRegex(ValueError, 'Security symbol is required'):
            self.fetch('  ')

    def test_rejects_empty_history(self):
        self.ticker.history.return_value = History([])
        with self.assertRaisesRegex(ValueError, 'No price history'):
            self.fetch()

    def test_rejects_unsupported_currency(self):
        self.ticker.get_history_metadata.return_value = {'currency': 'GBP'}
        with self.assertRaisesRegex(ValueError, 'Unsupported quote currency'):
            self.fetch()

    def test_rejects_invalid_closes(self):
        for close in (0, -1, float('nan'), float('inf'), 'abc'):
            with self.subTest(close=close):
                self.ticker.history.return_value = History([(datetime(2025, 1, 3), {'Close': close})])
                with self.assertRaisesRegex(ValueError, 'Invalid security price'):
                    self.fetch()

    def test_rejects_an_inverted_range(self):
        with self.assertRaisesRegex(ValueError, 'start must not be after end'):
            fetch_price_history('ONE', '2025-02-01', '2025-01-01', self.factory)
        self.factory.assert_not_called()


class RefreshPriceHistoryTests(unittest.TestCase):
    ROW = {'symbol': 'ONE', 'observedOn': '2025-01-06', 'close': '120.5', 'currency': 'USD'}

    def test_fetches_everything_before_the_transaction(self):
        connection = MagicMock()
        with patch('worker.prices.fetch_price_history', side_effect=[[self.ROW], RuntimeError('Yahoo unavailable')]):
            with self.assertRaises(RuntimeError):
                refresh_price_history(connection, ['ONE', 'TWO'], '2025-01-01', '2025-01-10')
        connection.transaction.assert_not_called()
        connection.execute.assert_not_called()

    def test_creates_the_table_and_upserts_every_row_in_one_transaction(self):
        connection = MagicMock()
        second = {**self.ROW, 'observedOn': '2025-01-07', 'close': '121'}
        with patch('worker.prices.fetch_price_history', return_value=[self.ROW, second]) as fetch:
            self.assertEqual(refresh_price_history(connection, ['ONE'], '2025-01-01', '2025-01-10'), 2)
        fetch.assert_called_once_with('ONE', '2025-01-01', '2025-01-10', None)
        connection.transaction.assert_called_once()
        statements = [call.args for call in connection.execute.call_args_list]
        self.assertIn('CREATE TABLE IF NOT EXISTS security_prices', statements[0][0])
        self.assertIn('PRIMARY KEY (symbol, observed_on)', statements[0][0])
        self.assertIn('ON CONFLICT (symbol, observed_on) DO UPDATE', statements[1][0])
        self.assertEqual(statements[1][1], ('ONE', '2025-01-06', '120.5', 'USD'))
        self.assertEqual(statements[2][1], ('ONE', '2025-01-07', '121', 'USD'))

    def test_write_failure_rolls_back_with_the_error(self):
        connection = MagicMock()
        connection.execute.side_effect = RuntimeError('write failed')
        with patch('worker.prices.fetch_price_history', return_value=[self.ROW]):
            with self.assertRaises(RuntimeError):
                refresh_price_history(connection, ['ONE'], '2025-01-01', '2025-01-10')
        self.assertIs(connection.transaction.return_value.__exit__.call_args.args[0], RuntimeError)
