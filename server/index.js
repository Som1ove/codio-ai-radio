import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { config } from './config.js';
import { getState, addPlay, addSchedule, toggleLike, toggleDislike, updatePreferences } from './state.js';
import { searchSongs, getSongUrl, getMusicSourceStatus, getNeteaseSongStreamInfo, getPlayableSongs } from './music.js';
import { getWeather } from './weather.js';
import { getCalendarContext } from './calendar.js';
import { importSpotifyPlaylist, toTasteTracks } from './spotifyPlaylist.js';
import { getImportedTasteProfile } from './taste.js';
import { getOrCreateDailyPlan, getTodayPlanWithSongs, radioTick, refreshTodayQueue } from './curator.js';
import { generateHostIntro } from './claude.js';
import { buildHostIntroEvents } from './hostIntro.js';
import { routeCommand } from './router.js';
import { startScheduler } from './scheduler.js';
import { createWebSocketHub } from './ws.js';
import { createSpotifyLoginUrl, getSpotifyAuthStatus, getSpotifyUserToken, handleSpotifyCallback, playSpotifyUri } from './spotifyAuth.js';
import { ensureNeteaseService, getNeteaseServiceStatus } from './neteaseService.js';

const publicDir = path.join(config.root, 'public');

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.mp3': 'audio/mpeg'
};

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function send(res, status, body, headers = {}) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    ...headers
  });
  res.end(payload);
}

