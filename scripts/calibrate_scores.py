#!/usr/bin/env python3
"""Calibrate raw Random Forest scores via Platt scaling."""

import argparse
from pathlib import Path

import pandas as pd
from sklearn.linear_model import LogisticRegression


def parse_args():
    parser = argparse.ArgumentParser(description="Calibrate fraud scores using Platt scaling.")
    parser.add_argument("--input", default="data/calibration/latest.csv", help="CSV containing columns: score,label")
    parser.add_argument("--output", default="data/calibration/calibrated.csv", help="Destination CSV with calibrated scores")
    return parser.parse_args()


def main():
    args = parse_args()
    input_path = Path(args.input)
    output_path = Path(args.output)

    if not input_path.exists():
        raise SystemExit(f"Calibration input file not found: {input_path}")

    df = pd.read_csv(input_path)
    if "score" not in df.columns or "label" not in df.columns:
        raise SystemExit("Calibration CSV must contain 'score' and 'label' columns.")

    X = df[["score"]].values
    y = df["label"].values

    model = LogisticRegression()
    model.fit(X, y)

    calibrated = model.predict_proba(X)[:, 1]
    df["calibrated_score"] = calibrated

    output_path.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(output_path, index=False)

    print("Calibration coefficients:")
    print("  intercept:", float(model.intercept_))
    print("  coef:", float(model.coef_[0][0]))
    print(f"Saved calibrated scores to {output_path.resolve()}")


if __name__ == "__main__":
    main()
