export function navigateToSafeDownload(rawUrl: string): boolean {
  const url = new URL(rawUrl, window.location.origin);
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  window.location.assign(url.href);
  return true;
}
