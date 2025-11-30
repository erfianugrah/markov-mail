# Calibration

Decision tree and Random Forest models encode final probabilities directly in their leaf nodes. No runtime calibration is performed.

If you need a secondary calibration step (e.g., Platt scaling), apply it offline during training before exporting the model, or embed the adjusted probabilities in the leaf `value` fields.
