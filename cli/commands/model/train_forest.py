"""
Random Forest Training (Production)

Usage:
  python train_forest.py \
    --dataset data/features/export.csv \
    --output config/production/random-forest.json \
    --n-trees 10 \
    --max-depth 6
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import precision_score, recall_score, confusion_matrix
from sklearn.model_selection import train_test_split
from sklearn.tree import _tree


def parse_args() -> argparse.Namespace:
    args = argparse.ArgumentParser(description="Train Random Forest with targeted sample weights")
    args.add_argument("--dataset", required=True, help="CSV with engineered features + label column")
    args.add_argument("--label-column", default="label", help="Name of the target column (default: label)")
    args.add_argument("--output", default="random-forest.json", help="Output JSON path")
    args.add_argument("--n-trees", type=int, default=10, help="Number of trees (default: 10)")
    args.add_argument("--max-depth", type=int, default=6, help="Maximum tree depth (default: 6)")
    args.add_argument("--min-samples-leaf", type=int, default=20, help="Minimum samples per leaf (default: 20)")
    args.add_argument("--conflict-weight", type=float, default=20.0, help="Weight for conflict zone samples (default: 20.0)")
    args.add_argument("--no-split", action="store_true", help="Train on 100%% of data (no train/test split for production)")
    args.add_argument("--calibration-output", default="data/calibration/latest.csv", help="CSV path for holdout scores/labels")
    args.add_argument("--run-id", type=str, default=None, help="Training run ID for tracking (default: timestamp)")
    return args.parse_args()


def tree_to_json(tree_estimator, feature_names):
    """Export tree to minified JSON format (t=type, f=feature, v=value, l=left, r=right)"""
    tree_ = tree_estimator.tree_
    feature_name = [
        feature_names[i] if i != _tree.TREE_UNDEFINED else "undefined!"
        for i in tree_.feature
    ]

    def recurse(node):
        if tree_.feature[node] != _tree.TREE_UNDEFINED:
            # Internal node
            return {
                "t": "n",  # type: node
                "f": feature_name[node],  # feature
                "v": round(tree_.threshold[node], 4),  # threshold value
                "l": recurse(tree_.children_left[node]),  # left child
                "r": recurse(tree_.children_right[node]),  # right child
            }
        else:
            # Leaf node
            value = tree_.value[node][0]
            total = value.sum()
            proba = float(value[1] / total) if total else 0.0
            return {"t": "l", "v": round(proba, 4)}  # type: leaf, value: fraud probability

    return recurse(0)


def calculate_sample_weights(df: pd.DataFrame, X: pd.DataFrame, conflict_weight: float = 20.0) -> np.ndarray:
    """
    Calculate strategic sample weights targeting the "conflict zone":
    High entropy + Sketchy domain region where certain fraud patterns and legit users overlap
    """
    weights = np.ones(len(df))

    # Identify conflict zone: high bigram_entropy + sketchy domain
    # This forces the forest to learn deeper patterns (like avg_segment_length)
    if 'bigram_entropy' in X.columns and 'domain_reputation_score' in X.columns:
        conflict_mask = (X['bigram_entropy'] > 3.0) & (X['domain_reputation_score'] >= 0.6)

        print(f"  Conflict zone samples: {conflict_mask.sum():,} ({conflict_mask.sum()/len(df)*100:.1f}%)")
        print(f"  Applying {conflict_weight}x weight to conflict zone")

        weights[conflict_mask] = conflict_weight
    else:
        print("Warning: bigram_entropy or domain_reputation_score missing. Skipping conflict weighting.")

    return weights


def main():
    args = parse_args()
    dataset_path = Path(args.dataset)

    if not dataset_path.exists():
        raise SystemExit(f"Dataset not found: {dataset_path}")

    print("=" * 80)
    print("Random Forest Training (Conflict Zone Weighted)")
    print("=" * 80)

    # Load dataset
    print(f"\nLoading dataset: {dataset_path}")
    df = pd.read_csv(dataset_path)
    print(f"  Rows: {len(df):,}")

    if args.label_column not in df.columns:
        raise SystemExit(f"Missing label column '{args.label_column}' in dataset")

    # Separate features and labels
    # Exclude metadata columns that are not features (id, email, timestamp, etc.)
    non_feature_cols = [args.label_column, 'id', 'email', 'timestamp', 'created_at']
    feature_columns = [c for c in df.columns if c not in non_feature_cols]

    if not feature_columns:
        raise SystemExit("Dataset does not contain feature columns")

    print(f"  Features: {len(feature_columns)}")
    X = df[feature_columns]
    y = df[args.label_column]

    print(f"\nClass distribution:")
    print(f"  Legit: {(y == 0).sum():,} ({(y == 0).sum()/len(y)*100:.1f}%)")
    print(f"  Fraud: {(y == 1).sum():,} ({(y == 1).sum()/len(y)*100:.1f}%)")

    # Calculate strategic sample weights
    print(f"\nCalculating strategic sample weights...")
    sample_weights = calculate_sample_weights(df, X, args.conflict_weight)

    # Split data (or use full dataset for production)
    if args.no_split:
        print(f"\n🚀 Production Mode: Training on 100% of data (no train/test split)")
        print(f"  Total samples: {len(X):,}")
        X_train, y_train, w_train = X, y, sample_weights
        X_test, y_test, w_test = None, None, None
    else:
        X_train, X_test, y_train, y_test, w_train, w_test = train_test_split(
            X, y, sample_weights, test_size=0.2, random_state=42, stratify=y
        )
        print(f"\nTrain/Test split:")
        print(f"  Train: {len(X_train):,} samples")
        print(f"  Test:  {len(X_test):,} samples")

    # Train Random Forest
    print(f"\nTraining Random Forest...")
    print(f"  Trees: {args.n_trees}")
    print(f"  Max Depth: {args.max_depth}")
    print(f"  Min Samples/Leaf: {args.min_samples_leaf}")

    clf = RandomForestClassifier(
        n_estimators=args.n_trees,
        max_depth=args.max_depth,
        min_samples_leaf=args.min_samples_leaf,
        random_state=42,
        n_jobs=-1,
        verbose=1
    )

    clf.fit(X_train, y_train, sample_weight=w_train)

    calibration_info = None

    # Evaluate (only if we have a test set)
    if not args.no_split:
        print(f"\n{'=' * 80}")
        print("Model Evaluation")
        print("=" * 80)

        y_pred_train = clf.predict(X_train)
        y_pred_test = clf.predict(X_test)
        y_score_test = clf.predict_proba(X_test)[:, 1]

        print(f"\nTRAIN SET:")
        print(f"  Precision: {precision_score(y_train, y_pred_train):.3f}")
        print(f"  Recall:    {recall_score(y_train, y_pred_train):.3f}")

        print(f"\nTEST SET:")
        print(f"  Precision: {precision_score(y_test, y_pred_test):.3f}")
        print(f"  Recall:    {recall_score(y_test, y_pred_test):.3f}")

        print(f"\nConfusion Matrix (Test):")
        cm = confusion_matrix(y_test, y_pred_test)
        print(f"  TN: {cm[0,0]:,}  FP: {cm[0,1]:,}")
        print(f"  FN: {cm[1,0]:,}  TP: {cm[1,1]:,}")

        # Conflict zone performance
        if 'bigram_entropy' in X_test.columns and 'domain_reputation_score' in X_test.columns:
            conflict_test_mask = (X_test['bigram_entropy'] > 3.0) & (X_test['domain_reputation_score'] >= 0.6)

            print(f"\nConflict Zone Performance (Test Set):")
            print(f"  Samples in zone: {conflict_test_mask.sum():,}")

            if conflict_test_mask.sum() > 0:
                y_test_conflict = y_test[conflict_test_mask]
                y_pred_conflict = y_pred_test[conflict_test_mask]

                print(f"  Precision: {precision_score(y_test_conflict, y_pred_conflict, zero_division=0):.3f}")
                print(f"  Recall:    {recall_score(y_test_conflict, y_pred_conflict, zero_division=0):.3f}")

                # Show breakdown
                conflict_fraud = (y_test_conflict == 1).sum()
                conflict_legit = (y_test_conflict == 0).sum()
                print(f"  Fraud in zone: {conflict_fraud:,}")
                print(f"  Legit in zone: {conflict_legit:,}")
    else:
        print(f"\n{'=' * 80}")
        print("Production Training Complete")
        print("=" * 80)
        print(f"\n⚠️  No evaluation metrics (trained on 100% of data)")
        print(f"   Validate on production traffic for real-world performance")

    # Generate calibration data (always, regardless of split mode)
    print(f"\n{'=' * 80}")
    print("Generating Calibration Data")
    print("=" * 80)

    calibration_path = Path(args.calibration_output)
    calibration_path.parent.mkdir(parents=True, exist_ok=True)

    # Use test set if available, otherwise use training set
    if not args.no_split:
        # Development mode: use held-out test set for calibration
        calibration_scores = y_score_test
        calibration_labels = y_test
        calibration_mode = "test set (held-out 20%)"
    else:
        # Production mode: use training set for calibration
        calibration_scores = clf.predict_proba(X_train)[:, 1]
        calibration_labels = y_train
        calibration_mode = "training set (100% of data)"

    print(f"\nCalibration dataset: {calibration_mode}")
    print(f"  Samples: {len(calibration_labels):,}")

    # Fit Platt scaling
    calibration_inputs = calibration_scores.reshape(-1, 1)
    calibrator = LogisticRegression()
    calibrator.fit(calibration_inputs, calibration_labels)
    calibrated_scores = calibrator.predict_proba(calibration_inputs)[:, 1]

    calibration_info = {
        "method": "platt",
        "intercept": float(calibrator.intercept_[0]),
        "coef": float(calibrator.coef_[0][0]),
        "samples": int(len(calibration_labels)),
    }

    print(f"\nPlatt Scaling Coefficients:")
    print(f"  Intercept: {calibration_info['intercept']:.6f}")
    print(f"  Coefficient: {calibration_info['coef']:.6f}")

    # Save calibration dataset
    calibration_df = pd.DataFrame({
        "score": calibration_scores,
        "label": calibration_labels.reset_index(drop=True) if hasattr(calibration_labels, 'reset_index') else calibration_labels,
        "calibrated_score": calibrated_scores,
    })
    calibration_df.to_csv(calibration_path, index=False)
    print(f"\nSaved calibration dataset to {calibration_path.resolve()}")

    # Feature importance
    print(f"\n{'=' * 80}")
    print("Feature Importance (Top 15)")
    print("=" * 80)

    importances = pd.DataFrame({
        'feature': feature_columns,
        'importance': clf.feature_importances_
    }).sort_values('importance', ascending=False)

    for idx, row in importances.head(15).iterrows():
        print(f"  {row['feature']:35s} → {row['importance']:.4f}")

    # Check if bigram_entropy is being used (FIXED)
    if 'bigram_entropy' in feature_columns:
        sorted_feats = importances['feature'].tolist()
        rank = sorted_feats.index('bigram_entropy') + 1
        imp = importances[importances['feature'] == 'bigram_entropy']['importance'].values[0]
        print(f"\nbigram_entropy: rank {rank}/{len(feature_columns)}, importance {imp:.4f}")

    # Export to JSON
    print(f"\n{'=' * 80}")
    print("Exporting to JSON")
    print("=" * 80)

    print(f"Compiling {args.n_trees} trees to minified JSON...")
    forest_json = []
    for i, estimator in enumerate(clf.estimators_):
        if (i + 1) % 5 == 0 or i == 0:
            print(f"  Tree {i+1}/{args.n_trees}...")
        forest_json.append(tree_to_json(estimator, feature_columns))

    # Generate run ID if not provided
    run_id = args.run_id
    if not run_id:
        import time
        run_id = str(int(time.time() * 1000))

    artifact = {
        "meta": {
            "version": "3.0.0-forest",
            "runId": run_id,
            "nTrees": args.n_trees,
            "maxDepth": args.max_depth,
            "features": feature_columns,
            "feature_importance": importances.set_index('feature')['importance'].to_dict(),
            "tree_count": len(forest_json),
            "config": {
                "n_trees": args.n_trees,
                "max_depth": args.max_depth,
                "min_samples_leaf": args.min_samples_leaf,
                "conflict_weight": args.conflict_weight,
                "no_split": args.no_split
            },
        },
        "forest": forest_json
    }

    if calibration_info:
        artifact["meta"]["calibration"] = calibration_info

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(artifact, separators=(',', ':')))

    # Size check
    size_kb = output_path.stat().st_size / 1024
    size_mb = size_kb / 1024
    print(f"\n✅ Random Forest saved to {output_path.resolve()}")
    print(f"   Size: {size_kb:.2f} KB ({size_mb:.2f} MB)")

    if size_mb > 25:
        print(f"   ⚠️  WARNING: Model exceeds KV 25MB limit!")
        print(f"   Reduce n_trees or max_depth")
    else:
        print(f"   ✅ Fits within KV 25MB limit")


if __name__ == "__main__":
    main()
