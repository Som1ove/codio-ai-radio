import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const envPath = path.join(root, '.env');

if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

export const config = {
  root,
  port: Number(process.env.PORT || 8080),
  host: process.env.HOST || '127.0.0.1',
  llm: {
    apiKey: process.env.LLM_API_KEY || '',
    baseUrl: (process.env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
    model: process.env.LLM_MODEL || 'gpt-4o-mini'
  },
  netease: {
    baseUrl: (process.env.NETEASE_API_BASE || 'http://127.0.0.1:3003').replace(/\/$/, ''),
    autoStart: process.env.NETEASE_AUTO_START !== 'false'
  },
  spotify: {
    clientId: process.env.SPOTIFY_CLIENT_ID || '',
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET || '',
    redirectUri: process.env.SPOTIFY_REDIRECT_URI || `http://${process.env.HOST || '127.0.0.1'}:${process.env.PORT || 3000}/callback`,
    market: process.env.SPOTIFY_MARKET || 'US'
  },
  music: {
    source: process.env.MUSIC_SOURCE || 'netease'
  },
  tts: {
    provider: process.env.TTS_PROVIDER || 'auto'
  },
  fish: {
    apiKey: process.env.FISH_AUDIO_API_KEY || '',
    voiceId: process.env.FISH_AUDIO_VOICE_ID || ''
  },
  xiaomi: {
    ttsEndpoint: process.env.XIAOMI_TTS_ENDPOINT || 'https://api.xiaomimimo.com/v1',
    apiKey: process.env.XIAOMI_TTS_API_KEY || '',
    voice: process.env.XIAOMI_TTS_VOICE || '',
    model: process.env.XIAOMI_TTS_MODEL || 'mimo-v2-tts'
  },
  feishu: {
    appId: process.env.FEISHU_APP_ID || '',
    appSecret: process.env.FEISHU_APP_SECRET || '',
    userAccessToken: process.env.FEISHU_USER_ACCESS_TOKEN || '',
    calendarId: process.env.FEISHU_CALENDAR_ID || 'primary'
  },
  weather: {
    apiKey: process.env.OPENWEATHER_API_KEY || '',
    city: process.env.WEATHER_CITY || 'New York',
    units: process.env.WEATHER_UNITS || 'imperial'
  }
};
