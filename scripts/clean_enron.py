#!/usr/bin/env python3
"""Clean raw Enron address list to align with model-training schema."""
from __future__ import annotations

import argparse
import csv
import re
from pathlib import Path
from typing import Set

EMAIL_STRIP = str.maketrans('', '', '"\'()[]{}')
WHITESPACE_RE = re.compile(r"\s+")


def normalize_email(value: str) -> str | None:
    if not value:
        return None
    email = value.strip().lower()
    email = email.replace('mailto:', '')
    email = email.strip('<>')
    email = email.translate(EMAIL_STRIP)
    email = WHITESPACE_RE.sub('', email)
    email = email.rstrip('.,;')
    while '..' in email:
        email = email.replace('..', '.')
    if email.count('@') != 1:
        return None
    local, domain = email.split('@', 1)
    if not local or not domain or '.' not in domain:
        return None
    return f"{local}@{domain}"


def clean_enron(input_path: Path, output_path: Path) -> dict:
    seen: Set[str] = set()
    kept = 0
    duplicates = 0
    invalid = 0

    with input_path.open(newline='', encoding='utf-8', errors='ignore') as src, \
            output_path.open('w', newline='', encoding='utf-8') as dst:
        reader = csv.DictReader(src)
        writer = csv.DictWriter(dst, fieldnames=['email', 'name', 'label', 'source'])
        writer.writeheader()

        for row in reader:
            email = normalize_email(row.get('email', ''))
            if not email:
                invalid += 1
                continue
            if email in seen:
                duplicates += 1
                continue
            seen.add(email)

            label_raw = (row.get('label') or '').strip().lower()
            label = 'fraud' if label_raw.startswith('fraud') else 'legit'
            name = (row.get('name') or '').strip()
            writer.writerow({'email': email, 'name': name, 'label': label, 'source': 'enron'})
            kept += 1

    return {'kept': kept, 'duplicates': duplicates, 'invalid': invalid}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description='Clean Enron CSV export')
    parser.add_argument('--input', default='data/enron.csv', help='Path to raw enron.csv')
    parser.add_argument('--output', default='data/enron-clean.csv', help='Destination for cleaned CSV')
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    stats = clean_enron(Path(args.input), Path(args.output))
    print(f"✅ Wrote {stats['kept']:,} rows to {args.output}")
    print(f"   Skipped {stats['duplicates']:,} duplicates, {stats['invalid']:,} invalid rows")


if __name__ == '__main__':
    main()
