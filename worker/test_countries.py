from datetime import date
from io import StringIO
import json
import unittest
from unittest.mock import MagicMock, call, patch

import pandas as pd

from worker.countries import parse_countries, parse_source_date, refresh_countries


def top_holdings(holdings):
    """Top holdings as yfinance returns them: indexed by symbol, each holding's share of the fund as a fraction."""
    symbols = [symbol for symbol, _ in holdings]
    return pd.DataFrame({'Symbol': symbols, 'Name': symbols, 'Holding Percent': [share for _, share in holdings]}).set_index('Symbol')


class FakeYahoo:
    """Stands in for yfinance.Ticker. An info value that is an exception is raised instead of returned."""

    def __init__(self, infos, holdings=None):
        self.infos, self.holdings, self.info_requests = infos, holdings or {}, []

    def __call__(self, symbol):
        ticker = MagicMock()
        ticker.get_info.side_effect = lambda: self.info(symbol)
        ticker.funds_data.top_holdings = top_holdings(self.holdings[symbol]) if symbol in self.holdings else None
        return ticker

    def info(self, symbol):
        self.info_requests.append(symbol)
        info = self.infos[symbol]
        if isinstance(info, Exception):
            raise info
        return info


def cache(source=None):
    """Connection whose cache already holds a composition from `source` for every symbol, or none when `source` is None."""
    connection = MagicMock()
    connection.execute.return_value.fetchone.return_value = None if source is None else (source,)
    return connection


def written(connection):
    return [c.args[1] for c in connection.execute.call_args_list if 'INSERT INTO' in c.args[0]]


