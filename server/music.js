import { config } from './config.js';
import { getSpotifyUserToken } from './spotifyAuth.js';

const demoSongs = [
  {
    id: 'demo-1',
    title: 'Midnight City',
    artist: 'M83',
    album: "Hurry Up, We're Dreaming",
    cover: '',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
    externalUrl: '',
    source: 'demo'
  },
  {
    id: 'demo-2',
    title: 'A Moment Apart',
    artist: 'ODESZA',
    album: 'A Moment Apart',
    cover: '',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3',
    externalUrl: '',
    source: 'demo'
  },
  {
    id: 'demo-3',
    title: 'Weightless',
    artist: 'Marconi Union',
    album: 'Weightless',
    cover: '',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3',
    externalUrl: '',
    source: 'demo'
  },
  {
    id: 'demo-4',
    title: 'Soft Signal',
    artist: 'Local Radio',
    album: 'Codio Demo Set',
    cover: '',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3',
    externalUrl: '',
    source: 'demo'
  },
  {
    id: 'demo-5',
    title: 'Quiet Window',
    artist: 'Local Radio',
    album: 'Codio Demo Set',
    cover: '',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3',
    externalUrl: '',
    source: 'demo'
  },
  {
    id: 'demo-6',
    title: 'Late Walk',
    artist: 'Local Radio',
    album: 'Codio Demo Set',
    cover: '',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-6.mp3',
    externalUrl: '',
    source: 'demo'
  },
  {
    id: 'demo-7',
    title: 'After Rain',
    artist: 'Local Radio',
    album: 'Codio Demo Set',
    cover: '',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-7.mp3',
    externalUrl: '',
    source: 'demo'
  },
  {
    id: 'demo-8',
    title: 'Small Hours',
    artist: 'Local Radio',
    album: 'Codio Demo Set',
    cover: '',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3',
    externalUrl: '',
    source: 'demo'
  },
  {
    id: 'demo-9',
    title: 'Low Light',
    artist: 'Local Radio',
    album: 'Codio Demo Set',
    cover: '',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-9.mp3',
    externalUrl: '',
    source: 'demo'
  },
  {
    id: 'demo-10',
    title: 'Calm Return',
    artist: 'Local Radio',
    album: 'Codio Demo Set',
    cover: '',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-10.mp3',
    externalUrl: '',
    source: 'demo'
  }
];

let spotifyToken;
let spotifyTokenExpiresAt = 0;

function normalizeNeteaseSong(song) {
  return {
    id: String(song.id),
    title: song.name,
    artist: song.artists?.map((a) => a.name).join(', ') || song.ar?.map((a) => a.name).join(', ') || '未知艺人',
    album: song.album?.name || song.al?.name || '',
    cover: song.album?.picUrl || song.al?.picUrl || '',
    externalUrl: `https://music.163.com/#/song?id=${song.id}`,
    source: 'netease'
  };
}

function normalizeSpotifyTrack(track) {
  return {
    id: track.id,
    title: track.name,
    artist: track.artists?.map((artist) => artist.name).join(', ') || '未知艺人',
    album: track.album?.name || '',
    cover: track.album?.images?.[0]?.url || '',
    url: track.preview_url || '',
    externalUrl: track.external_urls?.spotify || '',
    uri: track.uri,
    source: 'spotify',
    playable: Boolean(track.preview_url)
  };
}

async function getNeteaseJson(path, params = {}) {
  if (!config.netease.baseUrl) throw new Error('NETEASE_API_BASE is not configured.');
  const url = new URL(`${config.netease.baseUrl}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`NetEase API failed: ${response.status}`);
  return response.json();
}

async function getSpotifyToken() {
  const userToken = await getSpotifyUserToken();
  if (userToken) return userToken;

  if (!config.spotify.clientId || !config.spotify.clientSecret) {
    throw new Error('Spotify credentials are not configured.');
  }
  if (spotifyToken && Date.now() < spotifyTokenExpiresAt) return spotifyToken;

  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.spotify.clientId}:${config.spotify.clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' })
  });

  if (!response.ok) throw new Error(`Spotify token request failed: ${response.status}`);
  const data = await response.json();
  spotifyToken = data.access_token;
  spotifyTokenExpiresAt = Date.now() + Math.max(30, data.expires_in - 60) * 1000;
  return spotifyToken;
}

async function searchNetease(query, limit = 20) {
  const data = await getNeteaseJson('/search', { keywords: query, limit: String(limit) });
  return (data.result?.songs || []).map(normalizeNeteaseSong);
}

async function searchSpotify(query) {
  const token = await getSpotifyToken();
  const url = new URL('https://api.spotify.com/v1/search');
  url.searchParams.set('q', query);
  url.searchParams.set('type', 'track');
  url.searchParams.set('limit', '10');
  url.searchParams.set('market', config.spotify.market);

  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Spotify search failed: ${response.status}`);
  const data = await response.json();
  return (data.tracks?.items || []).map(normalizeSpotifyTrack);
}

