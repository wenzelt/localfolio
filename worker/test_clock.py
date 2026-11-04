import unittest
from datetime import date, datetime, timezone

from worker.clock import local_today

NOON_UTC = datetime(2026, 3, 20, 12, tzinfo=timezone.utc)


class LocalTodayTests(unittest.TestCase):
    def test_is_the_calendar_day_in_the_iana_zone_named_by_tz(self):
        self.assertEqual(local_today({'TZ': 'Pacific/Kiritimati'}, NOON_UTC), date(2026, 3, 21))
        self.assertEqual(local_today({'TZ': 'America/Los_Angeles'}, datetime(2026, 3, 20, 3, tzinfo=timezone.utc)), date(2026, 3, 19))

    def test_is_the_utc_day_when_tz_is_unset_or_empty(self):
        late_evening = datetime(2026, 3, 20, 23, 30, tzinfo=timezone.utc)
        for environ in ({}, {'TZ': ''}):
            with self.subTest(environ=environ):
                self.assertEqual(local_today(environ, late_evening), date(2026, 3, 20))

    def test_names_the_setting_when_tz_is_not_an_iana_zone(self):
        for value in ('Mars/Olympus_Mons', '../etc/passwd'):
            with self.subTest(value=value):
                with self.assertRaisesRegex(ValueError, f'TZ must be an IANA time zone such as America/New_York, not {value}'):
                    local_today({'TZ': value}, NOON_UTC)


if __name__ == '__main__':
    unittest.main()
