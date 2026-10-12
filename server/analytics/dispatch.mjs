import { createHmac, timingSafeEqual } from 'node:crypto';
export function signature(timestamp, secret) {
  if (!secret || secret.length < 32) throw new Error('Semantic signing key unavailable');
  return createHmac('sha256', secret)
    .update('usovia-semantic:' + timestamp)
    .digest('hex');
}
export function validSemanticRequest(req, secret, now = Date.now()) {
  const time = req.headers['x-usovia-time'],
    provided = req.headers['x-usovia-signature'];
  if (
    req.method !== 'POST' ||
    typeof time !== 'string' ||
    !/^\d{13}$/.test(time) ||
    Math.abs(now - Number(time)) > 120000 ||
    typeof provided !== 'string' ||
    !/^[a-f0-9]{64}$/.test(provided)
  )
    return false;
  try {
    return timingSafeEqual(Buffer.from(provided), Buffer.from(signature(time, secret)));
  } catch {
    return false;
  }
}
let pending;
export function dispatchSemantic() {
  if (!pending)
    pending = (async () => {
      const base = new URL(process.env.PUBLIC_HUB_URL);
      if (base.protocol !== 'https:' || base.username || base.password)
        throw new Error('Private compute origin unavailable');
      const timestamp = String(Date.now());
      const r = await fetch(new URL('/internal/semantic', base), {
        method: 'POST',
        headers: {
          'x-usovia-time': timestamp,
          'x-usovia-signature': signature(timestamp, process.env.SESSION_SECRET),
        },
        signal: AbortSignal.timeout(55000),
      });
      if (!r.ok) throw new Error('Private semantic execution unavailable');
      return r.json();
    })().finally(() => {
      pending = null;
    });
  return pending;
}
