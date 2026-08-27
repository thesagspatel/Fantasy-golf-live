const TOURNAMENT_ID = "R2026060";
const PGA_ENDPOINT = "https://orchestrator.pgatour.com/graphql";
const PGA_API_KEY = "da2-gsrx5bibzbb4njvhl7t37wqyl4";

const FANTASY_PLAYERS = [
  { owner: "Sagar", golfer: "Scottie Scheffler", fedex: 1 },
  { owner: "Speedzoom", golfer: "Matt Fitzpatrick", fedex: 2 },
  { owner: "Jacob", golfer: "Wyndham Clark", fedex: 3 },
  { owner: "Hayden", golfer: "Cameron Young", fedex: 4 },
  { owner: "Dildo", golfer: "Si Woo Kim", fedex: 5 },
  { owner: "Gage", golfer: "Chris Gotterup", fedex: 6 },
  { owner: "Jack", golfer: "Tommy Fleetwood", fedex: 9 },
  { owner: "Trey", golfer: "Ludvig Åberg", fedex: 10 },
  { owner: "Shivan", golfer: "Rory McIlroy", fedex: 11 },
  { owner: "Armaan", golfer: "Akshay Bhatia", fedex: 15 }
];

const QUERY = `
query LeaderboardCompressedV3($leaderboardCompressedV3Id: ID!) {
  leaderboardCompressedV3(id: $leaderboardCompressedV3Id) {
    id
    payload
  }
}
`;

export default {
  async fetch() {
    try {
      const response = await fetch(PGA_ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "accept": "application/graphql-response+json, application/json",
          "x-api-key": PGA_API_KEY,
          "x-pgat-platform": "web",
          "origin": "https://www.pgatour.com",
          "referer": "https://www.pgatour.com/"
        },
        body: JSON.stringify({
          operationName: "LeaderboardCompressedV3",
          variables: {
            leaderboardCompressedV3Id: TOURNAMENT_ID
          },
          query: QUERY
        })
      });

      if (!response.ok) {
        throw new Error(
          `PGA TOUR request failed with status ${response.status}`
        );
      }

      const result = await response.json();

      if (result.errors) {
        throw new Error(JSON.stringify(result.errors));
      }

      const payload =
        result?.data?.leaderboardCompressedV3?.payload;

      if (!payload) {
        throw new Error("No leaderboard payload returned.");
      }

      const leaderboard = await decompressPayload(payload);

      const livePlayers = (leaderboard.players || []).map(entry => {
        const player = entry.player || {};
        const scoring = entry.scoringData || {};

        const currentRound = Number(
          scoring.currentRound ??
          leaderboard.currentRound ??
          1
        );

        const rounds =
          scoring.rounds ||
          entry.rounds ||
          [];

        let fantasyTotal =
          scoring.total ?? "E";

        let fantasyTotalSort =
          scoring.totalSort ??
          scoreToNumber(scoring.total);

        let locked = false;

        /*
          SUNDAY / ROUND 4

          Once PGA TOUR moves to Round 4, we DO NOT
          use its live tournament total.

          We reconstruct the fantasy score using
          ONLY Rounds 1, 2 and 3.
        */
        if (currentRound >= 4) {
          const firstThree = rounds
            .slice(0, 3)
            .map(roundToPar);

          if (
            firstThree.length === 3 &&
            firstThree.every(x => x !== null)
          ) {
            fantasyTotalSort =
              firstThree[0] +
              firstThree[1] +
              firstThree[2];

            fantasyTotal =
              formatScore(fantasyTotalSort);

            locked = true;
          }
        }

        /*
          SATURDAY

          Once a golfer finishes Round 3, his
          individual 54-hole result is complete.
        */
        if (
          currentRound === 3 &&
          String(scoring.thru || "")
            .toUpperCase() === "F"
        ) {
          locked = true;
        }

        return {
          golfer:
            player.displayName ||
            `${player.firstName || ""} ${player.lastName || ""}`.trim(),

          total: fantasyTotal,
          totalSort: fantasyTotalSort,

          today:
            currentRound >= 4
              ? "LOCKED"
              : (scoring.score ?? "-"),

          thru:
            currentRound >= 4
              ? "54"
              : (scoring.thru ?? "-"),

          position:
            scoring.position ?? "-",

          state:
            scoring.playerState ?? "UNKNOWN",

          currentRound,
          locked
        };
      });

      let fantasy = FANTASY_PLAYERS.map(fp => {
        const live = livePlayers.find(
          p =>
            normalize(p.golfer) ===
            normalize(fp.golfer)
        );

        if (!live) {
          return {
            ...fp,
            total: "-",
            totalSort: 999,
            today: "-",
            thru: "-",
            position: "-",
            state: "NOT_FOUND",
            currentRound:
              Number(leaderboard.currentRound) || 1,
            locked: false
          };
        }

        return {
          ...fp,
          ...live
        };
      });

      /*
        SORTING

        1. Lowest cumulative golf score
        2. FedExCup ranking entering tournament
           if tied
      */
      fantasy.sort((a, b) => {
        const scoreDifference =
          Number(a.totalSort) -
          Number(b.totalSort);

        if (scoreDifference !== 0) {
          return scoreDifference;
        }

        return a.fedex - b.fedex;
      });

      fantasy = fantasy.map(
        (player, index) => ({
          ...player,
          draftPick: index + 1
        })
      );

      return new Response(
        buildPage(fantasy, leaderboard),
        {
          headers: {
            "content-type":
              "text/html; charset=UTF-8",

            "cache-control":
              "no-store, no-cache, must-revalidate"
          }
        }
      );

    } catch (error) {
      return new Response(
        buildErrorPage(error),
        {
          status: 500,
          headers: {
            "content-type":
              "text/html; charset=UTF-8",

            "cache-control":
              "no-store"
          }
        }
      );
    }
  }
};


