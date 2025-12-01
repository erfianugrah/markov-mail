#!/usr/bin/env python3
"""Calibrate raw Random Forest scores via Platt scaling."""

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression


def parse_args():
    parser = argparse.ArgumentParser(description="Calibrate fraud scores using Platt scaling.")
    parser.add_argument("--input", default="data/calibration/latest.csv", help="CSV containing columns: score,label")
    parser.add_argument("--output", default="data/calibration/calibrated.csv", help="Destination CSV with calibrated scores")
    parser.add_argument(
        "--threshold-json",
        default="data/calibration/threshold-scan.json",
        help="Destination JSON file for threshold metrics",
    )
    parser.add_argument(
        "--threshold-csv",
        default="data/calibration/threshold-scan.csv",
        help="Destination CSV file for threshold metrics",
    )
    parser.add_argument(
        "--threshold-min",
        type=float,
        default=0.05,
        help="Minimum threshold (inclusive) for the scan",
    )
    parser.add_argument(
        "--threshold-max",
        type=float,
        default=0.95,
        help="Maximum threshold (inclusive) for the scan",
    )
    parser.add_argument(
        "--threshold-step",
        type=float,
        default=0.05,
        help="Step between thresholds for the scan",
    )
    return parser.parse_args()


def generate_thresholds(min_threshold: float, max_threshold: float, step: float):
    if step <= 0:
        raise SystemExit("--threshold-step must be greater than 0")
    if max_threshold < min_threshold:
        raise SystemExit("--threshold-max must be greater than or equal to --threshold-min")

    thresholds = []
    current = min_threshold
    epsilon = step / 10
    while current <= max_threshold + epsilon:
        thresholds.append(round(current, 4))
        current += step
    return thresholds


def compute_threshold_metrics(scores: np.ndarray, labels: np.ndarray, threshold: float):
    predictions = scores >= threshold
    positives = labels == 1
    negatives = ~positives

    tp = int(np.logical_and(predictions, positives).sum())
    fp = int(np.logical_and(predictions, negatives).sum())
    fn = int(np.logical_and(~predictions, positives).sum())
    tn = int(np.logical_and(~predictions, negatives).sum())

    precision = tp / (tp + fp) if (tp + fp) else 0.0
    recall = tp / (tp + fn) if (tp + fn) else 0.0
    fpr = fp / (fp + tn) if (fp + tn) else 0.0
    fnr = fn / (tp + fn) if (tp + fn) else 0.0

    return {
        "threshold": threshold,
        "tp": tp,
        "fp": fp,
        "tn": tn,
        "fn": fn,
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "fpr": round(fpr, 4),
        "fnr": round(fnr, 4),
        "support_positive": int(positives.sum()),
        "support_negative": int(negatives.sum()),
    }


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
    scores = calibrated.astype(float)
    labels = y.astype(int)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(output_path, index=False)

    thresholds = generate_thresholds(args.threshold_min, args.threshold_max, args.threshold_step)
    threshold_metrics = [compute_threshold_metrics(scores, labels, t) for t in thresholds]

    threshold_json_path = Path(args.threshold_json)
    threshold_json_path.parent.mkdir(parents=True, exist_ok=True)
    threshold_report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "input": str(input_path),
        "calibration_output": str(output_path),
        "thresholds": threshold_metrics,
    }
    threshold_json_path.write_text(json.dumps(threshold_report, indent=2))

    threshold_csv_path = Path(args.threshold_csv)
    threshold_csv_path.parent.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(threshold_metrics).to_csv(threshold_csv_path, index=False)

    print("Calibration coefficients:")
    print("  intercept:", float(model.intercept_))
    print("  coef:", float(model.coef_[0][0]))
    print(f"Saved calibrated scores to {output_path.resolve()}")
    print(f"Saved threshold scan JSON to {threshold_json_path.resolve()}")
    print(f"Saved threshold scan CSV to {threshold_csv_path.resolve()}")


if __name__ == "__main__":
    main()
