#!/usr/bin/env python3
"""
update_prices.py — rebuild src/prices.js from ARERA's official price tables.

Run monthly by .github/workflows/update-prices.yml (and by hand if needed):

    python3 scripts/update_prices.py            # writes src/prices.js
    python3 scripts/update_prices.py --check    # prints, writes nothing

Sources (both "valori al netto delle imposte", one sheet per period, newest first):
  gas  https://www.arera.it/fileadmin/area_operatori/prezzi_e_tariffe/G<anno>_stv.xlsx
       Servizio di tutela della vulnerabilità, monthly, per ambito tariffario
  luce https://www.arera.it/fileadmin/area_operatori/prezzi_e_tariffe/E<anno>-smt.xlsx
       Servizio di maggior tutela, quarterly, national

Each price is ARERA's "cliente tipo" (gas 1.100 Smc/anno, contatore G6; luce
2.000 kWh/anno, 3 kW, residente, monorario) with the fixed fees spread over the
consumption, then taxes applied with the factors in scripts/price-taxes.json.

Exits non-zero (and changes nothing) when a file cannot be read or a price
moves more than MAX_CHANGE from the current one: the workflow then opens an
issue instead of publishing a suspicious number. Standard library only.
"""

import datetime
import json
import re
import sys
import urllib.request
import zipfile
from io import BytesIO
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PRICES_JS = ROOT / 'src' / 'prices.js'
TAXES = json.loads((ROOT / 'scripts' / 'price-taxes.json').read_text())
BASE = 'https://www.arera.it/fileadmin/area_operatori/prezzi_e_tariffe/'
MAX_CHANGE = 0.40

GAS_TIPO_SMC = 1100
GAS_BRACKETS = [(0, 120), (120, 480), (480, 1560), (1560, 5000)]  # Smc/anno, rows of the sheet
EL_TIPO_KWH = 2000
EL_TIPO_KW = 3

AMBITI = {
    'nord occidentale': 'nordOvest',
    'nord orientale': 'nordEst',
    'centrale': 'centro',
    'centro-sud orientale': 'centroSudEst',
    'centro-sud occidentale': 'centroSudOvest',
    'meridionale': 'sud',
    'sardegna': 'sardegna',
}

MONTHS_IT = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic']
MONTH_NAMES = {
    'it': ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'],
    'en': ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
}


def download(name):
    req = urllib.request.Request(BASE + name, headers={'User-Agent': 'SunTrace-price-update (github.com/holyemilio/suntrace2)'})
    with urllib.request.urlopen(req, timeout=60) as res:
        return res.read()


def fetch_year_file(pattern):
    """This year's file, or last year's in the weeks before ARERA starts the new one."""
    year = datetime.date.today().year
    for y in (year, year - 1):
        try:
            return y, download(pattern.format(year=y))
        except Exception:
            continue
    raise SystemExit(f'Impossibile scaricare {pattern} da ARERA')


def first_sheet(xlsx_bytes):
    """Rows of the newest sheet as {column letter: value} dicts, plus its tab name."""
    z = zipfile.ZipFile(BytesIO(xlsx_bytes))
    names = re.findall(r'<sheet [^>]*name="([^"]+)"', z.read('xl/workbook.xml').decode())
    strings = [re.sub(r'<[^>]+>', '', s) for s in re.findall(r'<si>(.*?)</si>', z.read('xl/sharedStrings.xml').decode(), re.S)]
    xml = z.read('xl/worksheets/sheet1.xml').decode()
    rows = []
    for row in re.findall(r'<row[^>]*>(.*?)</row>', xml, re.S):
        cells = {}
        for col, attrs, val in re.findall(r'<c r="([A-Z]+)\d+"([^>]*)>(?:<f>.*?</f>)?<v>(.*?)</v>', row, re.S):
            cells[col] = strings[int(val)] if 't="s"' in attrs else val
        if cells:
            rows.append(cells)
    return names[0], rows


def num(v):
    return float(v)


def gas_prices(rows):
    """Pre-tax €/Smc for the cliente tipo, per ambito."""
    out, ambito, energy = {}, None, []
    for r in rows:
        b = r.get('B', '').strip()
        m = re.match(r'Ambito (.+)', b)
        if m:
            ambito, energy = AMBITI[m.group(1).strip().lower()], []
        elif ambito and ('consumo Smc/anno' in b or re.match(r'da [\d.]+ a [\d.]+$', b)) and 'T' in r:
            energy.append(num(r['T']))
        elif ambito and b.startswith('portata contatore: classe fino a G6'):
            spend = sum(max(0, min(GAS_TIPO_SMC, hi) - lo) * price for (lo, hi), price in zip(GAS_BRACKETS, energy))
            out[ambito] = (spend + num(r['T'])) / GAS_TIPO_SMC
            ambito = None
    if set(out) != set(AMBITI.values()):
        raise SystemExit(f'Foglio gas inatteso: ambiti letti {sorted(out)}')
    return out