/* --------------------------------
   PGA PAYLOAD DECOMPRESSION
-------------------------------- */

async function decompressPayload(payload) {
  const binary = atob(payload);

  const compressed =
    new Uint8Array(binary.length);

  for (
    let i = 0;
    i < binary.length;
    i++
  ) {
    compressed[i] =
      binary.charCodeAt(i);
  }

  const stream =
    new Blob([compressed])
      .stream()
      .pipeThrough(
        new DecompressionStream("gzip")
      );

  const text =
    await new Response(stream).text();

  return JSON.parse(text);
}


/* --------------------------------
   ROUND 1–3 LOCKING
-------------------------------- */

function roundToPar(round) {
  if (
    round === null ||
    round === undefined
  ) {
    return null;
  }

  /*
    PGA payloads can represent a round as either
    a number/string or an object.
  */
  const raw =
    typeof round === "object"
      ? (
          round.score ??
          round.strokes ??
          round.total ??
          round.roundScore
        )
      : round;

  if (
    raw === null ||
    raw === undefined ||
    raw === ""
  ) {
    return null;
  }

  /*
    If PGA already supplies relative-to-par
    notation, use it directly.
  */
  const text =
    String(raw).trim().toUpperCase();

  if (text === "E") {
    return 0;
  }

  if (
    text.startsWith("+") ||
    text.startsWith("-")
  ) {
    const relative = Number(text);

    return Number.isFinite(relative)
      ? relative
      : null;
  }

  /*
    East Lake is par 70.

    Completed round stroke scores such as
    67, 70, 72 are therefore converted to
    -3, E, +2.
  */
  const strokes = Number(text);

  if (!Number.isFinite(strokes)) {
    return null;
  }

  if (strokes >= 50) {
    return strokes - 70;
  }

  /*
    Defensive fallback in case PGA supplies
    relative-to-par as a plain number.
  */
  return strokes;
}


/* --------------------------------
   SCORE HELPERS
-------------------------------- */

function scoreToNumber(score) {
  if (
    score === null ||
    score === undefined ||
    score === "" ||
    score === "-" ||
    score === "--"
  ) {
    return 999;
  }

  if (
    String(score)
      .toUpperCase() === "E"
  ) {
    return 0;
  }

  const number =
    Number(
      String(score)
        .replace("+", "")
    );

  return Number.isFinite(number)
    ? number
    : 999;
}


function formatScore(score) {
  const n = Number(score);

  if (!Number.isFinite(n)) {
    return "-";
  }

  if (n === 0) {
    return "E";
  }

  if (n > 0) {
    return `+${n}`;
  }

  return String(n);
}


