import unittest
from datetime import datetime
from unittest.mock import Mock

from worker.fx import fetch_rates, refresh_rates, main


class History:
    def __init__(self, rows):
        self.rows = rows

    def iterrows(self):
        return iter(self.rows)


class CommandTests(unittest.TestCase):
    def test_command_connects_refreshes_and_closes(self):
        from unittest.mock import MagicMock, patch
        connection = MagicMock()
        with patch('psycopg.connect', return_value=connection) as connect, \
                patch('worker.fx.refresh_rates', return_value=3) as refresh, \
                patch.dict('os.environ', {'DATABASE_URL': 'postgresql://synthetic'}), \
                patch('builtins.print') as output:
            main(['1991-01-01', '1991-01-05'])
        connect.assert_called_once_with('postgresql://synthetic')
        refresh.assert_called_once_with(connection.__enter__.return_value, '1991-01-01', '1991-01-05')
        connection.__exit__.assert_called_once()
        output.assert_called_once_with('Cached 3 USD/EUR observations')

    def test_default_adapter_loads_yfinance(self):
        from unittest.mock import patch
        with patch('yfinance.Ticker') as factory:
            factory.return_value.history.return_value = History([(datetime(1991, 1, 4), {'Close': 0.9})])
            self.assertEqual(fetch_rates('1991-01-04', '1991-01-04')[0]['eurPerUsd'], '0.9')


class RefreshRatesTests(unittest.TestCase):
    def test_writes_observations_in_one_transaction(self):
        from unittest.mock import MagicMock
        connection = MagicMock()
        factory = Mock()
        factory.return_value.history.return_value = History([
            (datetime(2026, 1, 2), {'Close': 0.9}),
        ])
        self.assertEqual(refresh_rates(connection, '2026-01-02', '2026-01-05', factory), 1)
        connection.transaction.assert_called_once_with()
        self.assertEqual(connection.execute.call_count, 2)
        query, params = connection.execute.call_args.args
        self.assertIn('ON CONFLICT', query)
        self.assertEqual(params, ('2026-01-02', '0.9'))

    def test_provider_failure_never_touches_database(self):
        from unittest.mock import MagicMock
        connection = MagicMock()
        factory = Mock()
        factory.return_value.history.side_effect = RuntimeError('Unavailable')
        with self.assertRaises(RuntimeError):
            refresh_rates(connection, '2026-01-02', '2026-01-05', factory)
        connection.transaction.assert_not_called()
        connection.execute.assert_not_called()

    def test_write_failure_exits_transaction_with_error(self):
        from unittest.mock import MagicMock
        connection = MagicMock()
        connection.execute.side_effect = [None, RuntimeError('Write failed')]
        factory = Mock()
        factory.return_value.history.return_value = History([
            (datetime(2026, 1, 2), {'Close': 0.9}),
        ])
        with self.assertRaisesRegex(RuntimeError, 'Write failed'):
            refresh_rates(connection, '2026-01-02', '2026-01-05', factory)
        self.assertEqual(connection.transaction.return_value.__exit__.call_args.args[0], RuntimeError)


class FetchRatesTests(unittest.TestCase):
    def setUp(self):
        self.ticker = Mock()
        self.factory = Mock(return_value=self.ticker)

    def fetch(self, rows, start='2026-01-02', end='2026-01-05'):
        self.ticker.history.return_value = History(rows)
        return fetch_rates(start, end, self.factory)

    def test_requests_direct_usd_to_eur_daily_close(self):
        result = self.fetch([(datetime(2026, 1, 2), {'Close': 0.9})])
        self.assertEqual(result, [{'date': '2026-01-02', 'eurPerUsd': '0.9'}])
        self.factory.assert_called_once_with('USDEUR=X')
        self.ticker.history.assert_called_once_with(
            start='2026-01-02', end='2026-01-06', interval='1d',
            auto_adjust=False, actions=False, timeout=20, raise_errors=True)

    def test_preserves_observation_dates(self):
        self.assertEqual(self.fetch([
            (datetime(2026, 1, 2), {'Close': 0.9}),
            (datetime(2026, 1, 5), {'Close': 0.8}),
        ]), [{'date': '2026-01-02', 'eurPerUsd': '0.9'},
             {'date': '2026-01-05', 'eurPerUsd': '0.8'}])

    def test_formats_small_rates_without_scientific_notation(self):
        self.assertEqual(self.fetch([(datetime(2026, 1, 2), {'Close': 1e-7})])[0]['eurPerUsd'], '0.0000001')

    def test_rejects_empty_history(self):
        with self.assertRaisesRegex(ValueError, 'No historical FX observations'):
            self.fetch([])

    def test_rejects_invalid_observations(self):
        for close in [0, -1, float('nan'), float('inf'), 'bad', None]:
            with self.subTest(close=close), self.assertRaises(ValueError):
                self.fetch([(datetime(2026, 1, 2), {'Close': close})])

    def test_rejects_out_of_range_and_duplicate_dates(self):
        for rows in [
            [(datetime(2026, 1, 1), {'Close': 0.9})],
            [(datetime(2026, 1, 6), {'Close': 0.9})],
            [(datetime(2026, 1, 2), {'Close': 0.9})] * 2,
        ]:
            with self.subTest(rows=rows), self.assertRaises(ValueError):
                self.fetch(rows)

    def test_validates_date_range_before_network_call(self):
        for start, end in [('bad', '2026-01-05'), ('2026-01-06', '2026-01-05')]:
            with self.subTest(start=start), self.assertRaises(ValueError):
                self.fetch([], start, end)
        self.factory.assert_not_called()

    def test_propagates_provider_failure(self):
        self.ticker.history.side_effect = RuntimeError('Yahoo unavailable')
        with self.assertRaisesRegex(RuntimeError, 'Yahoo unavailable'):
            fetch_rates('2026-01-02', '2026-01-05', self.factory)
