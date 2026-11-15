// P1-S3 S4：分析视图共用画布帧辅助（去重 analysis.ts 内重复的 hi-dpi 画布初始化）。
// 纯搬运：把 devicePixelRatio 适配 + setTransform + clearRect 的重复样板收敛为单一实现。

export function prepareCanvasFrame(
  canvas: HTMLCanvasElement | null,
  fallbackWidth: number,
  fallbackHeight: number,
): { ctx: CanvasRenderingContext2D; width: number; height: number } | null {
  if (!canvas) return null;
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || fallbackWidth;
  const height = canvas.clientHeight || fallbackHeight;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return { ctx, width, height };
}
