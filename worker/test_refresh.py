import sys
import unittest
from datetime import date
from unittest.mock import MagicMock, call, patch

from worker.refresh import load_activities, main, plan_refresh, refresh_import, refresh_intraday, run_every

TODAY = date(2026, 3, 20)


def trade(kind, symbol, quantity, currency='EUR', day='2026-01-05', account='a1'):
    return {'accountId': account, 'type': kind, 'symbol': symbol, 'currency': currency,
            'quantity': quantity, 'unitPrice': 10, 'fee': 0, 'date': f'{day}T10:00:00.000Z'}


def document(*activities):
    return list(activities)


class PlanRefreshTests(unittest.TestCase):
    def test_fx_range_starts_at_earliest_usd_trade_and_ends_today(self):
        plan = plan_refresh(document(
            trade('BUY', 'A', 1, 'USD', '2020-02-03'),
            trade('BUY', 'B', 1, 'USD', '2024-06-01'),
            trade('BUY', 'C', 1, 'EUR', '2019-01-01')), TODAY)
        self.assertEqual((plan['fxStart'], plan['fxEnd']), (date(2020, 2, 3), TODAY))

    def test_fx_range_always_covers_the_quote_date_fx_window(self):
        # A quote may be 7 days old and its FX up to 7 days earlier than the quote.
        eur_only = plan_refresh(document(trade('BUY', 'A', 1, 'EUR', '2019-01-01')), TODAY)
        self.assertEqual(eur_only['fxStart'], date(2026, 3, 6))
        recent_usd = plan_refresh(document(trade('BUY', 'A', 1, 'USD', '2026-03-18')), TODAY)
        self.assertEqual(recent_usd['fxStart'], date(2026, 3, 6))

    def test_held_symbols_are_unique_sorted_and_exclude_closed_positions(self):
        plan = plan_refresh(document(
            trade('BUY', 'ZZZ', 2, account='a1'),
            trade('BUY', 'ZZZ', 1, account='a2'),
            trade('BUY', 'AAA', 1),
            trade('BUY', 'CLOSED', 3),
            trade('SELL', 'CLOSED', 3, day='2026-02-01')), TODAY)
        self.assertEqual(plan['symbols'], ['AAA', 'ZZZ'])

    def test_decimal_quantities_are_exact(self):
        plan = plan_refresh(document(
            trade('BUY', 'X', 0.1), trade('BUY', 'X', 0.2),
            trade('SELL', 'X', 0.3, day='2026-02-01')), TODAY)
        self.assertEqual(plan['symbols'], [])

    def test_symbol_closed_in_one_account_is_held_in_another(self):
        plan = plan_refresh(document(
            trade('BUY', 'X', 1, account='a1'), trade('SELL', 'X', 1, account='a1', day='2026-02-01'),
            trade('BUY', 'X', 1, account='a2')), TODAY)
        self.assertEqual(plan['symbols'], ['X'])


class PlanHistoryTests(unittest.TestCase):
    def test_history_starts_at_the_earliest_trade_in_any_currency(self):
        plan = plan_refresh(document(
            trade('BUY', 'A', 1, 'EUR', '2025-03-01'), trade('BUY', 'B', 1, 'USD', '2025-06-01')), TODAY)
        self.assertEqual(plan['historyStart'], date(2025, 3, 1))

    def test_history_symbols_include_closed_positions_once_and_sorted(self):
        plan = plan_refresh(document(
            trade('BUY', 'ZZZ', 1, account='a1'), trade('BUY', 'ZZZ', 1, account='a2'),
            trade('BUY', 'CLOSED', 3), trade('SELL', 'CLOSED', 3, day='2026-02-01')), TODAY)
        self.assertEqual(plan['historySymbols'], ['CLOSED', 'ZZZ'])
        self.assertEqual(plan['symbols'], ['ZZZ'])

    def test_empty_import_has_no_history(self):
        plan = plan_refresh(document(), TODAY)
        self.assertEqual((plan['historyStart'], plan['historySymbols']), (None, []))


