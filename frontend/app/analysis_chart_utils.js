function isAnalysisEnvelope(value) {
  if (!value || typeof value !== "object") return false;
  const rec = value;
  return rec.schema === "netlab-analysis-result/1" && typeof rec.kind === "string" && Array.isArray(rec.axes) && Array.isArray(rec.curves) && Array.isArray(rec.markers);
}
function chartXUnit(envelope) {
  return envelope?.axes?.[0]?.unit || "";
}
function chartXAxisKey(envelope) {
  const axis = envelope?.axes?.[0];
  return axis ? (axis.unit || "") + "|" + axis.id : "";
}
function cursorAxisCompatible(envelope, axisKey) {
  if (!axisKey) return true;
  const target = chartXAxisKey(envelope);
  return !target || target === axisKey;
}
export {
  chartXAxisKey,
  chartXUnit,
  cursorAxisCompatible,
  isAnalysisEnvelope
};
