#!/usr/bin/env python3
"""
build_zones.py — src/data/zone-climatiche.json from DPR 412/93, Allegato A.

The annex (climate zone and degree days of every Italian comune) has no
official machine-readable version. This script reads three independent
published copies of it and keeps a comune only where at least two of them
agree on both the zone and the degree days:

  ANAIP   https://nazionale.anaip.it/wp-content/uploads/dpr412-93_allA_tabellagradigiorno-riscaldamento.pdf
  Sole 24 Ore  https://i2.res.24o.it/pdf2010/Editrice/ILSOLE24ORE/ILSOLE24ORE/Online/_Oggetti_Embedded/Documenti/2019/10/11/ALLEGATO.pdf
  SICET   https://www.sicet.it/attachments/article/702/Allegato_A_DPR_412-93.pdf

Checked against the official regional list of Regione Piemonte
(https://www.regione.piemonte.it/web/media/44156/download): on the Piedmont
comuni where the copies disagree, the official list always sides with the
majority kept here.

The table changes only by decree, rarely: run this by hand when it does.
Needs pdfplumber (a build-time tool only, not an app dependency):

    python3 -m venv /tmp/v && /tmp/v/bin/pip install pdfplumber
    /tmp/v/bin/python scripts/build_zones.py
"""

import collections
import json
import re
import sys
import unicodedata
import urllib.request
from io import BytesIO
from pathlib import Path

import pdfplumber

SOURCES = {
    'anaip': 'https://nazionale.anaip.it/wp-content/uploads/dpr412-93_allA_tabellagradigiorno-riscaldamento.pdf',
    'sole24ore': 'https://i2.res.24o.it/pdf2010/Editrice/ILSOLE24ORE/ILSOLE24ORE/Online/_Oggetti_Embedded/Documenti/2019/10/11/ALLEGATO.pdf',
    'sicet': 'https://www.sicet.it/attachments/article/702/Allegato_A_DPR_412-93.pdf',
}
OUT = Path(__file__).resolve().parent.parent / 'src' / 'data' / 'zone-climatiche.json'
LINE = re.compile(r'^([A-Z]{2})\s+([A-F])\s+(\d{2,4})\s+(\d{1,4})\s+(.+?)\s*(\(\d+\))?$')


def norm(name):
    """Comparable comune name: no accents, no spaces or apostrophes, upper case."""
    n = unicodedata.normalize('NFKD', name.upper())
    n = ''.join(c for c in n if not unicodedata.combining(c))
    return re.sub(r'[^A-Z0-9]', '', n)


def read(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'SunTrace-zones (github.com/holyemilio/suntrace2)'})
    data = urllib.request.urlopen(req, timeout=120).read()
    rows = {}
    with pdfplumber.open(BytesIO(data)) as pdf:
        for page in pdf.pages:
            for line in (page.extract_text() or '').splitlines():
                m = LINE.match(line.strip())
                if m:  # provincia, zona, gradi giorno, altitudine, comune
                    rows[(m.group(1), norm(m.group(5)))] = (m.group(2), int(m.group(3)))
    return rows


def main():
    copies = [read(url) for url in SOURCES.values()]
    out = collections.defaultdict(dict)
    kept = dropped = 0
    for key in set().union(*copies):
        votes = collections.Counter(c[key] for c in copies if key in c)
        (zone, gg), n = votes.most_common(1)[0]
        if n >= 2:
            out[key[0]][key[1]] = f'{zone}{gg}'
            kept += 1
        else:
            dropped += 1
    if kept < 7500:
        sys.exit(f'Too few comuni read ({kept}): has a source changed?')
    OUT.write_text(json.dumps({p: dict(sorted(c.items())) for p, c in sorted(out.items())}, ensure_ascii=False, separators=(',', ':')))
    print(f'{kept} comuni written, {dropped} dropped (sources disagree or only one source)')


if __name__ == '__main__':
    main()