class LoadActivitiesTests(unittest.TestCase):
    def connection(self, table, rows=()):
        connection = MagicMock()
        connection.execute.return_value.fetchone.return_value = (table,)
        connection.execute.return_value.fetchall.return_value = list(rows)
        return connection

    def test_returns_buys_and_sells_from_the_ledger(self):
        connection = self.connection('transactions', [('acc-1', 'BUY', 'AAA', 'USD', '2.8', '2026-01-05')])
        self.assertEqual(load_activities(connection), [
            {'accountId': 'acc-1', 'type': 'BUY', 'symbol': 'AAA', 'currency': 'USD', 'quantity': '2.8', 'date': '2026-01-05'}])
        query = connection.execute.call_args.args[0]
        self.assertIn('transactions', query)
        self.assertIn("type IN ('BUY', 'SELL')", query)

    def test_an_uninitialised_ledger_has_no_activities(self):
        connection = self.connection(None)
        self.assertEqual(load_activities(connection), [])
        self.assertEqual(connection.execute.call_count, 1)


class RefreshImportTests(unittest.TestCase):
    def setUp(self):
        self.connection = MagicMock()
        self.activities = document(trade('BUY', 'AAA', 1, 'USD', '2025-01-02'), trade('BUY', 'BBB', 1))
        patcher = patch('worker.refresh.load_activities', side_effect=lambda connection: self.activities)
        patcher.start()
        self.addCleanup(patcher.stop)

    def refresh(self, **overrides):
        options = {'rates': MagicMock(return_value=7), 'quotes': MagicMock(return_value=1),
                   'prices': MagicMock(return_value=0)}
        options.update(overrides)
        return refresh_import(self.connection, TODAY, **options)

    def test_dry_run_reports_plan_without_fetching_or_writing(self):
        rates, quotes, prices = MagicMock(), MagicMock(), MagicMock()
        summary = self.refresh(dry_run=True, rates=rates, quotes=quotes, prices=prices)
        self.assertEqual(summary, 'Dry run: FX 2025-01-02..2026-03-20, 2 quote symbols, '
                                  'price history 2025-01-02..2026-03-20 for 2 symbols; nothing fetched or written')
        for fetcher in (rates, quotes, prices):
            fetcher.assert_not_called()
        self.assertNotIn('AAA', summary)

    def test_dry_run_of_a_ledger_without_trades_reports_no_price_history(self):
        self.activities = document()
        summary = self.refresh(dry_run=True)
        self.assertEqual(summary, 'Dry run: FX 2026-03-06..2026-03-20, 0 quote symbols, '
                                  'price history none for 0 symbols; nothing fetched or written')

    def test_refreshes_rates_quotes_then_price_history_and_reports_counts(self):
        order = MagicMock()
        order.rates.return_value = 7
        order.quotes.return_value = 1
        order.prices.side_effect = [3, 2]
        summary = self.refresh(rates=order.rates, quotes=order.quotes, prices=order.prices)
        self.assertEqual(order.mock_calls, [call.rates(self.connection, '2025-01-02', '2026-03-20'),
                                            call.quotes(self.connection, ['AAA']),
                                            call.quotes(self.connection, ['BBB']),
                                            call.prices(self.connection, ['AAA'], '2025-01-02', '2026-03-20'),
                                            call.prices(self.connection, ['BBB'], '2025-01-02', '2026-03-20')])
        self.assertEqual(summary, 'Processed 7 FX observations, 2 security quotes and 5 price history rows')

    def test_one_failing_symbol_does_not_stop_the_others(self):
        quotes = MagicMock(side_effect=[ValueError('AAA: possibly delisted\nsecond line'), 1])
        summary = self.refresh(quotes=quotes)
        self.assertEqual(quotes.call_args_list, [call(self.connection, ['AAA']), call(self.connection, ['BBB'])])
        self.assertEqual(summary, 'Processed 7 FX observations, 1 security quotes and 0 price history rows; '
                                  '1 failed: AAA (AAA: possibly delisted)')

    def test_failure_without_a_message_names_the_error_type(self):
        summary = self.refresh(quotes=MagicMock(side_effect=[RuntimeError(), 1]))
        self.assertEqual(summary, 'Processed 7 FX observations, 1 security quotes and 0 price history rows; '
                                  '1 failed: AAA (RuntimeError)')

    def test_reports_every_failed_symbol(self):
        summary = self.refresh(quotes=MagicMock(side_effect=[ValueError('x'), ValueError('y')]))
        self.assertEqual(summary, 'Processed 7 FX observations, 0 security quotes and 0 price history rows; '
                                  '2 failed: AAA (x), BBB (y)')

    def test_a_failing_price_history_does_not_stop_the_others_and_is_reported(self):
        prices = MagicMock(side_effect=[ValueError('no data\nsecond line'), 4])
        summary = self.refresh(prices=prices)
        self.assertEqual(prices.call_count, 2)
        self.assertEqual(summary, 'Processed 7 FX observations, 2 security quotes and 4 price history rows; '
                                  '1 failed: AAA history (no data)')

    def test_price_history_covers_closed_positions_but_quotes_do_not(self):
        self.activities = document(
            trade('BUY', 'HELD', 1, day='2025-04-01'),
            trade('BUY', 'GONE', 2, day='2025-02-01'), trade('SELL', 'GONE', 2, day='2025-05-01'))
        quotes, prices = MagicMock(return_value=1), MagicMock(return_value=1)
        self.refresh(quotes=quotes, prices=prices)
        self.assertEqual(quotes.call_args_list, [call(self.connection, ['HELD'])])
        self.assertEqual(prices.call_args_list, [call(self.connection, ['GONE'], '2025-02-01', '2026-03-20'),
                                                 call(self.connection, ['HELD'], '2025-02-01', '2026-03-20')])

    def test_skips_quotes_and_prices_when_there_are_no_trades(self):
        self.activities = document()
        quotes, prices = MagicMock(), MagicMock()
        summary = self.refresh(rates=MagicMock(return_value=3), quotes=quotes, prices=prices)
        quotes.assert_not_called()
        prices.assert_not_called()
        self.assertEqual(summary, 'Processed 3 FX observations, 0 security quotes and 0 price history rows')

    def test_rate_failure_prevents_quote_and_price_refresh(self):
        quotes, prices = MagicMock(), MagicMock()
        with self.assertRaisesRegex(ValueError, 'boom'):
            self.refresh(rates=MagicMock(side_effect=ValueError('boom')), quotes=quotes, prices=prices)
        quotes.assert_not_called()
        prices.assert_not_called()


