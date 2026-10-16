// tools/balance58.mjs — v0.7 option 丙 (each issue led on election day: canvassing luck +10, outside the 80 cap, at most
// 95) with the starting luck 50/50/55, next to v0.6 and the v0.7 draft, bot against bot (#58). Orchestrator's file.
//
//   node tools/balance58.mjs [games=2400]
//
// Five arms on the same seeds (1…games), through tests/sim.js (its worker pool):
//   v0.6 (candidate) · v0.7 draft (50/50/60) · v0.7 luck 50/50/55 · v0.7 50/50/55 + 丙 (the owner's ask) · v0.7 50/50/60 + 丙
// The last one tells the two changes apart.
//   - #58's acceptance (sets the exit code):
//       · the first three arms are what this tool's numbers were on main before #58 (7c3e329; the third measured there
//         with LUCK_START edited to 50/50/55 on a probe): the bots' changes for 丙 change nothing else, game for game;
//       · the 丙 arms run on the options asked for (the JSON line says luck and issueLuck) and say how many issues each
//         seat led at the conversion (leadsAtVote) and its average canvassing luck (canvassLuck); somebody led one.
//   - the owner's reading (printed, never counted): wins (band 25–42 %), margin (≤ 6), turnout (80–92 %), CP spent on
//     issues, issues led at the vote, canvassing luck.
// sim.js options this needs (#58, BE): luck=a,b,c and issues=lead, passed to createGame as { luck: [a, b, c], issueLuck:
// "lead" }; the JSON line adds "luck" and "issueLuck" when given, and for v0.7 games "leadsAtVote" and "canvassLuck"
// (averages per seat, 陳 / 宋 / 連).
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const games = Number.parseInt(process.argv[2] || "2400", 10);
const SIM = fileURLToPath(new URL("../tests/sim.js", import.meta.url));
const ARMS = [
  { key: "v0.6", args: ["rules=v0.6", "fill=candidate"] },
  { key: "v0.7 草稿 50/50/60", args: ["rules=v0.7"] },
  { key: "v0.7 50/50/55", args: ["rules=v0.7", "luck=50,50,55"], luck: [50, 50, 55] },
  { key: "v0.7 50/50/55 + 丙", args: ["rules=v0.7", "luck=50,50,55", "issues=lead"], luck: [50, 50, 55], c: true },
  { key: "v0.7 50/50/60 + 丙", args: ["rules=v0.7", "luck=50,50,60", "issues=lead"], luck: [50, 50, 60], c: true },
];
// Measured on main 7c3e329, games 2400, seeds 1…2400, levels 3,3,3 (copied from the tool's output there by hand).
const MAIN = {
  "v0.6": { win: [35.8, 35.8, 28.4], votes: [44.7, 44.4, 43.9], margin: 3.2, turnout: 86.4 },
  "v0.7 草稿 50/50/60": { win: [31.4, 34.8, 33.8], votes: [44.9, 44.5, 44.7], margin: 3.9, turnout: 87.1 },
  "v0.7 50/50/55": { win: [36.3, 36.3, 27.4], votes: [45.3, 44.7, 44.1], margin: 3.9, turnout: 87.1 },
};

const out = {};
for (const a of ARMS) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [SIM, String(games), ...a.args, "seed=1", "quiet=1"], { encoding: "utf8", maxBuffer: 1 << 26 });
  const line = (r.stdout || "").trim().split("\n").filter((l) => l.startsWith("{")).pop();
  let j = null; try { j = line ? JSON.parse(line) : null; } catch { /* not JSON */ }
  out[a.key] = { j, err: j ? null : `exit ${r.status}: ${((r.stderr || r.stdout || "").split("\n").find((l) => /Error/.test(l)) || "").trim().slice(0, 200)}`, s: Math.round((Date.now() - t0) / 1000) };
}

let fails = 0;
const rule = (pass, text) => { console.log(`${pass ? "✓" : "✗"} ${text}`); if (!pass) fails++; };
const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
for (const [k, m] of Object.entries(MAIN)) {
  const { j, err } = out[k];
  const got = j && { win: j.win, votes: j.votes, margin: j.margin, turnout: j.turnout };
  const echo = ARMS.find((a) => a.key === k).luck;
  const okEcho = !echo || (j && same(j.luck, echo));
  rule(!!j && games === 2400 && same(got, m) && okEcho, `${k} unchanged from main: ${j ? `win ${j.win.join("/")}, votes ${j.votes.join("/")}, margin ${j.margin}, turnout ${j.turnout}%` : err}${games !== 2400 ? " (only 2400 games compare)" : ""}${okEcho ? "" : `; luck in the JSON ${j && JSON.stringify(j.luck)}`}`);
}
for (const a of ARMS.filter((x) => x.c)) {
  const { j, err } = out[a.key];
  const okOpt = !!j && same(j.luck, a.luck) && j.issueLuck === "lead";
  const okStats = !!j && Array.isArray(j.leadsAtVote) && j.leadsAtVote.length === 3 && Array.isArray(j.canvassLuck) && j.canvassLuck.length === 3;
  rule(okOpt && okStats && j.leadsAtVote.some((x) => x > 0), `${a.key}: ran on luck ${j ? JSON.stringify(j.luck) : "?"} and issueLuck ${j ? j.issueLuck : "?"}; issues led at the vote ${okStats ? j.leadsAtVote.join("/") : "missing"}${j ? "" : " — " + err}`);
}

console.log("owner's reading (not counted):");
const NAMES = ["陳", "宋", "連"];
for (const a of ARMS) {
  const { j, s } = out[a.key]; if (!j) { console.log(`  ${a.key}: no numbers`); continue; }
  const band = j.win.every((w) => w >= 25 && w <= 42) && j.margin <= 6 && j.turnout >= 80 && j.turnout <= 92;
  const iss = j.cp ? j.cp.map((c) => c[2]).join("/") : "?";
  console.log(`  ${a.key}: wins ${j.win.map((w, p) => `${NAMES[p]} ${w}`).join(" / ")} %, margin ${j.margin}, turnout ${j.turnout} %${band ? " (in the band)" : " (OUT of the band)"}; CP on issues ${iss} %${j.leadsAtVote ? `; issues led at the vote ${j.leadsAtVote.join("/")}` : ""}${j.canvassLuck ? `; canvassing luck ${j.canvassLuck.join("/")}` : ""}; ${s} s`);
}
console.log(fails ? `FAIL: ${fails} of ${Object.keys(MAIN).length + ARMS.filter((x) => x.c).length} checks` : `PASS: ${Object.keys(MAIN).length + ARMS.filter((x) => x.c).length} checks`);
process.exit(fails ? 1 : 0);
