// P1-S3 S1：分析类 HTTP 查询 URL 的纯构造函数（无浏览器依赖，供 analysis.ts 与单测复用）。

export function analysisQuery(path: string, query?: Record<string, string>): string {
  if (!query) return path;
  const qs = new URLSearchParams(query).toString();
  return qs ? `${path}?${qs}` : path;
}