class RefreshIntradayTests(unittest.TestCase):
    def setUp(self):
        self.connection = MagicMock()
        self.activities = document(trade('BUY', 'AAA', 1, 'USD', '2020-01-02'), trade('BUY', 'BBB', 1),
                                   trade('BUY', 'GONE', 1), trade('SELL', 'GONE', 1, day='2026-02-01'))
        patcher = patch('worker.refresh.load_activities', side_effect=lambda connection: self.activities)
        patcher.start()
        self.addCleanup(patcher.stop)

    def refresh(self, **overrides):
        options = {'rates': MagicMock(return_value=2), 'prices': MagicMock(return_value=3)}
        options.update(overrides)
        return refresh_intraday(self.connection, TODAY, **options)

    def test_fetches_only_the_recent_window_for_held_symbols(self):
        order = MagicMock()
        order.rates.return_value = 2
        order.prices.return_value = 3
        summary = self.refresh(rates=order.rates, prices=order.prices)
        self.assertEqual(order.mock_calls, [call.rates(self.connection, '2026-03-13', '2026-03-20'),
                                            call.prices(self.connection, ['AAA'], '2026-03-13', '2026-03-20'),
                                            call.prices(self.connection, ['BBB'], '2026-03-13', '2026-03-20')])
        self.assertEqual(summary, 'Processed 2 FX observations and 6 price rows')

    def test_one_failing_symbol_does_not_stop_the_others(self):
        prices = MagicMock(side_effect=[ValueError('no data\nsecond line'), 4])
        summary = self.refresh(prices=prices)
        self.assertEqual(prices.call_count, 2)
        self.assertEqual(summary, 'Processed 2 FX observations and 4 price rows; 1 failed: AAA (no data)')

    def test_skips_prices_when_nothing_is_held(self):
        self.activities = document()
        prices = MagicMock()
        summary = self.refresh(prices=prices)
        prices.assert_not_called()
        self.assertEqual(summary, 'Processed 2 FX observations and 0 price rows')

    def test_rate_failure_prevents_price_refresh(self):
        prices = MagicMock()
        with self.assertRaisesRegex(ValueError, 'boom'):
            self.refresh(rates=MagicMock(side_effect=ValueError('boom')), prices=prices)
        prices.assert_not_called()


