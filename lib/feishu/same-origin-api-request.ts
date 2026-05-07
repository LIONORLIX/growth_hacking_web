/**
 * 生产环境图片代理防盗链：浏览器对同源 <img>/<video> 常不带 Origin，Referer 也可能被策略清空。
 * 现代浏览器会带 Sec-Fetch-Site: same-origin，据此放行同源子资源请求。
 */
export function isProductionSameOriginApiRequest(request: Request): boolean {
  const host = request.headers.get("host") ?? "";
  const origin = request.headers.get("origin") ?? "";
  const referer = request.headers.get("referer") ?? "";
  const secFetchSite = (request.headers.get("sec-fetch-site") ?? "").toLowerCase();

  if (secFetchSite === "same-origin") {
    return true;
  }
  if (!host) {
    return false;
  }
  return origin.includes(host) || referer.includes(host);
}
