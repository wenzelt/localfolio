import unittest
from datetime import datetime
from unittest.mock import MagicMock, Mock, patch

from worker.prices import fetch_history, fetch_price_history, refresh_price_history


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

    def test_requests_daily_closes_with_corporate_actions_including_the_end_date(self):
        self.fetch()
        self.factory.assert_called_once_with('ONE')
        self.ticker.history.assert_called_once_with(
            start='2025-01-01', end='2025-01-11', interval='1d', auto_adjust=False,
            actions=True, timeout=20, raise_errors=True)

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
        with patch('worker.prices.fetch_history', side_effect=[([self.ROW], []), RuntimeError('Yahoo unavailable')]):
            with self.assertRaises(RuntimeError):
                refresh_price_history(connection, ['ONE', 'TWO'], '2025-01-01', '2025-01-10')
        connection.transaction.assert_not_called()
        connection.execute.assert_not_called()

    def test_creates_the_table_and_upserts_every_row_in_one_transaction(self):
        connection = MagicMock()
        second = {**self.ROW, 'observedOn': '2025-01-07', 'close': '121'}
        with patch('worker.prices.fetch_history', return_value=([self.ROW, second], [])) as fetch:
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
        with patch('worker.prices.fetch_history', return_value=([self.ROW], [])):
            with self.assertRaises(RuntimeError):
                refresh_price_history(connection, ['ONE'], '2025-01-01', '2025-01-10')
        self.assertIs(connection.transaction.return_value.__exit__.call_args.args[0], RuntimeError)


class FetchSplitsTests(unittest.TestCase):
    def history(self, *rows):
        ticker = Mock()
        ticker.get_history_metadata.return_value = {'currency': 'EUR'}
        ticker.history.return_value = History(list(rows))
        return Mock(return_value=ticker)

    def test_reads_the_split_days_with_the_ratio_of_new_shares_per_old_share(self):
        factory = self.history(
            (datetime(2026, 11, 20), {'Close': 4.4666667, 'Stock Splits': 0.0}),
            (datetime(2026, 11, 23), {'Close': 4.7, 'Stock Splits': 60.0}))
        rows, splits = fetch_history('ANX.PA', '2026-11-16', '2026-11-23', factory)
        self.assertEqual(len(rows), 2)
        self.assertEqual(splits, [{'symbol': 'ANX.PA', 'effectiveOn': '2026-11-23', 'ratio': '60'}])

    def test_a_reverse_split_has_a_ratio_below_one(self):
        factory = self.history((datetime(2026, 5, 4), {'Close': 50, 'Stock Splits': 0.1}))
        self.assertEqual(fetch_history('X', '2026-05-01', '2026-05-05', factory)[1][0]['ratio'], '0.1')

    def test_rows_without_an_actions_column_have_no_splits(self):
        factory = self.history((datetime(2025, 1, 3), {'Close': 119}))
        self.assertEqual(fetch_history('X', '2025-01-01', '2025-01-10', factory)[1], [])

    def test_rejects_a_split_ratio_that_is_not_positive_and_finite(self):
        for ratio in (-2, float('nan'), float('inf')):
            with self.subTest(ratio=ratio):
                factory = self.history((datetime(2025, 1, 3), {'Close': 119, 'Stock Splits': ratio}))
                with self.assertRaisesRegex(ValueError, 'Invalid split ratio'):
                    fetch_history('X', '2025-01-01', '2025-01-10', factory)


class RefreshSplitTests(unittest.TestCase):
    ROW = {'symbol': 'ANX.PA', 'observedOn': '2026-11-23', 'close': '4.7', 'currency': 'EUR'}
    OLD = {**ROW, 'observedOn': '2026-10-01', 'close': '4'}
    SPLIT = {'symbol': 'ANX.PA', 'effectiveOn': '2026-11-23', 'ratio': '60'}

    def connection(self, stored):
        connection = MagicMock()

        def execute(statement, parameters=None):
            result = MagicMock()
            if 'to_regclass' in statement:
                result.fetchone.return_value = ('security_splits' if stored else None,)
            else:
                result.fetchone.return_value = (1,) if stored else None
            return result
        connection.execute.side_effect = execute
        return connection

    def test_a_new_split_refetches_the_whole_history_so_old_closes_are_adjusted_too(self):
        connection = self.connection(stored=False)
        with patch('worker.prices.fetch_history', side_effect=[([self.ROW], [self.SPLIT]), ([self.OLD, self.ROW], [self.SPLIT])]) as fetch:
            count = refresh_price_history(connection, ['ANX.PA'], '2026-11-16', '2026-11-23', full_start='2026-09-24')
        self.assertEqual(count, 2)
        self.assertEqual([call.args[1] for call in fetch.call_args_list], ['2026-11-16', '2026-09-24'])
        statements = [call.args for call in connection.execute.call_args_list]
        self.assertTrue(any(args[1] == ('ANX.PA', '2026-10-01', '4', 'EUR') for args in statements if len(args) > 1))
        stored = [args for args in statements if 'INSERT INTO security_splits' in args[0]]
        self.assertEqual(stored[0][1], ('ANX.PA', '2026-11-23', '60'))

    def test_a_split_that_is_already_stored_does_not_refetch(self):
        connection = self.connection(stored=True)
        with patch('worker.prices.fetch_history', return_value=([self.ROW], [self.SPLIT])) as fetch:
            refresh_price_history(connection, ['ANX.PA'], '2026-11-16', '2026-11-23', full_start='2026-09-24')
        fetch.assert_called_once()

    def test_a_window_that_already_starts_at_the_first_trade_is_not_fetched_twice_and_still_stores_the_split(self):
        connection = self.connection(stored=False)
        with patch('worker.prices.fetch_history', return_value=([self.OLD, self.ROW], [self.SPLIT])) as fetch:
            refresh_price_history(connection, ['ANX.PA'], '2026-09-24', '2026-11-23', full_start='2026-09-24')
        fetch.assert_called_once()
        self.assertTrue(any('INSERT INTO security_splits' in call.args[0] for call in connection.execute.call_args_list))

    def test_a_failing_second_fetch_stores_nothing(self):
        connection = self.connection(stored=False)
        with patch('worker.prices.fetch_history', side_effect=[([self.ROW], [self.SPLIT]), RuntimeError('Yahoo unavailable')]):
            with self.assertRaises(RuntimeError):
                refresh_price_history(connection, ['ANX.PA'], '2026-11-16', '2026-11-23', full_start='2026-09-24')
        connection.transaction.assert_not_called()
