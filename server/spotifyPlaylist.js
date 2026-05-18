import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';

const tokenCache = {
  value: '',
  expiresAt: 0
};

export function getSpotifyPlaylistId(value = '') {
  return String(value).match(/playlist\/([A-Za-z0-9]+)/)?.[1] || String(value).trim();
}

function getImportPath(playlistId) {
  return path.join(config.root, 'user', 'imports', `spotify-${playlistId}.json`);
}

async function readCachedPlaylist(playlistId) {
  try {
    return JSON.parse(await fs.readFile(getImportPath(playlistId), 'utf8'));
  } catch {
    return null;
  }
}

async function getSpotifyAppToken() {
  if (tokenCache.value && Date.now() < tokenCache.expiresAt) return tokenCache.value;
  if (!config.spotify.clientId || !config.spotify.clientSecret) {
    throw new Error('Spotify client id/secret are not configured.');
  }

  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.spotify.clientId}:${config.spotify.clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' })
  });
  if (!response.ok) throw new Error(`Spotify token failed: ${response.status}`);

  const data = await response.json();
  tokenCache.value = data.access_token;
  tokenCache.expiresAt = Date.now() + Math.max(30, Number(data.expires_in || 3600) - 60) * 1000;
  return tokenCache.value;
}

async function fetchSpotifyJson(url, token) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Spotify playlist tracks failed: ${response.status}`);
  return response.json();
}

function normalizeTrack(track) {
  const artists = (track.artists || []).map((artist) => artist.name).filter(Boolean);
  return {
    song: track.name || '',
    artist: artists.join(', ') || '未知艺人',
    spotifyId: track.id || '',
    album: track.album?.name || '',
    url: track.external_urls?.spotify || ''
  };
}

export function toTasteTracks(payload) {
  return (payload?.tracks || []).map((track) => ({
    song: track.song || track.title || '',
    artist: Array.isArray(track.artists) ? track.artists.join(', ') : track.artist || ''
  })).filter((track) => track.song && track.artist);
}

export async function fetchSpotifyPlaylistTracks(playlistUrlOrId, { market = config.spotify.market } = {}) {
  const playlistId = getSpotifyPlaylistId(playlistUrlOrId);
  const token = await getSpotifyAppToken();
  let url = new URL(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`);
  url.searchParams.set('market', market);
  url.searchParams.set('limit', '100');
  url.searchParams.set('fields', 'items(track(id,name,artists(name),album(name),external_urls(spotify))),next,total');

  const tracks = [];
  let total = 0;
  while (url) {
    const data = await fetchSpotifyJson(url.toString(), token);
    total = data.total || total;
    for (const item of data.items || []) {
      if (item.track) tracks.push(normalizeTrack(item.track));
    }
    url = data.next ? new URL(data.next) : null;
  }

  return {
    playlistId,
    url: `https://open.spotify.com/playlist/${playlistId}`,
    total,
    importedAt: new Date().toISOString(),
    tracks
  };
}

export async function importSpotifyPlaylist(playlistUrlOrId, options = {}) {
  const payload = await fetchSpotifyPlaylistTracks(playlistUrlOrId, options);
  const outPath = getImportPath(payload.playlistId);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(payload, null, 2));
  return payload;
}

export async function getSpotifyTasteTracks(playlistUrlOrId, options = {}) {
  const playlistId = getSpotifyPlaylistId(playlistUrlOrId);
  if (options.refresh) {
    return toTasteTracks(await importSpotifyPlaylist(playlistId, options));
  }

  const cached = await readCachedPlaylist(playlistId);
  if (cached?.tracks?.length) return toTasteTracks(cached);

  try {
    return toTasteTracks(await importSpotifyPlaylist(playlistId, options));
  } catch {
    return [];
  }
}
