import os
from datetime import datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


def local_today(environ=None, now=None):
    """Today's date where the owner is: the calendar day in the IANA zone named by TZ, or in UTC when TZ is unset.

    Containers run in UTC unless TZ is set, so the UTC clock alone would start the day hours early or late.
    """
    name = (os.environ if environ is None else environ).get('TZ') or 'UTC'
    try:
        zone = ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        raise ValueError(f'TZ must be an IANA time zone such as America/New_York, not {name}') from None
    return (now or datetime.now(timezone.utc)).astimezone(zone).date()