class StopLoop(Exception):
    pass


class RunEveryTests(unittest.TestCase):
    def test_repeats_with_interval_and_survives_failures(self):
        action = MagicMock(side_effect=['first', ValueError('yahoo down'), 'third'])
        sleep = MagicMock(side_effect=[None, None, StopLoop()])
        with patch('builtins.print') as output, self.assertRaises(StopLoop):
            run_every(action, 60, sleep=sleep)
        self.assertEqual(action.call_count, 3)
        self.assertEqual(sleep.call_args_list, [call(60)] * 3)
        self.assertEqual(output.call_args_list, [
            call('first'),
            call('Refresh failed: yahoo down', file=sys.stderr),
            call('third'),
        ])


class CommandTests(unittest.TestCase):
    def run_main(self, argv):
        connection = MagicMock()
        with patch('psycopg.connect', return_value=connection) as connect, \
                patch('worker.refresh.refresh_import', return_value='summary') as refresh, \
                patch.dict('os.environ', {'DATABASE_URL': 'postgresql://synthetic'}), \
                patch('builtins.print') as output:
            main(argv)
        return connect, connection, refresh, output

    def test_runs_once_and_prints_summary(self):
        connect, connection, refresh, output = self.run_main([])
        connect.assert_called_once_with('postgresql://synthetic')
        refresh.assert_called_once()
        self.assertEqual(refresh.call_args.args[:1], (connection.__enter__.return_value,))
        self.assertFalse(refresh.call_args.kwargs['dry_run'])
        output.assert_called_once_with('summary')

    def test_dry_run_flag_is_passed_through(self):
        _, _, refresh, _ = self.run_main(['--dry-run'])
        self.assertTrue(refresh.call_args.kwargs['dry_run'])

    def test_every_runs_the_refresh_on_a_schedule(self):
        with patch('worker.refresh.run_every') as schedule:
            self.run_main(['--every', '3600'])
        action, seconds = schedule.call_args.args
        self.assertEqual(seconds, 3600)
        with patch('worker.refresh.refresh_import', return_value='again') as refresh, \
                patch('psycopg.connect') as connect, \
                patch.dict('os.environ', {'DATABASE_URL': 'postgresql://synthetic'}):
            self.assertEqual(action(), 'again')
        connect.assert_called_once_with('postgresql://synthetic')
        refresh.assert_called_once()

    def test_intraday_flag_runs_the_light_refresh_on_a_schedule(self):
        with patch('worker.refresh.run_every') as schedule:
            self.run_main(['--intraday', '--every', '300'])
        action, seconds = schedule.call_args.args
        self.assertEqual(seconds, 300)
        with patch('worker.refresh.refresh_intraday', return_value='light') as intraday, \
                patch('worker.refresh.refresh_import') as full, \
                patch('psycopg.connect') as connect, \
                patch.dict('os.environ', {'DATABASE_URL': 'postgresql://synthetic'}):
            self.assertEqual(action(), 'light')
        connect.assert_called_once_with('postgresql://synthetic')
        intraday.assert_called_once()
        full.assert_not_called()

    def test_intraday_cannot_be_combined_with_dry_run(self):
        with patch('psycopg.connect') as connect, patch('sys.stderr'):
            with self.assertRaises(SystemExit):
                main(['--intraday', '--dry-run'])
        connect.assert_not_called()

    def test_requires_a_positive_interval_and_no_import_id(self):
        with patch('psycopg.connect') as connect, patch('sys.stderr'):
            with self.assertRaises(SystemExit):
                main(['--every', '0'])
            with self.assertRaises(SystemExit):
                main(['--every', 'x'])
            with self.assertRaises(SystemExit):
                main(['abc'])
        connect.assert_not_called()


if __name__ == '__main__':
    unittest.main()
