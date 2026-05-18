import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';

const tokenPath = path.join(config.root, 'data', 'spotify-token.json');
let pendingVerifier = '';
let pendingState = '';

function base64Url(buffer) {
  return Buffer.from(buffer)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

async function sha256(value) {
  return crypto.createHash('sha256').update(value).digest();
}

async function readToken() {
  try {
    return JSON.parse(await fs.readFile(tokenPath, 'utf8'));
  } catch {
    return null;
  }
}

async function writeToken(token) {
  await fs.mkdir(path.dirname(tokenPath), { recursive: true });
  await fs.writeFile(tokenPath, JSON.stringify(token, null, 2));
}

async function exchangeToken(body) {
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body)
  });

  if (!response.ok) throw new Error(`Spotify token exchange failed: ${response.status}`);
  const data = await response.json();
  return {
    ...data,
    expiresAt: Date.now() + Math.max(30, data.expires_in - 60) * 1000
  };
}

export async function createSpotifyLoginUrl() {
  if (!config.spotify.clientId) throw new Error('SPOTIFY_CLIENT_ID is not configured.');

  pendingVerifier = base64Url(crypto.randomBytes(64));
  pendingState = base64Url(crypto.randomBytes(18));
  const challenge = base64Url(await sha256(pendingVerifier));
  const url = new URL('https://accounts.spotify.com/authorize');
  url.searchParams.set('client_id', config.spotify.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', config.spotify.redirectUri);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('state', pendingState);
  url.searchParams.set('scope', [
    'streaming',
    'user-read-email',
    'user-read-private',
    'user-read-playback-state',
    'user-modify-playback-state'
  ].join(' '));
  return url.toString();
}

export async function handleSpotifyCallback({ code, state }) {
  if (!code) throw new Error('Missing Spotify authorization code.');
  if (!pendingVerifier || state !== pendingState) throw new Error('Spotify login state did not match. Please try again.');

  const token = await exchangeToken({
    client_id: config.spotify.clientId,
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.spotify.redirectUri,
    code_verifier: pendingVerifier
  });
  pendingVerifier = '';
  pendingState = '';
  await writeToken(token);
  return token;
}

export async function getSpotifyUserToken() {
  const token = await readToken();
  if (!token) return null;
  if (Date.now() < token.expiresAt) return token.access_token;
  if (!token.refresh_token) return null;

  const refreshed = await exchangeToken({
    client_id: config.spotify.clientId,
    grant_type: 'refresh_token',
    refresh_token: token.refresh_token
  });
  const next = { ...token, ...refreshed, refresh_token: refreshed.refresh_token || token.refresh_token };
  await writeToken(next);
  return next.access_token;
}

export async function getSpotifyAuthStatus() {
  const token = await readToken();
  return {
    configured: Boolean(config.spotify.clientId),
    redirectUri: config.spotify.redirectUri,
    connected: Boolean(token?.access_token),
    expiresAt: token?.expiresAt || null
  };
}

export async function playSpotifyUri({ uri, deviceId }) {
  if (!uri) throw new Error('Missing Spotify URI.');
  const token = await getSpotifyUserToken();
  if (!token) throw new Error('Spotify is not connected.');

  const url = new URL('https://api.spotify.com/v1/me/player/play');
  if (deviceId) url.searchParams.set('device_id', deviceId);
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ uris: [uri] })
  });

  if (!response.ok && response.status !== 204) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Spotify playback failed: ${response.status} ${detail}`);
  }
  return { ok: true };
}
