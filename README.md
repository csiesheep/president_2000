# 2000: Taiwan Decides 2000：總統的誕生

A browser card-driven election game for three players, set in Taiwan's 2000 presidential race: 陳水扁, 宋楚瑜 and 連戰 fight nine turns over 154 vote blocks across 25 counties, from the November 1999 expulsion to election night. Play solo against AI, or open an online room and share a four-letter code with friends; bots fill any empty seats. English and Traditional Chinese.

A free fan project, not affiliated with any publisher. The text is our own; the art (cards and illustrations) was generated with Qwen-Image, under the Qwen Research License, for non-commercial use only. The play is inspired by *1960: The Making of the President*, designed by Christian Leonhard and Jason Matthews; game rules and mechanics are not copyrightable, and this is an independent implementation under its own name and setting.

Live at https://games.csiesheep.com/president_2000/ (placeholder until M3).

## How it works

Everything runs on Cloudflare as one Worker, the same shape as [Tiandihui](https://github.com/csiesheep/tiandihui):

- `public/` is the client. `public/shared/engine.js` holds all rules (board, decks, phase machine, per-seat `view(state, seat)`), `public/shared/bots.js` the AI, `public/shared/talk.js` the bots' table talk, used unchanged by both the browser and the server. Every player-visible string is in `public/i18n/`.
- `src/index.js` is the Worker: the path-prefix router that serves `/president_2000/…` plus the WebSocket entry at `/president_2000/ws`.
- `src/room.js` is a Durable Object, one per room (M4).

URLs are query strings on the page so the same build works at any prefix: `/president_2000/` landing, `?play` solo, `?room=ABCD` a room.

## Milestones

0. **M0 Scaffold** — router, placeholder page, deploy, `TEAM.md`, a first guard seen red.
1. **M1 Engine** — board (154 blocks), 96-card decks, turn loop, support checks, 政見發表會, 棄保, 投票日; tests incl. a fuzz over legal moves.
2. **M2 Bots** — three levels, a bot-vs-bot harness; v0.2 balance targets from the design simulator.
3. **M3 Solo** — the full game in the browser, bot table talk, rules page.
4. **M4 Rooms** — Durable Object, clocks, chat, bot fill, reconnect, rematch.
5. **M5 Ship** — noindex off, OG, JSON-LD, hub tile, sitemap.

Design documents (rulebook v0.2, decisions, simulation results) live in the owner's vault under `Projects/president_2000/`.

## Develop

    npm install
    npm run dev
    npm test