class CountryTests(unittest.TestCase):
    def test_cli_refreshes_open_symbols_with_mapping(self):
        from worker.countries import main
        with patch('sys.argv', ['countries']), patch('pathlib.Path.read_text', return_value='{}'), patch('psycopg.connect') as connect, patch('worker.refresh.load_activities', return_value=[]), patch('worker.refresh.plan_refresh', return_value={'symbols': ['STOCK']}), patch('worker.countries.refresh_countries', return_value=1) as refresh:
            main()
            refresh.assert_called_once_with(connect.return_value.__enter__.return_value, ['STOCK'], {}, look_through=True)

    def test_stocks_only_cli_does_not_load_or_use_fund_mapping_or_look_through(self):
        from worker.countries import main
        with patch('sys.argv', ['countries', '--stocks-only']), patch('pathlib.Path.read_text') as read_mapping, patch('psycopg.connect') as connect, patch('worker.refresh.load_activities', return_value=[]), patch('worker.refresh.plan_refresh', return_value={'symbols': ['STOCK', 'FUND']}), patch('worker.countries.refresh_countries', return_value=1) as refresh:
            main()
            read_mapping.assert_not_called()
            refresh.assert_called_once_with(connect.return_value.__enter__.return_value, ['STOCK', 'FUND'], {}, look_through=False)

    def test_yahoo_only_cli_skips_the_fund_mapping_but_keeps_the_fund_look_through(self):
        from worker.countries import main
        with patch('sys.argv', ['countries', '--yahoo-only']), patch('pathlib.Path.read_text') as read_mapping, patch('psycopg.connect') as connect, patch('worker.refresh.load_activities', return_value=[]), patch('worker.refresh.plan_refresh', return_value={'symbols': ['STOCK', 'FUND']}), patch('worker.countries.refresh_countries', return_value=1) as refresh:
            main()
            read_mapping.assert_not_called()
            refresh.assert_called_once_with(connect.return_value.__enter__.return_value, ['STOCK', 'FUND'], {}, look_through=True)

    def test_stocks_only_and_yahoo_only_cannot_be_combined(self):
        from worker.countries import main
        with patch('sys.argv', ['countries', '--stocks-only', '--yahoo-only']), patch('sys.stderr', new_callable=StringIO) as stderr:
            with self.assertRaises(SystemExit):
                main()
        self.assertIn('not allowed with', stderr.getvalue())

    def test_import_file_cli_writes_supplied_weights_without_network_or_mapping(self):
        from unittest.mock import patch
        from worker.countries import main
        with patch('sys.argv', ['countries', '--import-file', 'weights.json']), patch('pathlib.Path.read_text', return_value='{"FUND": {"weights": {"Germany": "100"}, "source": "https://example.org/f", "as_of": "2026-09-30"}}'), patch('psycopg.connect') as connect, patch('worker.countries.import_country_weights', return_value=1) as imported, patch('worker.countries.refresh_countries') as refresh:
            main()
            refresh.assert_not_called()
            imported.assert_called_once_with(connect.return_value.__enter__.return_value, {'FUND': {'weights': {'Germany': '100'}, 'source': 'https://example.org/f', 'as_of': '2026-09-30'}})

    def test_import_upserts_weights_with_source_and_as_of(self):
        from worker.countries import import_country_weights
        connection = MagicMock()
        count = import_country_weights(connection, {'FUND': {'weights': {'United States': '70.5', 'Germany': '29.5'}, 'source': 'https://example.org/f', 'as_of': '2026-09-30'}})
        self.assertEqual(count, 1)
        params = [call.args[1] for call in connection.execute.call_args_list if len(call.args) > 1][0]
        self.assertEqual(params[0], 'FUND')
        self.assertEqual(json.loads(params[1]), {'United States': '70.5', 'Germany': '29.5'})
        self.assertEqual(params[2:], ('https://example.org/f', date(2026, 9, 30)))

    def test_import_rejects_invalid_entries_before_writing_anything(self):
        from worker.countries import import_country_weights
        good = {'weights': {'Germany': '100'}, 'source': 'https://example.org/f', 'as_of': '2026-09-30'}
        bad_entries = [
            {**good, 'weights': {'Germany': '60', 'France': '50'}},
            {**good, 'weights': {'Germany': '-1'}},
            {**good, 'weights': {'Germany': 'abc'}},
            {**good, 'weights': {}},
            {**good, 'source': 'file:///etc/passwd'},
            {**good, 'as_of': 'yesterday'},
            {k: v for k, v in good.items() if k != 'source'},
        ]
        for bad in bad_entries:
            connection = MagicMock()
            with self.assertRaises(ValueError, msg=bad):
                import_country_weights(connection, {'GOOD': good, 'BAD': bad})
            connection.execute.assert_not_called()

    def test_import_accepts_partial_weights_below_one_hundred(self):
        from worker.countries import import_country_weights
        connection = MagicMock()
        self.assertEqual(import_country_weights(connection, {'F': {'weights': {'Germany': '40'}, 'source': 'https://example.org', 'as_of': '2026-01-31'}}), 1)

    def test_fetch_page_sets_timeout_and_identifies_client(self):
        from unittest.mock import patch
        from worker.countries import fetch_page
        with patch('worker.countries.urlopen') as opened:
            opened.return_value.__enter__.return_value.read.return_value = b'page'
            self.assertEqual(fetch_page('https://example.org'), 'page')
            self.assertEqual(opened.call_args.kwargs['timeout'], 30)
            self.assertIn('PortfolioTracker', opened.call_args.args[0].get_header('User-agent'))

    def test_forbidden_response_is_not_retried_and_keeps_cached_composition(self):
        from urllib.error import HTTPError
        fetch = MagicMock(side_effect=HTTPError('https://example.org', 403, 'Forbidden', {}, None))
        connection = MagicMock()
        from io import StringIO
        from unittest.mock import patch
        with patch('sys.stderr', new_callable=StringIO) as stderr:
            self.assertEqual(refresh_countries(connection, ['FUND'], {'FUND': 'IE0000000000'}, fetch=fetch, ticker_factory=MagicMock(), pause=lambda _: None), 0)
        self.assertIn('HTTP 403', stderr.getvalue())
        fetch.assert_called_once()
        self.assertFalse(any('INSERT INTO' in call.args[0] or 'DELETE' in call.args[0] for call in connection.execute.call_args_list))

    def test_keeps_holdings_date_distinct_from_fetch_date(self):
        self.assertEqual(parse_source_date('<div data-testid="tl_etf-holdings_reference-date">As of 31/08/2026</div>'), date(2026, 8, 31))
        self.assertIsNone(parse_source_date('<div>As of 31/08/2026</div>'))
        self.assertIsNone(parse_source_date('<div data-testid="tl_etf-holdings_reference-date">As of unknown</div>'))

    def test_parses_only_country_table_and_keeps_other_unallocated(self):
        html = '''<table id="countriesTable"><tbody><tr><td>United States</td><td>69.22%</td></tr>
        <tr><td>Japan</td><td>6.02%</td></tr><tr><td>Other</td><td>24.76%</td></tr></tbody></table>
        <table><tr><td>Technology</td><td>90%</td></tr></table>'''
        self.assertEqual(parse_countries(html), {'United States': '69.22', 'Japan': '6.02'})

    def test_uses_stable_country_table_attribute_with_dynamic_page_ids(self):
        self.assertEqual(parse_countries('<table id="countriesTable1b" data-testid="etf-holdings_countries_table"><tbody><tr><td>Germany</td><td><span>91.81%</span><div></div></td></tr><tr><td>Other</td><td>8.19%</td></tr></tbody></table>'), {'Germany': '91.81'})

    def test_rejects_missing_invalid_or_overweight_country_tables(self):
        for html in ['<html>Blocked</html>', '<table id="countriesTable"><tr><td>Germany</td><td>101%</td></tr></table>', '<table id="countriesTable"><tr><td>Germany</td><td>-1%</td></tr></table>']:
            with self.assertRaises(ValueError):
                parse_countries(html)

    def test_isolates_errors_and_preserves_previous_cache_without_fabricating_fund_weights(self):
        connection = cache()
        def ticker_factory(symbol):
            ticker = MagicMock()
            ticker.get_info.return_value = {'quoteType': 'EQUITY', 'country': 'Germany'} if symbol == 'STOCK' else {'quoteType': 'ETF', 'country': 'Ireland'}
            ticker.funds_data.top_holdings = top_holdings([])
            return ticker
        fetch = MagicMock(side_effect=ValueError('missing table'))
        self.assertEqual(refresh_countries(connection, ['STOCK', 'FUND', 'UNMAPPED'], {'FUND': 'IE0000000000'}, ticker_factory=ticker_factory, fetch=fetch, pause=lambda _: None), 1)
        inserts = [c for c in connection.execute.call_args_list if 'INSERT INTO' in c.args[0]]
        self.assertEqual(len(inserts), 1)
        self.assertEqual(inserts[0].args[1][0], 'STOCK')

    def test_rejects_duplicate_and_nonfinite_weights(self):
        for rows in ['<tr><td>Japan</td><td>NaN%</td></tr>', '<tr><td>Japan</td><td>20%</td></tr><tr><td>Japan</td><td>20%</td></tr>', '<tr><td>Japan</td><td>0%</td></tr>', '<tr><td>Japan</td><td>unknown</td></tr>']:
            with self.assertRaises(ValueError):
                parse_countries(f'<table id="countriesTable">{rows}</table>')

    def test_fetches_mapped_funds_with_a_pause(self):
        connection = MagicMock()
        fetch = MagicMock(return_value='<table id="countriesTable"><tr><td>Japan</td><td>80%</td></tr><tr><td>Other</td><td>20%</td></tr></table>')
        pause = MagicMock()
        self.assertEqual(refresh_countries(connection, ['FUND'], {'FUND': 'IE0000000000'}, ticker_factory=MagicMock(), fetch=fetch, pause=pause), 1)
        fetch.assert_called_once_with('https://www.justetf.com/en/etf-profile.html?isin=IE0000000000')
        pause.assert_called_once()


