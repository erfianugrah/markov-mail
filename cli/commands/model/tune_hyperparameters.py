"""
Hyperparameter Tuning for Random Forest

Usage:
  python tune_hyperparameters.py --dataset data/features/export.csv
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

import pandas as pd
from scipy.stats import randint
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import RandomizedSearchCV


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Tune Random Forest hyperparameters")
    parser.add_argument(
        "--dataset",
        default="data/features/export.csv",
        help="CSV with engineered features + label column (default: data/features/export.csv)",
    )
    parser.add_argument(
        "--label-column",
        default="label",
        help="Name of the target column (default: label)",
    )
    parser.add_argument(
        "--n-iter",
        type=int,
        default=25,
        dest="n_iter",
        help="Number of RandomizedSearch iterations (default: 25)",
    )
    parser.add_argument(
        "--cv",
        type=int,
        default=5,
        help="Cross-validation folds (default: 5)",
    )
    parser.add_argument(
        "--scoring",
        default="roc_auc",
        help="Sklearn scoring metric (default: roc_auc)",
    )
    parser.add_argument(
        "--random-state",
        type=int,
        default=42,
        help="Random seed for reproducibility (default: 42)",
    )
    parser.add_argument(
        "--n-jobs",
        type=int,
        default=-1,
        help="Parallel jobs for sklearn (default: -1, use all cores)",
    )
    parser.add_argument(
        "--n-estimators-min",
        type=int,
        default=25,
        dest="n_estimators_min",
        help="Minimum trees to sample (default: 25)",
    )
    parser.add_argument(
        "--n-estimators-max",
        type=int,
        default=250,
        dest="n_estimators_max",
        help="Maximum trees to sample (default: 250)",
    )
    parser.add_argument(
        "--max-depth-min",
        type=int,
        default=4,
        dest="max_depth_min",
        help="Minimum tree depth to sample (default: 4)",
    )
    parser.add_argument(
        "--max-depth-max",
        type=int,
        default=18,
        dest="max_depth_max",
        help="Maximum tree depth to sample (default: 18)",
    )
    parser.add_argument(
        "--min-samples-leaf-min",
        type=int,
        default=1,
        dest="min_samples_leaf_min",
        help="Minimum samples per leaf to sample (default: 1)",
    )
    parser.add_argument(
        "--min-samples-leaf-max",
        type=int,
        default=50,
        dest="min_samples_leaf_max",
        help="Maximum samples per leaf to sample (default: 50)",
    )
    parser.add_argument(
        "--output",
        help="Optional JSON file to save summarized tuning results",
    )
    return parser.parse_args()


def validate_ranges(args: argparse.Namespace) -> None:
    if args.n_estimators_min >= args.n_estimators_max:
        raise SystemExit("--n-estimators-min must be < --n-estimators-max")
    if args.max_depth_min >= args.max_depth_max:
        raise SystemExit("--max-depth-min must be < --max-depth-max")
    if args.min_samples_leaf_min >= args.min_samples_leaf_max:
        raise SystemExit("--min-samples-leaf-min must be < --min-samples-leaf-max")


def main() -> None:
    args = parse_args()
    validate_ranges(args)
    dataset_path = Path(args.dataset)

    if not dataset_path.exists():
        raise SystemExit(f"Dataset not found: {dataset_path}")

    print("=" * 80)
    print("Hyperparameter Tuning for Random Forest")
    print("=" * 80)

    # Load dataset
    print(f"\nLoading dataset: {dataset_path}")
    df = pd.read_csv(dataset_path)
    print(f"  Rows: {len(df):,}")

    if args.label_column not in df.columns:
        raise SystemExit(f"Missing label column '{args.label_column}' in dataset")

    # Separate features and labels
    non_feature_cols = [args.label_column, 'id', 'email', 'timestamp', 'created_at']
    feature_columns = [c for c in df.columns if c not in non_feature_cols]

    if not feature_columns:
        raise SystemExit("Dataset does not contain feature columns")

    X = df[feature_columns]
    y = df[args.label_column]

    # Define the parameter space
    param_dist = {
        'n_estimators': randint(args.n_estimators_min, args.n_estimators_max + 1),
        'max_depth': randint(args.max_depth_min, args.max_depth_max + 1),
        'min_samples_leaf': randint(args.min_samples_leaf_min, args.min_samples_leaf_max + 1),
    }

    # Create a random forest classifier
    rf = RandomForestClassifier(
        random_state=args.random_state,
        n_jobs=args.n_jobs,
    )

    # Use random search to find the best hyperparameters
    rand_search = RandomizedSearchCV(
        rf,
        param_distributions=param_dist,
        n_iter=args.n_iter,
        cv=args.cv,
        scoring=args.scoring,
        random_state=args.random_state,
        n_jobs=args.n_jobs,
        verbose=2,
    )

    # Fit the random search object to the data
    rand_search.fit(X, y)

    # Summaries
    print("\nBest hyperparameters:")
    for key, value in rand_search.best_params_.items():
        print(f"  - {key}: {value}")
    print(f"\nBest {args.scoring}: {rand_search.best_score_:.4f}")

    results_df = (
        pd.DataFrame(rand_search.cv_results_)
        .sort_values('mean_test_score', ascending=False)
        .head(5)
        .reset_index(drop=True)
    )

    print("\nTop 5 candidates (mean CV scores):")
    for rank, row in results_df.iterrows():
        params: Dict[str, Any] = row['params']
        print(f"  #{rank + 1}  score={row['mean_test_score']:.4f}  params={params}")

    hint = rand_search.best_params_
    print("\nSuggested training command:")
    print(
        "  npm run cli model:train -- "
        f"--n-trees {hint['n_estimators']} "
        f"--max-depth {hint['max_depth']} "
        f"--min-samples-leaf {hint['min_samples_leaf']}"
    )

    summary: Dict[str, Any] = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "dataset": str(dataset_path),
        "rows": len(df),
        "label_column": args.label_column,
        "feature_count": len(feature_columns),
        "scoring": args.scoring,
        "cv": args.cv,
        "n_iter": args.n_iter,
        "search_space": {
            "n_estimators": [args.n_estimators_min, args.n_estimators_max],
            "max_depth": [args.max_depth_min, args.max_depth_max],
            "min_samples_leaf": [args.min_samples_leaf_min, args.min_samples_leaf_max],
        },
        "best_score": float(rand_search.best_score_),
        "best_params": rand_search.best_params_,
        "top_candidates": [
            {
                "mean_test_score": float(row['mean_test_score']),
                "rank": rank + 1,
                "params": row['params'],
            }
            for rank, row in results_df.iterrows()
        ],
    }

    if args.output:
        output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(summary, indent=2))
        print(f"\nSaved summary to {output_path.resolve()}")


if __name__ == "__main__":
    main()