function searchDemo(query) {
  const localMatches = demoSongs.filter((song) => `${song.title} ${song.artist}`.toLowerCase().includes((query || '').toLowerCase()));
  const seedText = String(query || '');
  const seed = [...seedText].reduce((total, char) => total + char.charCodeAt(0), 0);
  const source = localMatches.length ? localMatches : demoSongs;
  const offset = source.length ? seed % source.length : 0;
  return [...source.slice(offset), ...source.slice(0, offset)].slice(0, 10);
}

function rotateByHistory(songs, history) {
  const lastSeen = new Map();
  history.forEach((play, index) => {
    const id = play.song?.id;
    if (id && !lastSeen.has(String(id))) lastSeen.set(String(id), index);
  });
  return [...songs].sort((a, b) => {
    const aSeen = lastSeen.has(String(a.id)) ? lastSeen.get(String(a.id)) : Number.POSITIVE_INFINITY;
    const bSeen = lastSeen.has(String(b.id)) ? lastSeen.get(String(b.id)) : Number.POSITIVE_INFINITY;
    return bSeen - aSeen;
  });
}

export function getMusicSourceStatus() {
  return {
    active: config.music.source,
    spotify: {
      configured: Boolean(config.spotify.clientId),
      clientCredentialsConfigured: Boolean(config.spotify.clientId && config.spotify.clientSecret),
      playback: 'preview_or_external',
      note: '已配置 client_id，可用 Spotify 登录授权；若要无登录搜索，可再配置 client_secret。网页内完整播放需要 Web Playback SDK 和 Premium。'
    },
    netease: {
      configured: Boolean(config.netease.baseUrl),
      playback: 'song_url',
      note: '配置 NETEASE_API_BASE 后可使用搜索、播放链接、歌词等接口。'
    },
    demo: { configured: true, playback: 'mp3_demo' }
  };
}

export async function searchSongs(query, source = config.music.source) {
  if (!query) return searchDemo(query);

  const strictSource = String(source).endsWith('-only') ? String(source).replace(/-only$/, '') : '';
  const allowDemo = !strictSource;
  const sources = strictSource
    ? [strictSource]
    : source === 'auto'
    ? ['netease', 'spotify', 'demo']
    : [source, 'demo'];

  for (const candidate of sources) {
    try {
      if (candidate === 'netease' && config.netease.baseUrl) {
        const songs = await searchNetease(query);
        if (songs.length) return songs;
      }
      if (candidate === 'spotify' && config.spotify.clientId && config.spotify.clientSecret) {
        const songs = await searchSpotify(query);
        if (songs.length) return songs;
      }
      if (candidate === 'demo' && allowDemo) return searchDemo(query);
    } catch {
      // Try the next source.
    }
  }

  return allowDemo ? searchDemo(query) : [];
}

export async function getSongUrl(song) {
  if (!song) return demoSongs[0];
  if (song.url) return song;

  if (song.source === 'spotify') {
    return {
      ...song,
      url: '',
      playbackNote: song.uri
        ? 'Spotify Web Playback SDK 会在 Codio 页面内播放这首歌。'
        : 'Spotify 此曲目没有可用 URI。'
    };
  }

  if (song.source === 'netease' && config.netease.baseUrl) {
    const info = await getNeteaseSongStreamInfo(song.id).catch(() => null);
    return {
      ...song,
      rawUrl: info?.url || '',
      url: info?.url ? `/api/stream/netease/${encodeURIComponent(song.id)}` : '',
      playbackNote: info?.url ? '' : '网易云未返回可播放链接，我会自动换一首能在应用内播放的歌。'
    };
  }

  return { ...demoSongs[0], ...song, url: song.url || demoSongs[0].url };
}

export async function getNeteaseSongStreamInfo(id) {
  const data = await getNeteaseJson('/song/url/v1', { id, level: 'standard' }).catch(() => getNeteaseJson('/song/url', { id }));
  const item = data.data?.[0] || {};
  return {
    id: String(id),
    url: item.url || '',
    type: item.type || 'mp3',
    size: item.size || null,
    br: item.br || null
  };
}

export async function getPlayableSongs(songs = []) {
  const playable = [];
  for (const song of songs) {
    const resolved = await getSongUrl(song);
    if (resolved.url || (resolved.source === 'spotify' && resolved.uri)) playable.push(resolved);
  }
  return playable;
}

export async function getLyrics(songId) {
  if (!config.netease.baseUrl || String(songId).startsWith('demo')) return { lyric: '', source: 'fallback' };
  const data = await getNeteaseJson('/lyric', { id: songId });
  return { lyric: data.lrc?.lyric || '', source: 'netease' };
}

export async function recommendSongs({ mood = '', history = [], preferences = {} } = {}) {
  const favorite = mood || preferences.favoriteArtists?.[0] || preferences.favoriteGenres?.[0] || 'chill';
  const results = await searchSongs(favorite, preferences.musicSource || config.music.source);
  const playedIds = new Set(history.map((play) => String(play.song?.id)));
  const candidates = results.length ? results : demoSongs;
  const fresh = candidates.filter((song) => !playedIds.has(String(song.id)));
  return rotateByHistory(fresh.length ? fresh : candidates, history).slice(0, 8);
}
