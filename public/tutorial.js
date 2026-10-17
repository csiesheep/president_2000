// The tutorial (#27): a layer on top of the solo game, not a second game. It is one fixed game (the seed
// below; the player is 陳, the opponents are two level-1 bots) plus a list of steps. A step is something the
// player reads (next), a county they tap (county) or a move they make (move); while it is on, the screen
// carries the step's bubble, lights the element it points at and locks every other move button.
// The state lives in the solo session as `tut: { i }` (the index of the step the player is on), so a
// reload comes back to the same step; `tut: null` is a normal game. Nothing here touches the DOM, and
// the engine, the bots and the rules are used as they are. See tests/tutorial.test.js for the contract.
import * as E from "./shared/engine.js";
import { SEATS, COUNTIES, REGIONS } from "./shared/board.js";
import * as Solo from "./solo.js";
import { bind, esc, checkRate } from "./table.js";

// Chosen so the opening is clean: this seed gives the human the initiative (so the order step can be taught),
// a 3 CP card of their own in hand (sweep_black_gold, so nothing for an opponent to trigger), an empty light green
// block in the home county that needs no check and light blue ones that do.
export const SEED = 21;
const SEAT = 0;

const key = (m) => JSON.stringify(m);
const fill = (s, vars = {}) => s.replace(/\{(\w+)(?:#([^|}]*)\|([^}]*))?\}/g, (m, k, one, many) => (!(k in vars) ? m : one === undefined ? vars[k] : Number(vars[k]) === 1 ? one : many)); // "{n#block|blocks}": the singular at 1 (#30)
const NO = [5, 1, 2];

export function newTutorial(seed = SEED) {
  const s = Solo.advance(Solo.newSolo({ seat: SEAT, level: 1, seed }));
  return { ...s, tut: { i: 0 } };
}

// ---------------------------------------------------------------- what the table is in

function ctx(s) {
  const st = s.st, v = E.view(st, s.seat), legal = E.legalMoves(st, s.seat);
  return { s, st, seat: s.seat, v, legal, pd: st.pending };
}
// Does the placement need no support check? Ask the engine: play it on a copy and read its log.
const free = (c, m) => !E.apply(c.st, c.seat, m).log.slice(c.st.log.length).some((e) => e.t === "check");
const homeOf = (c) => c.st.pos[c.seat];
const mv = (m) => `data-move="${esc(key(m))}"`;
const sum = (a) => a[0] + a[1] + a[2];
const bagOf = (c, m) => c.st.rules === "v0.7" ? { rate: m ? Math.round(checkRate(c.v, c.seat, m)) : 0 } : ({ mine: c.st.bag[c.seat], total: sum(c.st.bag), rate: sum(c.st.bag) ? Math.round((100 * c.st.bag[c.seat]) / sum(c.st.bag)) : 0 });
const cpLeft = (c, spent = 0) => Math.max(0, (c.pd && typeof c.pd.cp === "number" ? c.pd.cp : 0) - spent);

// The fill the tutorial teaches: a free one, in the home county when it can.
function fillMove(c) {
  const all = c.legal.filter((m) => m.type === "fill" && free(c, m));
  return all.find((m) => m.county === homeOf(c)) || all[0] || null;
}
// The checked action it teaches: a cross-camp fill, in the same county when it can.
function crossMove(c, near) {
  const all = c.legal.filter((m) => m.type === "cross" && !free(c, m));
  return all.find((m) => m.county === near) || all[0] || null;
}
function playMove(c) {
  const cps = c.legal.filter((m) => m.type === "play" && m.mode === "cp" && !m.block && c.st.cards[m.card].cp >= 3);
  const own = (m) => c.st.cards[m.card].owner === SEATS[c.seat] || c.st.cards[m.card].owner === "local";
  return cps.filter(own).sort((a, b) => c.st.cards[a.card].cp - c.st.cards[b.card].cp)[0] || cps[0] || null;
}

const nameOf = (x, k) => x.county(k);
const base = (c, x) => ({
  who: x.full(c.seat), no: NO[c.seat], county: nameOf(x, homeOf(c)), region: x.region(COUNTIES[homeOf(c)][1]),
});

// ---------------------------------------------------------------- the steps
// plan(c) → { target, moves | county, key, vars(x) }. A step whose plan has nothing to point at (no such move,
// no such county) is skipped, so a game that went differently never leaves the player stuck on it.

const STEPS = [
  { id: "welcome", kind: "next", plan: (c) => ({ target: null, vars: (x) => base(c, x) }) },
  { id: "board", kind: "next", plan: (c) => ({ target: `data-seat="${c.seat}"`, vars: (x) => ({ ...base(c, x), onboard: c.v.counties.reduce((n, k) => n + k.blocks.filter((b) => b.o === c.seat).length, 0), mom: c.v.mom[c.seat], hand: c.v.hands[c.seat].length, ...(c.st.bag ? { bag: c.st.bag[c.seat] } : {}) }) }) },
  { id: "map", kind: "county", plan: (c) => ({ county: homeOf(c), target: `data-county="${homeOf(c)}"`, vars: (x) => base(c, x) }) },
  { id: "blocks", kind: "next", plan: (c) => ({ target: `data-county="${homeOf(c)}"`, vars: (x) => ({ ...base(c, x), blocks: c.v.counties[homeOf(c)].blocks.length }) }) },
  { id: "order", kind: "move", plan: (c) => {
    const m = c.st.phase === "order" ? c.legal.find((q) => q.type === "order" && q.pos === 0) : null;
    if (c.st.rules === "v0.6" || c.st.rules === "v0.7") return { kind: "next", target: `data-seat="${c.seat}"`, vars: (x) => base(c, x) }; // v0.6 (#57): no order to pick; read who goes first
    return { moves: m ? [m] : [], target: m ? mv(m) : null, vars: (x) => base(c, x) };
  } },
  { id: "play", kind: "move", plan: (c) => {
    const m = c.st.phase === "action" && !c.pd ? playMove(c) : null;
    return { moves: m ? [m] : [], target: m ? `data-sel="${esc(m.card)}"` : null, vars: (x) => ({ ...base(c, x), card: m ? x.card(m.card) : "", cp: m ? c.st.cards[m.card].cp : 0 }) };
  } },
  { id: "kind", kind: "move", plan: (c) => {
    const m = c.pd && c.pd.stage === "kind" ? c.legal.find((q) => q.type === "action" && q.kind === "campaign") : null;
    return { moves: m ? [m] : [], target: m ? mv(m) : null, vars: (x) => ({ ...base(c, x), card: c.pd ? x.card(c.pd.card) : "", cp: cpLeft(c) }) };
  } },
  { id: "county2", kind: "county", plan: (c) => {
    const m = c.pd && c.pd.stage === "campaign" ? fillMove(c) : null;
    return { county: m ? m.county : null, target: m ? `data-county="${m.county}"` : null, vars: (x) => ({ ...base(c, x), county: m ? nameOf(x, m.county) : "" }) };
  } },
  { id: "fill", kind: "move", plan: (c) => {
    const m = c.pd && c.pd.stage === "campaign" ? fillMove(c) : null;
    return { moves: m ? [m] : [], target: m ? mv(m) : null, vars: (x) => ({ ...base(c, x), county: m ? nameOf(x, m.county) : "", left: cpLeft(c, 1) }) };
  } },
  { id: "county3", kind: "county", plan: (c) => {
    const m = c.pd && c.pd.stage === "campaign" ? crossMove(c, homeOf(c)) : null;
    return { county: m ? m.county : null, target: m ? `data-county="${m.county}"` : null, vars: (x) => ({ ...base(c, x), county: m ? nameOf(x, m.county) : "" }) };
  } },
  { id: "cross", kind: "move", plan: (c) => {
    const m = c.pd && c.pd.stage === "campaign" ? crossMove(c, homeOf(c)) : null;
    return { moves: m ? [m] : [], target: m ? mv(m) : null, vars: (x) => ({ ...base(c, x), county: m ? nameOf(x, m.county) : "", ...bagOf(c, m) }) };
  } },
  { id: "result", kind: "next", plan: (c) => {
    const checks = (c.s.mine && c.s.mine.checks) || [], last = checks[checks.length - 1];
    return { key: last && !last.ok ? "resultFail" : "resultOk", target: c.s.mine ? 'data-res="1"' : null, vars: (x) => ({ ...base(c, x), left: cpLeft(c), who: last && last.drew != null ? x.short(last.drew) : "…" }) };
  } },
  { id: "endAction", kind: "move", plan: (c) => {
    const m = c.pd && c.pd.stage === "campaign" ? c.legal.find((q) => q.type === "done") : null;
    return { moves: m ? [m] : [], target: m ? mv(m) : null, vars: (x) => ({ ...base(c, x), left: cpLeft(c) }) };
  } },
  { id: "opponents", kind: "next", plan: (c) => ({ target: 'data-feed-toggle=""', vars: (x) => ({ ...base(c, x), a: x.short(1), b: x.short(2) }) }) },
  { id: "issues", kind: "next", plan: (c) => ({ target: 'data-issues="1"', vars: (x) => base(c, x) }) },
  { id: "debate", kind: "next", plan: (c) => ({ target: 'data-turn="1"', vars: (x) => base(c, x) }) },
  { id: "finish", kind: "next", plan: (c) => ({ target: null, vars: (x) => base(c, x) }) },
];
export const STEP_IDS = STEPS.map((d) => d.id);

// Which step is the player on? The recorded one, or the first one after it that still has something to
// point at. While the bots are moving the recorded step is returned as it is (nothing to point at yet).
function locate(s) {
  if (!s || !s.tut || !s.st || s.st.phase === "end") return null;
  const c = ctx(s), waiting = Solo.botsToMove(s).length > 0 || !E.mustAct(s.st).includes(s.seat);
  for (let i = s.tut.i; i < STEPS.length; i++) {
    const d = STEPS[i], p = d.plan(c);
    const kind = p.kind || d.kind;
    if (waiting) return { i, d, p, c, waiting, kind };
    if (kind === "move" && !p.moves.length) continue;
    if (kind === "county" && p.county == null) continue;
    return { i, d, p, c, waiting, kind };
  }
  return null;
}

export const active = (s) => !!locate(s);

// → { id, kind, text, target, moves, county }
export function step(s, lang) {
  const at = locate(s);
  if (!at) return { id: "done", kind: "done", text: "", target: null, moves: [], county: null };
  const x = bind(lang), T = x.d.ui.tutorial.steps, k = at.p.key || at.d.id;
  return {
    id: at.d.id, kind: at.kind, text: fill(T[k], at.p.vars(x)),
    target: at.p.target || null, moves: at.p.moves || [], county: at.p.county ?? null,
  };
}

const to = (s, i) => ({ ...s, tut: i >= STEPS.length ? null : { i } });

export function next(s) {
  const at = locate(s);
  return at && !at.waiting && at.kind === "next" ? to(s, at.i + 1) : s;
}
export function openCounty(s, k) {
  const at = locate(s);
  return at && !at.waiting && at.kind === "county" && at.p.county === k ? to(s, at.i + 1) : s;
}
// A move that is not the step's own leaves the session exactly as it was.
export function act(s, m) {
  const at = locate(s);
  if (!at || at.waiting || at.kind !== "move" || !at.p.moves.some((q) => key(q) === key(m))) return s;
  return to(Solo.act(s, m), at.i + 1);
}
// Out of the tutorial, whenever: what is left is a normal game.
export const skip = (s) => ({ ...s, tut: null });

// ---------------------------------------------------------------- on the screen

const unesc = (t) => t.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const reEsc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The table's HTML with the tutorial on it: the target lit (data-tut-focus), the buttons that are not the
// step's own locked (disabled), and the bubble at the end. Nothing is added while the bots move.
export function decorate(html, s, lang, opts = {}) {
  const at = locate(s);
  if (!at || at.waiting) return html;
  const st = step(s, lang), x = bind(lang), U = x.d.ui.tutorial;
  const allowed = new Set(st.kind === "move" ? st.moves.map(key) : []);
  let out = html.replace(/<([a-zA-Z][a-zA-Z0-9]*)(\s[^<>]*?\sdata-move="([^"]*)"[^<>]*)>/g, (all, name, rest, raw) => {
    let m = null;
    try { m = JSON.parse(unesc(raw)); } catch { /* not a move: leave it */ }
    if (m && allowed.has(key(m))) return all;
    return /\sdisabled(?=[\s=/>])/.test(rest) ? all : `<${name} disabled aria-disabled="true"${rest}>`;
  });
  // Once the card is open, the thing to press is its button, not the card.
  let target = st.target;
  if (st.id === "play" && opts.sel && st.moves[0] && st.moves[0].card === opts.sel) target = `data-move="${esc(key(st.moves[0]))}"`;
  const light = (t) => {
    const cut = t.indexOf("="), name = t.slice(0, cut), val = t.slice(cut + 1);
    out = out.replace(new RegExp(`<([a-zA-Z][a-zA-Z0-9]*)(\\s[^<>]*?\\s${reEsc(name)}=${reEsc(val)}[^<>]*)>`, "g"), (all, tag, rest) => `<${tag} data-tut-focus${rest}>`);
  };
  if (target) light(target);
  if (st.id === "blocks" && opts.county != null) light(`data-popover="${opts.county}"`); // the box that opened
  // The advisor's switch would put stars on the options: off the script, so locked too.
  out = out.replace(/<button(\s[^<>]*?\sdata-advisor="[^"]*"[^<>]*)>/g, (all, rest) => (/\sdisabled(?=[\s=/>])/.test(rest) ? all : `<button disabled aria-disabled="true"${rest}>`));
  const hint = st.kind === "county" ? U.hint.county : st.kind === "move" ? U.hint.move : "";
  const last = at.i === STEPS.length - 1;
  const bubble = `<aside class="tut" data-tutorial="${esc(st.id)}" data-kind="${st.kind}" role="dialog" aria-label="${esc(U.label)}">` +
    `<p class="tut-x">${esc(st.text)}</p>` + (hint ? `<p class="tut-h">${esc(hint)}</p>` : "") +
    `<div class="tut-b">${last ? "" : `<button type="button" class="tut-skip" data-tut="skip">${esc(U.skip)}</button>`}` +
    (st.kind === "next" ? `<button type="button" class="tut-go" data-tut="next">${esc(last ? U.finish : U.next)}</button>` : "") + `</div></aside>`;
  return out + bubble;
}
