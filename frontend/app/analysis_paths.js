function analysisQuery(path, query) {
  if (!query) return path;
  const qs = new URLSearchParams(query).toString();
  return qs ? `${path}?${qs}` : path;
}
export {
  analysisQuery
};
