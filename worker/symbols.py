# Ghostfolio symbols Yahoo has no data for -> the same fund's listing that Yahoo serves.
YAHOO_SYMBOLS = {
    'IE0001GSQ2O9.SG': 'LWCR.DE',
    'IE000YDZG487.SG': 'HNSC.MI',
    'LU2611732046.SG': 'C001.DE',
}


def yahoo_symbol(symbol):
    return YAHOO_SYMBOLS.get(symbol, symbol)