def electricity_price(rows):
    """Pre-tax €/kWh for the cliente tipo (first block: residenti, monorario)."""
    energy = fixed = power = None
    for r in rows:
        b = r.get('B', '').strip()
        if b.startswith('Quota energia') and energy is None:
            # TOTALE monorario = materia energia + trasporto + oneri (columns J, R, U)
            energy = num(r['J']) + num(r['R']) + num(r['U'])
        elif b.startswith('Quota fissa') and fixed is None:
            fixed = num(r['V'])
        elif b.startswith('Quota potenza') and power is None:
            power = num(r['V'])
    if None in (energy, fixed, power):
        raise SystemExit('Foglio luce inatteso')
    return energy + (fixed + power * EL_TIPO_KW) / EL_TIPO_KWH


def gas_period(tab):
    m = re.match(r'(\w{3}) (\d{4})', tab)
    month = MONTHS_IT.index(m.group(1)), int(m.group(2))
    return {lang: f'{names[month[0]]} {month[1]}' for lang, names in MONTH_NAMES.items()}


def electricity_period(tab):
    m = re.match(r'(\w{3})-(\w{3}) (\d{4})', tab)
    a, b, y = MONTHS_IT.index(m.group(1)), MONTHS_IT.index(m.group(2)), m.group(3)
    return {lang: f'{names[a]}–{names[b]} {y}' for lang, names in MONTH_NAMES.items()}


def current_prices():
    """The prices now published, or None if prices.js is not in the generated format yet."""
    m = re.search(r'export const PRICES = (\{.*\});', PRICES_JS.read_text(), re.S)
    try:
        return json.loads(m.group(1)) if m else None
    except json.JSONDecodeError:
        return None


def main():
    check_only = '--check' in sys.argv
    _, gas_xlsx = fetch_year_file('G{year}_stv.xlsx')
    _, el_xlsx = fetch_year_file('E{year}-smt.xlsx')
    gas_tab, gas_rows = first_sheet(gas_xlsx)
    el_tab, el_rows = first_sheet(el_xlsx)

    gas = {k: round(v * TAXES['gas']['factor'], 4) for k, v in gas_prices(gas_rows).items()}
    el = round(electricity_price(el_rows) * TAXES['electricity']['factor'], 4)
    prices = {
        'gasEurPerSmc': gas,
        'gasPeriod': gas_period(gas_tab),
        'electricityEurPerKWh': el,
        'electricityPeriod': electricity_period(el_tab),
        'updated': datetime.date.today().isoformat(),
    }

    old = current_prices()
    if old:
        pairs = [(old['gasEurPerSmc'].get(k), v) for k, v in gas.items()] + [(old['electricityEurPerKWh'], el)]
        for before, after in pairs:
            if before and abs(after - before) / before > MAX_CHANGE:
                raise SystemExit(f'Variazione sospetta: {before} → {after} (oltre il {MAX_CHANGE:.0%}). Nessun aggiornamento.')

    # Same numbers as before: keep the old date, so an unchanged month is not a new commit.
    if old and {k: v for k, v in old.items() if k != 'updated'} == {k: v for k, v in prices.items() if k != 'updated'}:
        prices['updated'] = old.get('updated', prices['updated'])

    print(json.dumps(prices, ensure_ascii=False, indent=2))
    if check_only:
        return
    PRICES_JS.write_text(render(prices))


def render(prices):
    return f"""/**
 * prices.js — energy prices used by the cost estimate.
 *
 * GENERATED by scripts/update_prices.py from ARERA's official price tables —
 * do not edit by hand. A GitHub Action refreshes it every month (see
 * .github/workflows/update-prices.yml); the method is in docs/metodo.md.
 *
 * gasEurPerSmc: per ambito tariffario, Servizio di tutela della vulnerabilità.
 * electricityEurPerKWh: Servizio di maggior tutela, national.
 * Both are ARERA's "cliente tipo" price with fixed fees spread over the
 * consumption, taxes included through the factors in scripts/price-taxes.json.
 */

export const PRICES = {json.dumps(prices, ensure_ascii=False, indent=2)};
"""


if __name__ == '__main__':
    main()
