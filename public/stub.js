// The card's stub (#51): the strip at the foot of a card, below a perforation. Row one is the issue (a line-drawn newspaper, the
// issue's name, "no issue" faded on a local card) with the rest cubes at its right end; row two is "election-day canvass" (a
// line-drawn ballot box) and the county. Pure: the caller hands over the words, so the table and the rules page share one drawing.
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const INK = "#2b2118", PAPER = "#fffaf0";
const NEWS = `<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M3.5 3.5h11v13H5a1.5 1.5 0 0 1-1.5-1.5z" fill="${PAPER}" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/><path d="M14.5 7h2v8.5a1 1 0 0 1-1 1h-1" fill="none" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/><path d="M6 6.8h6" stroke="${INK}" stroke-width="2.2"/><path d="M6 10h6M6 13h6" stroke="${INK}" stroke-width="1.3"/></svg>`;
const BOX = `<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M3 9h14v8H3z" fill="none" stroke="${INK}" stroke-width="1.8"/><path d="M6 9V3h8v6" fill="${PAPER}" stroke="${INK}" stroke-width="1.8"/><path d="M7 12h6" stroke="${INK}" stroke-width="1.8"/></svg>`;

// { issue: name or null, noIssue, issueLabel, canvassLabel, county, rest: cubes or null (not drawn), restLabel }
export function stubHTML({ issue, noIssue, issueLabel, canvassLabel, county, rest = null, restLabel = "" }) {
  const cubes = rest ? `<span class="st-rest" data-rest="${rest}" role="img" aria-label="${esc(restLabel)}">${"<i></i>".repeat(rest)}</span>` : "";
  return `<span class="stub" data-stub>` +
    `<span class="st-row st-issue${issue ? "" : " st-none"}" data-stub-issue>${NEWS}<small>${esc(issueLabel)}</small><b>${esc(issue || noIssue)}</b>${cubes}</span>` +
    `<span class="st-row st-county" data-stub-county>${BOX}<small>${esc(canvassLabel)}</small><b>${esc(county)}</b></span></span>`;
}
