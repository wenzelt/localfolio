import unittest
from unittest.mock import MagicMock
from worker.names import refresh_names

class SecurityNameTests(unittest.TestCase):
    def test_fetches_only_uncached_names_and_keeps_original_symbol(self):
        connection = MagicMock()
        connection.execute.return_value.fetchall.return_value = [('KNOWN',)]
        factory = MagicMock()
        factory.return_value.get_info.return_value = {'longName': 'Synthetic Global Fund', 'shortName': 'Short'}
        self.assertEqual(refresh_names(connection, ['KNOWN', 'NEW'], factory), 1)
        factory.assert_called_once_with('NEW')
        self.assertTrue(any(call.args[1] == ('NEW', 'Synthetic Global Fund') for call in connection.execute.call_args_list if len(call.args) > 1))

    def test_falls_back_to_short_name_and_isolates_provider_errors(self):
        connection = MagicMock()
        connection.execute.return_value.fetchall.return_value = []
        good = MagicMock()
        good.get_info.return_value = {'shortName': 'Synthetic Short'}
        factory = MagicMock(side_effect=[ValueError('unavailable'), good])
        self.assertEqual(refresh_names(connection, ['BAD', 'GOOD'], factory), 1)

    def test_does_not_cache_blank_or_missing_names(self):
        connection = MagicMock()
        connection.execute.return_value.fetchall.return_value = []
        factory = MagicMock()
        factory.return_value.get_info.return_value = {'longName': '   '}
        self.assertEqual(refresh_names(connection, ['EMPTY'], factory), 0)

    def test_refresh_command_updates_names_after_prices_without_changing_dry_run(self):
        from unittest.mock import patch
        from worker.refresh import main
        with patch('psycopg.connect') as connect, patch.dict('os.environ', {'DATABASE_URL': 'synthetic'}), patch('worker.refresh.refresh_intraday', return_value='prices'), patch('worker.refresh.load_activities', return_value=[]), patch('worker.names.refresh_names') as names, patch('builtins.print'):
            main(['--intraday'])
            names.assert_called_once_with(connect.return_value.__enter__.return_value, [])
