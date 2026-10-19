// Rate limits (#101). Pure: nothing here touches Cloudflare, the clock or Math.random, so node runs it as it is; the
// caller passes `now` (ms).
//
//   LIMITS.msg      every message of one connection (the Room object, key: the connection)
//   LIMITS.miss     joins without a valid token that name a room that does not exist, per client address (the Limits
//                   object); once an address has had `max` within `per`, every join without a valid token is refused,
//                   and a refused join counts as one more
//   LIMITS.create   rooms opened, per client address (the Limits object)
//
//   limiter({ max, per }) → { allow(key, now) }
//     true while `key` has had fewer than `max` calls within the last `per` ms. Every call counts, allowed or not, so a
//     flood that never pauses never gets through.
//   step(times, now, { max, per }) → { ok, times }
//     the same for one key whose calls so far are `times` (the list a store keeps): `ok` is allow's answer, `times` the
//     list to keep after this call. Only the last `max` calls can decide an answer (the call `max` back is inside the
//     window or it is not), so the list never holds more than `max`.
//   count(times, now, { per }) → the calls within the last `per` ms
export const LIMITS = { msg: { max: 30, per: 10_000 }, miss: { max: 20, per: 600_000 }, create: { max: 30, per: 600_000 } };

const recent = (times, now, per) => (Array.isArray(times) ? times : []).filter((t) => typeof t === "number" && t > now - per);

export function count(times, now, { per }) { return recent(times, now, per).length; }

export function step(times, now, { max, per }) {
  const kept = recent(times, now, per);
  const ok = kept.length < max;
  kept.push(now);
  return { ok, times: kept.slice(-max) };
}

export function limiter({ max, per }) {
  const calls = new Map();
  return {
    allow(key, now) {
      const r = step(calls.get(key), now, { max, per });
      calls.set(key, r.times);
      return r.ok;
    },
  };
}
