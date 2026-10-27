// Reads the TRUST_PROXY setting for Express.
//
// Behind a reverse proxy (Render, Railway, Nginx, a load balancer...) every request reaches the app
// from the PROXY's address, so IP-based rate limiting would put all users in one shared bucket.
// Telling Express how many proxies to trust makes req.ip the real client address.
//
// It must be a NUMBER OF HOPS, not "true": trusting every X-Forwarded-For entry lets any client
// forge its own IP (and dodge the rate limit) by sending that header themselves.
//
//   unset / "" / "false" / "0"  -> false  (no proxy in front: use the socket address)   <- default
//   "1" (one proxy, the usual)  -> 1
const MAX_HOPS = 10;

function parseTrustProxy(value) {
  if (value === undefined || value === null) return false;
  const text = String(value).trim().toLowerCase();
  if (text === '' || text === 'false' || text === '0') return false;
  if (/^\d+$/.test(text)) {
    const hops = Number(text);
    if (hops >= 1 && hops <= MAX_HOPS) return hops;
  }
  throw new Error(
    `TRUST_PROXY must be a number of proxy hops between 1 and ${MAX_HOPS} (usually 1), or left unset/"false". ` +
    'Do not use "true": it lets clients fake their IP address.'
  );
}

module.exports = { parseTrustProxy, MAX_HOPS };