function sendSpotifyCallbackPage(res, status, message) {
  const ok = status >= 200 && status < 300;
  const redirectTo = `http://${config.host}:${config.port}/?spotify=${ok ? 'connected' : 'error'}`;
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Spotify ${ok ? '已连接' : '连接失败'}</title>
    <meta http-equiv="refresh" content="1.2;url=${redirectTo}">
    <style>
      body {
        min-height: 100vh;
        margin: 0;
        display: grid;
        place-items: center;
        background: #07070c;
        color: #f5f3ff;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      main {
        width: min(520px, calc(100vw - 40px));
        border: 1px solid rgba(255,255,255,.14);
        border-radius: 14px;
        padding: 28px;
        background: rgba(18,17,28,.92);
        text-align: center;
      }
      a { color: #38e6ae; }
    </style>
  </head>
  <body>
    <main>
      <h1>${ok ? 'Spotify 已连接' : 'Spotify 连接失败'}</h1>
      <p>${String(message).replace(/[<>&"]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[char])}</p>
      <p>正在回到 Codio...</p>
      <a href="${redirectTo}">立即返回</a>
    </main>
    <script>setTimeout(() => location.replace(${JSON.stringify(redirectTo)}), 500);</script>
  </body>
</html>`);
}

function splitArtistNames(artist = '') {
  return String(artist)
    .split(/\s*(?:,|、|&| and | feat\.| ft\.)\s*/i)
    .map((item) => item.trim())
    .filter(Boolean);
}

function topCounts(items = [], limit = 10) {
  const counts = new Map();
  for (const item of items.filter(Boolean)) counts.set(item, (counts.get(item) || 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

function buildTasteTags({ preferences = {}, recentArtists = [], importedArtists = [] } = {}) {
  const haystack = [...recentArtists, ...importedArtists].join(' ');
  const tags = [
    ...(preferences.favoriteGenres || []),
    /周杰伦|Jay Chou|林俊杰|JJ Lin|方大同|Khalil|陶喆|David Tao|蔡健雅|Tanya/i.test(haystack) ? '华语 R&B' : '',
    /陈奕迅|Eason|张敬轩|Hins|周柏豪|Pakho|Gareth/i.test(haystack) ? '粤语情绪' : '',
    /keshi|Joji|Frank Ocean|Daniel Caesar|SZA|The Weeknd|Post Malone/i.test(haystack) ? '英文夜色' : '',
    /落日飞车|Sunset Rollercoaster|椅子乐团|The Chairs|City Pop/i.test(haystack) ? 'City Pop' : '',
    /宋冬野|赵雷|陈粒|房东的猫|Bon Iver|Novo Amor/i.test(haystack) ? '民谣' : '',
    /宇多田|Utada|Vaundy|藤井風|Mariya Takeuchi/i.test(haystack) ? 'J-Pop' : '',
    '深夜电台',
    '温柔男声'
  ].filter(Boolean);
  return [...new Set(tags)].slice(0, 12);
}

async function getProfilePayload() {
  const state = await getState();
  const importedTaste = await getImportedTasteProfile();
  const recentPlays = state.plays.slice(-60);
  const recentSongs = recentPlays.slice(-8).reverse().map((play) => play.song).filter(Boolean);
  const recentArtists = topCounts(recentPlays.flatMap((play) => splitArtistNames(play.song?.artist)), 8);
  const likedArtists = topCounts((state.likes || []).flatMap((like) => splitArtistNames(like.song?.artist)), 8);
  const importedArtists = (importedTaste.topPrimaryArtists || importedTaste.topArtists || []).slice(0, 12);
  const topArtists = recentArtists.length ? recentArtists : importedArtists.slice(0, 8);
  const tags = buildTasteTags({
    preferences: state.preferences,
    recentArtists: topArtists.map((item) => item.name),
    importedArtists: importedArtists.map((item) => item.name)
  });

  return {
    name: state.persona.name || 'Codio',
    status: '一开机我就打碟',
    bio: [
      'som1ove 的私人 DJ，会打碟的 taste.md',
      'Your mood is my prompt.',
      'I hate algorithm. I have taste.'
    ],
    stats: {
      onAir: '24/7',
      genres: tags.length,
      listener: 1,
      importedTracks: importedTaste.totalTracks || 0,
      recentPlays: recentPlays.length,
      likes: (state.likes || []).length
    },
    tags,
    topArtists,
    likedArtists,
    recentSongs,
    importedAt: importedTaste.importedAt,
    source: importedTaste.source
  };
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const safePath = path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(publicDir, safePath === '/' ? 'index.html' : safePath);
  const ext = path.extname(filePath);

  try {
    const data = await fs.readFile(filePath);
    res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  } catch {
    const index = await fs.readFile(path.join(publicDir, 'index.html'));
    res.writeHead(200, { 'Content-Type': mime['.html'], 'Cache-Control': 'no-cache' });
    res.end(index);
  }
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && url.pathname === '/api/state') return send(res, 200, await getState());

  if (req.method === 'GET' && url.pathname === '/api/now') {
    const state = await getState();
    return send(res, 200, {
      now: state.plays.at(-1)?.song || null,
      queue: [],
      weather: await getWeather(state.preferences.city),
      calendar: await getCalendarContext(),
      preferences: state.preferences
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/taste') {
    const state = await getState();
    return send(res, 200, { preferences: state.preferences, persona: state.persona });
  }

  if (req.method === 'GET' && url.pathname === '/api/profile') {
    return send(res, 200, await getProfilePayload());
  }

  if (req.method === 'POST' && url.pathname === '/api/taste/spotify') {
    const body = await readBody(req);
    const playlist = body.playlist || body.url || body.id;
    if (!playlist) return send(res, 400, { error: 'playlist is required' });
    const payload = await importSpotifyPlaylist(playlist);
    return send(res, 200, { playlistId: payload.playlistId, tracks: toTasteTracks(payload) });
  }

  if (req.method === 'GET' && url.pathname === '/api/search') {
    return send(res, 200, { songs: await searchSongs(url.searchParams.get('q') || '') });
  }

  if (req.method === 'GET' && url.pathname === '/api/next') {
    const songs = await searchSongs(url.searchParams.get('mood') || '今日推荐');
    const playableSongs = await getPlayableSongs(songs);
    const song = playableSongs[0] || await getSongUrl(songs[0]);
    return send(res, 200, { song, songs: playableSongs.length ? playableSongs : songs });
  }

  if (req.method === 'GET' && url.pathname === '/api/weather') return send(res, 200, await getWeather());

  if (req.method === 'GET' && url.pathname === '/api/calendar') return send(res, 200, await getCalendarContext());

  if (req.method === 'GET' && url.pathname === '/api/plan/today') {
    return send(res, 200, await getTodayPlanWithSongs());
  }

  if (req.method === 'POST' && url.pathname === '/api/plan/today') {
    await getOrCreateDailyPlan({ force: true });
    return send(res, 200, await getTodayPlanWithSongs());
  }

  if (req.method === 'POST' && url.pathname === '/api/queue/refresh') {
    return send(res, 200, await refreshTodayQueue());
  }

  if (req.method === 'POST' && url.pathname === '/api/radio/tick') {
    const body = await readBody(req);
    const result = await radioTick({
      force: Boolean(body.force),
      isPlaying: Boolean(body.isPlaying),
      currentSong: body.currentSong || null
    });
    return send(res, 200, result);
  }

  if (req.method === 'GET' && url.pathname === '/api/integrations') {
    await ensureNeteaseService();
    return send(res, 200, { ...getMusicSourceStatus(), neteaseService: getNeteaseServiceStatus(), spotifyAuth: await getSpotifyAuthStatus() });
  }

  if (req.method === 'GET' && url.pathname === '/api/spotify/status') {
    return send(res, 200, await getSpotifyAuthStatus());
  }

  if (req.method === 'GET' && url.pathname === '/api/spotify/token') {
    const token = await getSpotifyUserToken();
    if (!token) return send(res, 401, { error: 'Spotify is not connected.' });
    return send(res, 200, { accessToken: token });
  }

  if (req.method === 'POST' && url.pathname === '/api/spotify/play') {
    const body = await readBody(req);
    return send(res, 200, await playSpotifyUri({ uri: body.uri, deviceId: body.deviceId }));
  }

  if (req.method === 'POST' && url.pathname === '/api/preferences') {
    const body = await readBody(req);
    return send(res, 200, { preferences: await updatePreferences(body.preferences || {}) });
  }

  if (req.method === 'GET' && url.pathname === '/api/schedules') {
    const state = await getState();
    return send(res, 200, { schedules: state.schedules });
  }

  if (req.method === 'POST' && url.pathname === '/api/schedules') {
    const body = await readBody(req);
    return send(res, 200, { schedule: await addSchedule(body.time, body.prompt) });
  }

  if (req.method === 'POST' && url.pathname === '/api/play') {
    const body = await readBody(req);
    const song = await getSongUrl(body.song);
    const state = await getState();
    const weather = await getWeather(state.preferences.city);
    const introText = await generateHostIntro({
      segment: {
        id: 'manual-queue',
        title: '手动切歌',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        mood: body.reason || '手动播放',
        reason: body.reason || '你刚刚在队列里切到了这首歌'
      },
      song,
      weather,
      preferences: state.preferences,
      recentPlays: state.plays.slice(-10)
    });
    await addPlay(song, body.reason || '手动播放');
    const events = [
      ...await buildHostIntroEvents(introText),
      { type: 'play', song }
    ];
    return send(res, 200, { song, events });
  }

  if (req.method === 'POST' && url.pathname === '/api/likes/toggle') {
    const body = await readBody(req);
    return send(res, 200, await toggleLike(body.song));
  }

  if (req.method === 'POST' && url.pathname === '/api/dislikes/toggle') {
    const body = await readBody(req);
    return send(res, 200, await toggleDislike(body.song));
  }

  if (req.method === 'POST' && url.pathname === '/api/command') {
    const body = await readBody(req);
    const result = await routeCommand(body.text || '');
    return send(res, 200, result);
  }

  if (req.method === 'POST' && url.pathname === '/api/chat') {
    const body = await readBody(req);
    const result = await routeCommand(body.text || body.message || '');
    return send(res, 200, result);
  }

  return send(res, 404, { error: 'Not found' });
}

async function streamNetease(req, res, id) {
  const info = await getNeteaseSongStreamInfo(id);
  if (!info.url) return send(res, 404, { error: 'NetEase did not return a playable URL.' });

  const upstream = await fetch(info.url, {
    headers: {
      Referer: 'https://music.163.com/',
      'User-Agent': 'Mozilla/5.0 CodioAI/1.0',
      ...(req.headers.range ? { Range: req.headers.range } : {})
    }
  });

  if (!upstream.ok && upstream.status !== 206) {
    return send(res, upstream.status, { error: `NetEase stream failed: ${upstream.status}` });
  }

  const headers = {
    'Content-Type': upstream.headers.get('content-type') || 'audio/mpeg',
    'Accept-Ranges': upstream.headers.get('accept-ranges') || 'bytes',
    'Cache-Control': 'no-store'
  };
  for (const key of ['content-length', 'content-range']) {
    const value = upstream.headers.get(key);
    if (value) headers[key.replace(/\b\w/g, (char) => char.toUpperCase())] = value;
  }

  res.writeHead(upstream.status, headers);
  if (upstream.body) Readable.fromWeb(upstream.body).pipe(res);
  else res.end();
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === 'GET' && url.pathname === '/auth/spotify/login') {
    createSpotifyLoginUrl()
      .then((location) => {
        res.writeHead(302, { Location: location });
        res.end();
      })
      .catch((error) => send(res, 500, { error: error.message }));
    return;
  }
  if (req.method === 'GET' && url.pathname === '/callback') {
    handleSpotifyCallback({ code: url.searchParams.get('code'), state: url.searchParams.get('state') })
      .then(async () => {
        await updatePreferences({ musicSource: 'spotify' });
        sendSpotifyCallbackPage(res, 200, '已授权 Codio 使用 Spotify 播放器。');
      })
      .catch((error) => sendSpotifyCallbackPage(res, 500, error.message));
    return;
  }

  const streamMatch = url.pathname.match(/^\/api\/stream\/netease\/([^/]+)$/);
  if (req.method === 'GET' && streamMatch) {
    streamNetease(req, res, decodeURIComponent(streamMatch[1])).catch((error) => send(res, 500, { error: error.message }));
    return;
  }

  const handler = req.url.startsWith('/api/') ? handleApi : serveStatic;
  handler(req, res).catch((error) => send(res, 500, { error: error.message }));
});

function maybeStartSpotifyCallbackServer() {
  const redirect = new URL(config.spotify.redirectUri);
  const redirectPort = Number(redirect.port || (redirect.protocol === 'https:' ? 443 : 80));
  if (!redirectPort || redirectPort === config.port) return;

  const callbackServer = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === 'GET' && url.pathname === redirect.pathname) {
      handleSpotifyCallback({ code: url.searchParams.get('code'), state: url.searchParams.get('state') })
        .then(async () => {
          await updatePreferences({ musicSource: 'spotify' });
          sendSpotifyCallbackPage(res, 200, '已授权 Codio 使用 Spotify 播放器。');
        })
        .catch((error) => sendSpotifyCallbackPage(res, 500, error.message));
      return;
    }
    send(res, 404, 'Spotify callback server only handles /callback.');
  });

  callbackServer.listen(redirectPort, redirect.hostname || config.host, () => {
    console.log(`Spotify callback listening at ${config.spotify.redirectUri}`);
  });
}

const hub = createWebSocketHub(server, async (message) => {
  if (message.type === 'command') {
    const result = await routeCommand(message.text || '');
    hub.broadcast({ type: 'command-result', result });
  }
});

await ensureNeteaseService();
startScheduler({ broadcast: hub.broadcast, runCommand: routeCommand });

server.listen(config.port, config.host, () => {
  console.log(`AI Music Assistant running at http://${config.host}:${config.port}`);
  const netease = getNeteaseServiceStatus();
  console.log(`NetEase API ${netease.running ? 'ready' : 'not ready'} at ${netease.baseUrl}`);
  maybeStartSpotifyCallbackServer();
});
