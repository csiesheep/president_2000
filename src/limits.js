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
//   addressKey(ip) → the key LIMITS.miss and LIMITS.create count a client address under (IPv6: its /64)
export const LIMITS = { msg: { max: 30, per: 10_000 }, miss: { max: 20, per: 600_000 }, create: { max: 30, per: 600_000 } };

const recent = (times, now, per) => (Array.isArray(times) ? times : []).filter((t) => typeof t === "number" && t > now - per);

export function count(times, now, { per }) { return recent(times, now, per).length; }

export function step(times, now, { max, per }) {
  const kept = recent(times, now, per);
  const ok = kept.length < max;
  kept.push(now);
  return { ok, times: kept.slice(-max) };
}

// addressKey(ip) → the key one client address is counted under (orchestrator's ruling, #101): an IPv4 address as it is;
// an IPv6 address by its /64 (one home or one phone holds a whole /64 and can take a new address for every try), written
// out in full first so every spelling of it is the same key: "2001:db8:1::5" and "2001:0DB8:1:0::6" are both
// "2001:db8:1:0::/64". An IPv4-mapped IPv6 address (::ffff:a.b.c.d) is that IPv4 address. Anything else is kept as it is.
export function addressKey(ip) {
  const s = String(ip ?? "").trim().toLowerCase();
  if (!s.includes(":")) return s;
  const groups = expand6(s.split("%")[0]);
  if (!groups) return s;
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    return [groups[6] >> 8, groups[6] & 255, groups[7] >> 8, groups[7] & 255].join(".");
  }
  return groups.slice(0, 4).map((g) => g.toString(16)).join(":") + "::/64";
}
// The eight 16-bit groups of an IPv6 address ("::" filled in, a dotted IPv4 tail as its two groups), or null.
function expand6(s) {
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const part = (h) => (h === "" ? [] : h.split(":"));
  let head = part(halves[0]), tail = halves.length === 2 ? part(halves[1]) : [];
  const v4 = (list) => {
    const last = list[list.length - 1];
    if (last === undefined || !last.includes(".")) return list;
    const b = last.split(".");
    if (b.length !== 4 || b.some((x) => !/^[0-9]{1,3}$/.test(x) || Number(x) > 255)) return null;
    const n = b.map(Number);
    return [...list.slice(0, -1), ((n[0] << 8) | n[1]).toString(16), ((n[2] << 8) | n[3]).toString(16)];
  };
  if (halves.length === 2) tail = v4(tail); else head = v4(head);
  if (!head || !tail) return null;
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const all = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (all.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return all.map((g) => parseInt(g, 16));
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
