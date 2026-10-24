import unittest
from datetime import datetime
from unittest.mock import Mock, patch

from worker.quotes import fetch_quote, refresh_quotes, main


class History:
    def __init__(self, rows):
        self.rows = rows

    def iterrows(self):
        return iter(self.rows)


class CommandTests(unittest.TestCase):
    def test_connects_refreshes_and_reports_processed_quotes(self):
        from unittest.mock import MagicMock
        connection = MagicMock()
        with patch('psycopg.connect', return_value=connection) as connect, \
                patch('worker.quotes.refresh_quotes', return_value=2) as refresh, \
                patch.dict('os.environ', {'DATABASE_URL': 'postgresql://synthetic'}), \
                patch('builtins.print') as output:
            main(['ONE', 'TWO'])
        connect.assert_called_once_with('postgresql://synthetic')
        refresh.assert_called_once_with(connection.__enter__.return_value, ['ONE', 'TWO'])
        connection.__exit__.assert_called_once()
        output.assert_called_once_with('Processed 2 security quotes')

    def test_requires_symbols_before_connecting(self):
        with patch('psycopg.connect') as connect, patch('sys.stderr'):
            with self.assertRaises(SystemExit) as error:
                main([])
        self.assertEqual(error.exception.code, 2)
        connect.assert_not_called()


class RefreshQuotesTests(unittest.TestCase):
    def test_fetches_all_quotes_before_transaction(self):
        from unittest.mock import MagicMock
        connection = MagicMock()
        with patch('worker.quotes.fetch_quote', side_effect=[
                {'symbol': 'ONE', 'observedOn': '2025-01-06', 'price': '120.5', 'currency': 'USD', 'source': 'yfinance'},
                RuntimeError('Yahoo unavailable')]):
            with self.assertRaises(RuntimeError):
                refresh_quotes(connection, ['ONE', 'TWO'])
        connection.transaction.assert_not_called()
        connection.execute.assert_not_called()

    def test_upserts_in_one_transaction(self):
        from unittest.mock import MagicMock
        connection = MagicMock()
        quote = {'symbol': 'ONE', 'observedOn': '2025-01-06', 'price': '120.5', 'currency': 'USD', 'source': 'yfinance'}
        with patch('worker.quotes.fetch_quote', return_value=quote):
            self.assertEqual(refresh_quotes(connection, ['ONE']), 1)
        connection.transaction.assert_called_once()
        statement, parameters = connection.execute.call_args.args
        self.assertIn('ON CONFLICT', statement)
        self.assertEqual(parameters, ('ONE', '2025-01-06', '120.5', 'USD'))

    def test_write_failure_leaves_transaction_with_error(self):
        from unittest.mock import MagicMock
        connection = MagicMock()
        connection.execute.side_effect = RuntimeError('write failed')
        quote = {'symbol': 'ONE', 'observedOn': '2025-01-06', 'price': '120.5', 'currency': 'USD', 'source': 'yfinance'}
        with patch('worker.quotes.fetch_quote', return_value=quote):
            with self.assertRaises(RuntimeError):
                refresh_quotes(connection, ['ONE'])
        self.assertIs(connection.transaction.return_value.__exit__.call_args.args[0], RuntimeError)


class FetchQuoteTests(unittest.TestCase):
    def setUp(self):
        self.ticker = Mock()
        self.factory = Mock(return_value=self.ticker)
        self.ticker.get_history_metadata.return_value = {'currency': 'USD'}
        self.ticker.history.return_value = History([
            (datetime(2025, 1, 6), {'Close': 120.5}),
            (datetime(2025, 1, 3), {'Close': 119}),
        ])

    def test_fetches_latest_unadjusted_daily_close_with_currency(self):
        self.assertEqual(fetch_quote('TEST', self.factory), {
            'symbol': 'TEST', 'observedOn': '2025-01-06',
            'price': '120.5', 'currency': 'USD', 'source': 'yfinance',
        })
        self.factory.assert_called_once_with('TEST')
        self.ticker.history.assert_called_once_with(
            period='5d', interval='1d', auto_adjust=False, actions=False,
            timeout=20, raise_errors=True)

    def test_preserves_eur_and_formats_tiny_prices(self):
        self.ticker.get_history_metadata.return_value = {'currency': 'EUR'}
        self.ticker.history.return_value = History([
            (datetime(2025, 1, 6), {'Close': 1e-7}),
        ])
        quote = fetch_quote('TEST', self.factory)
        self.assertEqual((quote['currency'], quote['price']), ('EUR', '0.0000001'))

    def test_rejects_empty_history(self):
        self.ticker.history.return_value = History([])
        with self.assertRaisesRegex(ValueError, 'No security quote'):
            fetch_quote('TEST', self.factory)

    def test_rejects_missing_or_unsupported_currency(self):
        for metadata in [{}, {'currency': None}, {'currency': 'GBP'}, {'currency': 'GBp'}]:
            with self.subTest(metadata=metadata), self.assertRaises(ValueError):
                self.ticker.get_history_metadata.return_value = metadata
                fetch_quote('TEST', self.factory)

    def test_rejects_invalid_latest_prices(self):
        for price in [0, -1, float('nan'), float('inf'), None, 'bad']:
            with self.subTest(price=price), self.assertRaises(ValueError):
                self.ticker.history.return_value = History([
                    (datetime(2025, 1, 6), {'Close': price}),
                ])
                fetch_quote('TEST', self.factory)

    def test_provider_failure_propagates(self):
        self.ticker.history.side_effect = RuntimeError('Yahoo unavailable')
        with self.assertRaisesRegex(RuntimeError, 'Yahoo unavailable'):
            fetch_quote('TEST', self.factory)

    def test_rejects_blank_symbol_before_provider_call(self):
        with self.assertRaises(ValueError):
            fetch_quote(' ', self.factory)
        self.factory.assert_not_called()

    def test_default_adapter_uses_yfinance(self):
        with patch('yfinance.Ticker', self.factory):
            self.assertEqual(fetch_quote('TEST')['symbol'], 'TEST')
