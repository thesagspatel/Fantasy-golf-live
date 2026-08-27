export default {
  async fetch(request) {
    const EVENT_ID = "R2026060";
    const endpoint = "https://orchestrator.pgatour.com/graphql";

    const query = `
      query LeaderboardCompressedV3($leaderboardCompressedV3Id: ID!) {
        leaderboardCompressedV3(id: $leaderboardCompressedV3Id) {
          players {
            id
            firstName
            lastName
            position
            total
            currentRound
            thru
            status
          }
        }
      }
    `;

    try {
      const r = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": "g5Tx4lP8Z0M8J2B8t3r6"
        },
        body: JSON.stringify({
          operationName: "LeaderboardCompressedV3",
          variables: { leaderboardCompressedV3Id: EVENT_ID },
          query
        })
      });

      if (!r.ok) throw new Error(`PGA TOUR feed returned ${r.status}`);
      const json = await r.json();
      const players = json?.data?.leaderboardCompressedV3?.players || [];

      const html = `<!doctype html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="20">
<title>Fantasy Golf Live</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;background:#f5f7f5;color:#142018}
main{max-width:760px;margin:auto;padding:20px}
h1{margin-bottom:4px}.sub{color:#66736a;margin-bottom:18px}
.card{background:white;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px #0001}
.row{display:grid;grid-template-columns:42px 1fr 70px 65px;gap:8px;padding:14px 12px;border-bottom:1px solid #e8ece9;align-items:center}
.row:last-child{border:0}.rank{font-weight:800;font-size:20px}.name{font-weight:700}.score{font-weight:800;text-align:right}.thru{text-align:right;color:#637067}
.err{background:#fff1f1;padding:16px;border-radius:12px;color:#8b1d1d}
small{display:block;margin-top:14px;color:#758078}
</style>
</head><body><main>
<h1>Fantasy Golf Live</h1>
<div class="sub">TOUR Championship • refreshes every 20 seconds</div>
<div class="card">
${players.slice(0,30).map((p,i)=>`
<div class="row">
 <div class="rank">${p.position || i+1}</div>
 <div class="name">${p.firstName || ""} ${p.lastName || ""}</div>
 <div class="score">${p.total ?? "-"}</div>
 <div class="thru">${p.thru ?? "-"}</div>
</div>`).join("")}
</div>
<small>Live data supplied from the PGA TOUR leaderboard feed.</small>
</main></body></html>`;

      return new Response(html, { headers: { "content-type": "text/html;charset=UTF-8", "cache-control":"no-store" }});
    } catch (e) {
      return new Response(`<h2>Leaderboard feed error</h2><pre>${String(e.message || e)}</pre>`,
        {status:500, headers:{"content-type":"text/html;charset=UTF-8"}});
    }
  }
};
