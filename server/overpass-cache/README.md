# Overpass edge cache

A small caching proxy in front of the Overpass mirrors. It fixes the app's
most fragile point: Overpass is free, overloaded and often rate-limits. With
the cache, areas already seen answer in ~50 ms without touching Overpass.

**The app works without it**: while `OVERPASS_PROXY_URL` in `src/ui.js` is
empty, the client talks to the public mirrors as it always has. Even with the
proxy on, if the worker is down the client falls back to the mirrors — no new
single point of failure.

## Deploy (once, ~10 minutes, free plan)

You need a [Cloudflare](https://dash.cloudflare.com/sign-up) account (free).

```bash
cd server/overpass-cache

# 1. log in (opens the browser)
npx wrangler login

# 2. create the cache namespace and copy the printed id
npx wrangler kv namespace create OSM_CACHE

# 3. in wrangler.toml, uncomment the [[kv_namespaces]] block and paste the id

# 4. publish
npx wrangler deploy
# → prints the URL, like https://suntrace-overpass.<account>.workers.dev
```

Then paste that URL into `OVERPASS_PROXY_URL` in `src/ui.js`:

```js
const OVERPASS_PROXY_URL = 'https://suntrace-overpass.<account>.workers.dev';
```

## Check

```bash
curl -sS -X POST 'https://suntrace-overpass.<account>.workers.dev' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data 'data=[out:json][timeout:20];(way["building"](around:90,41.9028,12.4964););out geom;' \
  -D - -o /dev/null | grep -i x-suntrace-cache
# first call:  X-Suntrace-Cache: miss
# second call: X-Suntrace-Cache: hit   ← the cache works
```

## Free-plan limits (plenty at this scale)

| Resource | Free limit | Expected use |
|---|---|---|
| Worker requests | 100,000/day | a few hundred |
| KV reads | 100,000/day | same |
| KV writes | 1,000/day | only on cache misses |

## Privacy note

With the proxy on, the requested areas go through your worker (Cloudflare sees
its logs). Reflect it in `privacy.html` the day you switch it on: the
"Third-party services" section must name the proxy instead of a direct
connection to Overpass.
