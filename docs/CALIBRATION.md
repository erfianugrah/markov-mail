# Calibration

The calibration layer that once sat on top of the legacy models has been removed. Decision-tree leaves now encode the final probabilities directly, so there’s nothing to calibrate at runtime.

If you need a secondary calibration step (e.g., Platt scaling), apply it offline before exporting the tree or embed the adjusted probabilities in the leaf `value` fields.