class FundLookThroughTests(unittest.TestCase):
    HOLDINGS_URL = 'https://finance.yahoo.com/quote/FUND/holdings/'

    def refresh(self, yahoo, connection=None, symbols=('FUND',), pause=lambda _: None, **options):
        connection = connection or cache()
        with patch('sys.stderr', new_callable=StringIO) as stderr:
            count = refresh_countries(connection, list(symbols), {}, ticker_factory=yahoo, pause=pause, **options)
        return count, connection, stderr.getvalue()

    def test_fund_countries_come_from_the_countries_of_its_top_holdings(self):
        yahoo = FakeYahoo(
            {'FUND': {'quoteType': 'ETF', 'country': 'Ireland'}, 'AAPL': {'country': 'United States'}, 'MSFT': {'country': 'United States'}, 'ASML': {'country': 'Netherlands'}, 'SAP': {'country': 'Germany'}},
            {'FUND': [('AAPL', 0.07), ('MSFT', 0.06), ('ASML', 0.03), ('SAP', 0.0225)]})
        count, connection, _ = self.refresh(yahoo)
        self.assertEqual(count, 1)
        [(symbol, weights, source, as_of)] = written(connection)
        self.assertEqual((symbol, json.loads(weights), source, as_of), ('FUND', {'United States': '13.00', 'Netherlands': '3.00', 'Germany': '2.25'}, self.HOLDINGS_URL, None))

    def test_holdings_with_no_known_country_are_not_spread_over_the_rest(self):
        yahoo = FakeYahoo(
            {'FUND': {'quoteType': 'ETF'}, 'AAPL': {'country': 'United States'}, 'NOCOUNTRY': {'quoteType': 'ETF'}, 'BLOCKED': RuntimeError('rate limited')},
            {'FUND': [('AAPL', 0.5), ('NOCOUNTRY', 0.2), ('BLOCKED', 0.1)]})
        count, connection, stderr = self.refresh(yahoo)
        self.assertEqual(count, 1)
        self.assertEqual(json.loads(written(connection)[0][1]), {'United States': '50.00'})
        self.assertIn('BLOCKED: RuntimeError', stderr)

    def test_fund_with_no_usable_holdings_stores_nothing_and_says_why(self):
        for name, holdings in [('missing', None), ('empty', []), ('no known country', [('XYZ', 0.5)])]:
            with self.subTest(name):
                yahoo = FakeYahoo({'FUND': {'quoteType': 'ETF', 'country': 'Ireland'}, 'XYZ': {}}, {} if holdings is None else {'FUND': holdings})
                count, connection, stderr = self.refresh(yahoo)
                self.assertEqual((count, written(connection)), (0, []))
                self.assertIn('FUND', stderr)

    def test_holdings_adding_up_to_more_than_the_whole_fund_are_rejected(self):
        yahoo = FakeYahoo({'FUND': {'quoteType': 'ETF'}, 'A': {'country': 'Japan'}, 'B': {'country': 'Japan'}}, {'FUND': [('A', 0.7), ('B', 0.4)]})
        count, connection, stderr = self.refresh(yahoo)
        self.assertEqual((count, written(connection)), (0, []))
        self.assertIn('Country lookup failed for FUND', stderr)

    def test_skips_blank_symbols_and_holdings_without_a_positive_share(self):
        yahoo = FakeYahoo(
            {'FUND': {'quoteType': 'MUTUALFUND'}, 'AAPL': {'country': 'United States'}},
            {'FUND': [('', 0.1), ('SHORT', -0.05), ('ZERO', 0), ('UNKNOWN', float('nan')), ('AAPL', 0.2)]})
        count, connection, _ = self.refresh(yahoo)
        self.assertEqual(json.loads(written(connection)[0][1]), {'United States': '20.00'})
        self.assertEqual(yahoo.info_requests, ['FUND', 'AAPL'])

    def test_looks_up_each_holding_once_across_funds_and_waits_before_each_lookup(self):
        yahoo = FakeYahoo(
            {'F1': {'quoteType': 'ETF'}, 'F2': {'quoteType': 'ETF'}, 'AAPL': {'country': 'United States'}, 'SAP': {'country': 'Germany'}},
            {'F1': [('AAPL', 0.1)], 'F2': [('AAPL', 0.2), ('SAP', 0.1)]})
        pause = MagicMock()
        count, _, _ = self.refresh(yahoo, symbols=('F1', 'F2'), pause=pause)
        self.assertEqual(count, 2)
        self.assertEqual(sorted(yahoo.info_requests), ['AAPL', 'F1', 'F2', 'SAP'])
        self.assertEqual(pause.call_args_list, [call(1), call(1)])

    def test_keeps_a_composition_that_came_from_another_source(self):
        yahoo = FakeYahoo({'FUND': {'quoteType': 'ETF'}, 'AAPL': {'country': 'United States'}}, {'FUND': [('AAPL', 0.1)]})
        count, connection, stderr = self.refresh(yahoo, cache('https://example.org/issuer-factsheet'))
        self.assertEqual((count, written(connection)), (0, []))
        self.assertEqual(yahoo.info_requests, ['FUND'])
        self.assertIn('FUND', stderr)

    def test_refreshes_its_own_earlier_look_through(self):
        yahoo = FakeYahoo({'FUND': {'quoteType': 'ETF'}, 'AAPL': {'country': 'United States'}}, {'FUND': [('AAPL', 0.1)]})
        count, connection, _ = self.refresh(yahoo, cache(self.HOLDINGS_URL))
        self.assertEqual(count, 1)
        self.assertEqual(json.loads(written(connection)[0][1]), {'United States': '10.00'})

    def test_look_through_can_be_switched_off(self):
        yahoo = FakeYahoo({'FUND': {'quoteType': 'ETF'}, 'AAPL': {'country': 'United States'}}, {'FUND': [('AAPL', 0.1)]})
        count, connection, _ = self.refresh(yahoo, look_through=False)
        self.assertEqual((count, written(connection)), (0, []))
        self.assertEqual(yahoo.info_requests, ['FUND'])

    def test_mapped_funds_use_their_fund_page_without_asking_yahoo(self):
        yahoo = MagicMock()
        fetch = MagicMock(return_value='<table id="countriesTable"><tr><td>Japan</td><td>80%</td></tr></table>')
        self.assertEqual(refresh_countries(cache(), ['FUND'], {'FUND': 'IE0000000000'}, ticker_factory=yahoo, fetch=fetch, pause=lambda _: None), 1)
        yahoo.assert_not_called()


if __name__ == '__main__':
    unittest.main()
