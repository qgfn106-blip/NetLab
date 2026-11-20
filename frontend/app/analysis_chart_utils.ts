/* 分析曲线共用小工具：信封校验与主 x 轴身份（游标跨画布同轴校验）。 */
import type { AnalysisEnvelope } from './analysis_chart_types.js';

export function isAnalysisEnvelope(value: unknown): value is AnalysisEnvelope {
  if (!value || typeof value !== 'object') return false;
  const rec = value as Record<string, unknown>;
  return rec.schema === 'netlab-analysis-result/1'
    && typeof rec.kind === 'string'
    && Array.isArray(rec.axes)
    && Array.isArray(rec.curves)
    && Array.isArray(rec.markers);
}

export function chartXUnit(envelope: AnalysisEnvelope | null): string {
  return envelope?.axes?.[0]?.unit || '';
}

export function chartXAxisKey(envelope: AnalysisEnvelope | null): string {
  const axis = envelope?.axes?.[0];
  return axis ? (axis.unit || '') + '|' + axis.id : '';
}

/** 非 null 游标仅在同一 x 轴身份间同步；未提供身份时沿用旧行为。 */
export function cursorAxisCompatible(envelope: AnalysisEnvelope | null, axisKey: string): boolean {
  if (!axisKey) return true;
  const target = chartXAxisKey(envelope);
  return !target || target === axisKey;
}