function displayScore(score) {
  if (
    score === 0 ||
    score === "0"
  ) {
    return "E";
  }

  return score ?? "-";
}


function scoreClass(score) {
  const n =
    scoreToNumber(score);

  if (n < 0) {
    return "under";
  }

  if (
    n > 0 &&
    n < 999
  ) {
    return "over";
  }

  return "";
}


/* --------------------------------
   PLAYER NAME MATCHING
-------------------------------- */

function normalize(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .replace(
      /[^\w]/g,
      ""
    )
    .toLowerCase();
}


/* --------------------------------
   HTML SAFETY
-------------------------------- */

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


/* --------------------------------
   MAIN PAGE
-------------------------------- */

function buildPage(
  players,
  leaderboard
) {

  const allLocked =
    players.every(
      player => player.locked
    );

  const currentRound =
    Number(
      leaderboard.currentRound || 1
    );

  const rows =
    players.map(player => `

      <div class="player-row">

        <div class="pick">
          ${player.draftPick}
        </div>


        <div class="identity">

          <div class="owner">
            ${escapeHtml(
              player.owner
            )}
          </div>

          <div class="golfer">
            ${escapeHtml(
              player.golfer
            )}
          </div>

          <div class="fedex">
            FedExCup #${player.fedex}
          </div>

        </div>


        <div class="
          score
          ${scoreClass(player.total)}
        ">
          ${escapeHtml(
            displayScore(
              player.total
            )
          )}
        </div>


        <div class="today">
          ${escapeHtml(
            displayScore(
              player.today
            )
          )}
        </div>


        <div class="thru">
          ${escapeHtml(
            player.thru
          )}
        </div>

      </div>

    `).join("");


  const updated =
    new Date()
      .toLocaleTimeString(
        "en-US",
        {
          timeZone:
            "America/Chicago",

          hour:
            "numeric",

          minute:
            "2-digit",

          second:
            "2-digit"
        }
      );


  /*
    If PGA has moved to Round 4,
    the fantasy leaderboard is
    automatically considered final
    because Sunday is excluded.
  */
  const final54 =
    allLocked ||
    currentRound >= 4;


  return `<!doctype html>

<html lang="en">

<head>

<meta charset="UTF-8">

<meta
  name="viewport"
  content="
    width=device-width,
    initial-scale=1,
    viewport-fit=cover
  "
>

<meta
  http-equiv="refresh"
  content="20"
>

<title>
Fantasy Draft Live
</title>


<style>

:root {

  color-scheme: dark;

  --background:
    #080b0d;

  --card:
    #12171a;

  --border:
    #293034;

  --text:
    #f5f7f6;

  --muted:
    #8e9993;

  --green:
    #4bd47b;

  --red:
    #ff7474;

}


* {
  box-sizing:
    border-box;
}


body {

  margin:
    0;

  background:
    var(--background);

  color:
    var(--text);

  font-family:
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    sans-serif;
}


main {

  max-width:
    800px;

  margin:
    auto;

  padding:
    24px
    12px
    50px;
}


h1 {

  margin:
    0 0 5px;

  font-size:
    27px;
}


.subtitle {

  color:
    var(--muted);

  font-size:
    14px;
}


.live-box {

  margin-top:
    16px;

  display:
    flex;

  justify-content:
    space-between;

  align-items:
    center;

  gap:
    10px;
}


.live {

  font-size:
    12px;

  font-weight:
    850;
}


.dot {

  display:
    inline-block;

  width:
    9px;

  height:
    9px;

  margin-right:
    7px;

  border-radius:
    50%;

  background:
    var(--green);
}


.updated {

  color:
    var(--muted);

  font-size:
    12px;
}


.board {

  margin-top:
    18px;

  overflow:
    hidden;

  background:
    var(--card);

  border:
    1px solid
    var(--border);

  border-radius:
    16px;
}


.header-row,
.player-row {

  display:
    grid;

  grid-template-columns:
    42px
    minmax(0, 1fr)
    53px
    53px
    43px;

  align-items:
    center;

  gap:
    5px;
}


.header-row {

  padding:
    11px 8px;

  background:
    #171d20;

  color:
    var(--muted);

  font-size:
    9px;

  font-weight:
    850;

  text-transform:
    uppercase;
}


.player-row {

  padding:
    13px 8px;

  border-top:
    1px solid
    var(--border);
}


.pick {

  text-align:
    center;

  font-size:
    23px;

  font-weight:
    900;
}


.identity {
  min-width:
    0;
}


.owner {

  font-size:
    16px;

  font-weight:
    850;
}


.golfer {

  margin-top:
    2px;

  color:
    #c7cfcb;

  font-size:
    12px;

  white-space:
    nowrap;

  overflow:
    hidden;

  text-overflow:
    ellipsis;
}


.fedex {

  margin-top:
    3px;

  color:
    var(--muted);

  font-size:
    10px;
}


.score {

  text-align:
    center;

  font-size:
    19px;

  font-weight:
    900;
}


.today,
.thru {

  text-align:
    center;

  font-size:
    13px;

  font-weight:
    700;
}


.under {
  color:
    var(--green);
}


.over {
  color:
    var(--red);
}


.rules {

  margin-top:
    17px;

  color:
    var(--muted);

  font-size:
    12px;

  line-height:
    1.55;
}


.rules strong {
  color:
    var(--text);
}


.final-banner {

  margin-top:
    15px;

  padding:
    12px;

  background:
    #13251b;

  border:
    1px solid
    #315d40;

  border-radius:
    12px;

  font-size:
    13px;

  font-weight:
    850;

  text-align:
    center;
}


</style>

</head>


<body>


<main>


<h1>
🏌️ Fantasy Draft Live
</h1>


<div class="subtitle">

2026 TOUR Championship

•

${
  final54
    ? "54-hole standings"
    : `Round ${currentRound}`
}

</div>


${
  final54
    ? `

      <div class="final-banner">
        🔒 FINAL DRAFT ORDER —
        54 HOLES
      </div>

    `
    : `

      <div class="live-box">

        <div class="live">

          <span class="dot">
          </span>

          LIVE

        </div>

        <div class="updated">
          Updated ${updated} CT
        </div>

      </div>

    `
}


<div class="board">


<div class="header-row">

  <div>
    Pick
  </div>

  <div>
    Owner / Golfer
  </div>

  <div style="text-align:center">
    Total
  </div>

  <div style="text-align:center">
    Today
  </div>

  <div style="text-align:center">
    Thru
  </div>

</div>


${rows}


</div>


<div class="rules">

<strong>
Only our 10 selected golfers count.
</strong>

<br><br>

Thursday through Saturday,
the page automatically updates
the projected fantasy draft order
using each golfer's live cumulative
TOUR Championship score.

<br><br>

If two golfers have the same
cumulative score, the golfer with
the better
<strong>
FedExCup ranking entering the
TOUR Championship
</strong>
receives the earlier draft pick.

<br><br>

Once Round 3 is complete,
the draft order is based on the
first
<strong>
54 holes only.
</strong>

Sunday's Round 4 scores are
excluded from the fantasy
draft order.

<br><br>

While live, this page refreshes
every
<strong>
20 seconds.
</strong>

</div>


</main>


</body>

</html>`;
}


/* --------------------------------
   ERROR PAGE
-------------------------------- */

function buildErrorPage(error) {

  return `<!doctype html>

<html>

<head>

<meta
  name="viewport"
  content="
    width=device-width,
    initial-scale=1
  "
>

<meta
  http-equiv="refresh"
  content="20"
>

<title>
Fantasy Draft Live
</title>


<style>

body {

  margin:
    0;

  padding:
    30px 18px;

  background:
    #080b0d;

  color:
    white;

  font-family:
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    sans-serif;
}


.error {

  max-width:
    700px;

  margin:
    auto;

  padding:
    20px;

  background:
    #241517;

  border:
    1px solid
    #713b42;

  border-radius:
    16px;
}


h2 {
  margin-top:
    0;
}


p {
  color:
    #c3c8c5;
}


pre {

  white-space:
    pre-wrap;

  word-break:
    break-word;

  color:
    #ffb6bd;
}


</style>

</head>


<body>


<div class="error">

<h2>
Live leaderboard temporarily unavailable
</h2>

<p>
The page will automatically retry
in 20 seconds.
</p>

<pre>
${escapeHtml(
  String(
    error?.stack ||
    error
  )
)}
</pre>

</div>


</body>

</html>`;
}
