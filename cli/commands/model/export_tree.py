"""
Decision Tree Exporter (Scikit-Learn)

Usage:
  python export_tree.py \
    --dataset ../data/features/training_features.csv \
    --output ../config/production/decision-tree.json \
    --max-depth 6
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import pandas as pd
from sklearn.tree import DecisionTreeClassifier


def parse_args() -> argparse.Namespace:
	args = argparse.ArgumentParser(description="Export decision tree model as JSON")
	args.add_argument("--dataset", required=True, help="CSV with engineered features + label column")
	args.add_argument("--label-column", default="label", help="Name of the target column (default: label)")
	args.add_argument("--output", default="decision-tree.json", help="Output JSON path")
	args.add_argument("--max-depth", type=int, default=6, help="Maximum tree depth (default: 6)")
	args.add_argument("--min-samples-leaf", type=int, default=50, help="Minimum samples per leaf (default: 50)")
	return args.parse_args()


def node_to_json(tree, feature_names, node_id=0):
	feature_index = tree.feature[node_id]

	# Leaf node
	if feature_index == -2:
		value = tree.value[node_id][0]
		total = value.sum()
		proba = float(value[1] / total) if total else 0.0
		reason = "leaf"
		if total:
			reason = f"p={proba:.2f} ({int(value[1])}/{int(total)})"
		return {
			"type": "leaf",
			"value": max(0.0, min(1.0, proba)),
			"reason": reason,
		}

	threshold = float(tree.threshold[node_id])
	feature_name = feature_names[feature_index]

	return {
		"type": "node",
		"feature": feature_name,
		"threshold": threshold,
		"operator": "<=",
		"left": node_to_json(tree, feature_names, tree.children_left[node_id]),
		"right": node_to_json(tree, feature_names, tree.children_right[node_id]),
	}


def main():
	args = parse_args()
	dataset_path = Path(args.dataset)
	if not dataset_path.exists():
		raise SystemExit(f"Dataset not found: {dataset_path}")

	df = pd.read_csv(dataset_path)
	if args.label_column not in df.columns:
		raise SystemExit(f"Missing label column '{args.label_column}' in dataset")

	feature_columns = [c for c in df.columns if c != args.label_column]
	if not feature_columns:
		raise SystemExit("Dataset does not contain feature columns")

	X = df[feature_columns]
	y = df[args.label_column]

	clf = DecisionTreeClassifier(
		max_depth=args.max_depth,
		min_samples_leaf=args.min_samples_leaf,
		random_state=42,
	)
	clf.fit(X, y)

	tree_json = node_to_json(clf.tree_, feature_columns, node_id=0)
	output_path = Path(args.output)
	output_path.write_text(json.dumps(tree_json, indent=2))

	print(f"✅ Decision tree saved to {output_path.resolve()}")


if __name__ == "__main__":
	main()
