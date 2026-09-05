// background.js — talks to the public Lichess and Chess.com APIs, then
// turns raw game history into scouting stats. All network calls happen
// here (not in the content script) so a single place owns the API logic.

const MAX_GAMES = 100;

// ---------- helpers shared by both platforms ----------

function emptyOpeningRow() {
  return { wins: 0, losses: 0, draws: 0, total: 0 };
}

function buildStats(wins, losses, draws, openings, timelineOldestFirst) {
  const total = wins + losses + draws;
  const winRate = total ? Math.round((wins / total) * 100) : 0;

  const half = Math.floor(timelineOldestFirst.length / 2);
  const olderHalf = timelineOldestFirst.slice(0, half);
  const recentHalf = timelineOldestFirst.slice(half);
  const rateOf = (arr) => {
    if (!arr.length) return 0;
    const w = arr.filter((r) => r === "win").length;
    return (w / arr.length) * 100;
  };
  const olderRate = rateOf(olderHalf);
  const recentRate = rateOf(recentHalf);

  let trend = "stable";
  if (timelineOldestFirst.length >= 10) {
    if (recentRate - olderRate >= 8) trend = "improving";
    else if (olderRate - recentRate >= 8) trend = "declining";
  }

  const openingList = Object.entries(openings).map(([name, o]) => ({
    name,
    ...o,
    winRate: o.total ? Math.round((o.wins / o.total) * 100) : 0,
    lossRate: o.total ? Math.round((o.losses / o.total) * 100) : 0,
  }));

  // Openings where the opponent loses most often (min 2 games sampled) —
  // these are the lines worth steering the game toward.
  const weakOpenings = openingList
    .filter((o) => o.total >= 2 && o.losses > 0)
    .sort((a, b) => b.lossRate - a.lossRate || b.total - a.total)
    .slice(0, 5);

  // Openings the opponent wins most often — worth avoiding.
  const strongOpenings = openingList
    .filter((o) => o.total >= 2 && o.wins > 0)
    .sort((a, b) => b.winRate - a.winRate || b.total - a.total)
    .slice(0, 5);

  return {
    total,
    wins,
    losses,
    draws,
    winRate,
    trend,
    olderRate: Math.round(olderRate),
    recentRate: Math.round(recentRate),
    weakOpenings,
    strongOpenings,
  };
}

function shortenOpeningName(name) {
  return name.split(":")[0].split(",")[0].trim() || name;
}

// ---------- Lichess ----------

async function fetchLichessGames(username, max) {
  const url =
    `https://lichess.org/api/games/user/${encodeURIComponent(username)}` +
    `?max=${max}&opening=true&sort=dateDesc`;
  const res = await fetch(url, { headers: { Accept: "application/x-ndjson" } });
  if (res.status === 404) throw new Error("player_not_found");
  if (!res.ok) throw new Error(`lichess_http_${res.status}`);
  const text = await res.text();
  return text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function analyzeLichess(games, username) {
  const uname = username.toLowerCase();
  let wins = 0,
    losses = 0,
    draws = 0;
  const openings = {};
  const timeline = []; // will be newest-first from the API, reversed below

  for (const g of games) {
    const white = g.players?.white?.user?.name?.toLowerCase();
    const black = g.players?.black?.user?.name?.toLowerCase();
    let side = null;
    if (white === uname) side = "white";
    else if (black === uname) side = "black";
    else continue;

    let result;
    if (!g.winner) result = "draw";
    else result = g.winner === side ? "win" : "loss";

    if (result === "win") wins++;
    else if (result === "loss") losses++;
    else draws++;

    const family = shortenOpeningName(g.opening?.name || "Ouverture inconnue");
    if (!openings[family]) openings[family] = emptyOpeningRow();
    openings[family][result === "win" ? "wins" : result === "loss" ? "losses" : "draws"]++;
    openings[family].total++;

    timeline.push(result);
  }

  timeline.reverse(); // oldest -> newest
  return buildStats(wins, losses, draws, openings, timeline);
}

// ---------- Chess.com ----------

async function fetchChesscomGames(username, max) {
  const archivesUrl = `https://api.chess.com/pub/player/${encodeURIComponent(
    username.toLowerCase()
  )}/games/archives`;
  const archivesRes = await fetch(archivesUrl);
  if (archivesRes.status === 404) throw new Error("player_not_found");
  if (!archivesRes.ok) throw new Error(`chesscom_http_${archivesRes.status}`);
  const { archives } = await archivesRes.json();
  if (!archives || !archives.length) return [];

  let games = [];
  for (let i = archives.length - 1; i >= 0 && games.length < max; i--) {
    const res = await fetch(archives[i]);
    if (!res.ok) continue;
    const data = await res.json();
    const monthGames = (data.games || []).slice().reverse(); // most recent first
    games = games.concat(monthGames);
  }
  return games.slice(0, max);
}

function classifyChesscomResult(resultStr) {
  const drawResults = new Set([
    "agreed",
    "repetition",
    "stalemate",
    "insufficient",
    "50move",
    "timevsinsufficient",
]);
  if (resultStr === "win") return "win";
  if (drawResults.has(resultStr)) return "draw";
  return "loss"; // checkmated, resigned, timeout, abandoned, lose, ...
}

function extractChesscomOpening(game) {
  if (game.eco) {
    try {
      const slug = decodeURIComponent(game.eco.split("/").pop() || "");
      const name = slug.replace(/-/g, " ").trim();
      if (name) return name;
    } catch (e) {
      /* fall through */
    }
  }
  return "Ouverture inconnue";
}

function analyzeChesscom(games, username) {
  const uname = username.toLowerCase();
  let wins = 0,
    losses = 0,
    draws = 0;
  const openings = {};
  const timeline = [];

  for (const g of games) {
    const white = g.white?.username?.toLowerCase();
    const black = g.black?.username?.toLowerCase();
    let side = null;
    if (white === uname) side = "white";
    else if (black === uname) side = "black";
    else continue;

    const result = classifyChesscomResult(g[side]?.result);
    if (result === "win") wins++;
    else if (result === "loss") losses++;
    else draws++;

    const family = shortenOpeningName(extractChesscomOpening(g));
    if (!openings[family]) openings[family] = emptyOpeningRow();
    openings[family][result === "win" ? "wins" : result === "loss" ? "losses" : "draws"]++;
    openings[family].total++;

    timeline.push(result);
  }

  timeline.reverse();
  return buildStats(wins, losses, draws, openings, timeline);
}

// ---------- message handling ----------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "COS_NOTIFY") {
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: msg.title || "Chess Opponent Scout",
      message: msg.message || "",
      priority: 1,
    });
    return false;
  }

  if (msg?.type !== "SCOUT_REQUEST") return false;

  (async () => {
    try {
      const username = String(msg.username || "").trim();
      if (!username) throw new Error("empty_username");

      let stats;
      if (msg.platform === "lichess") {
        const games = await fetchLichessGames(username, MAX_GAMES);
        if (!games.length) throw new Error("no_games");
        stats = analyzeLichess(games, username);
      } else if (msg.platform === "chesscom") {
        const games = await fetchChesscomGames(username, MAX_GAMES);
        if (!games.length) throw new Error("no_games");
        stats = analyzeChesscom(games, username);
      } else {
        throw new Error("unknown_platform");
      }
      sendResponse({ ok: true, stats });
    } catch (e) {
      sendResponse({ ok: false, error: e.message || String(e) });
    }
  })();

  return true; // keep the message channel open for the async response
});
