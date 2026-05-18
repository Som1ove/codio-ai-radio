# Codio Runbook

## Start

```bash
npm install
npm start
```

Open `http://127.0.0.1:8080`.

If the port is occupied:

```bash
PORT=8081 npm start
```

## Required Local Files

- `.env` for credentials and provider choices
- `data/state.db` for local state
- `data/spotify-token.json` after Spotify login
- `user/imports/*.json` for imported taste, kept local and ignored by Git

Do not commit `.env`, `data/state.db`, `data/spotify-token.json` or user-specific secret material.

## Environment Variables

| Variable | Purpose |
| --- | --- |
| `PORT` / `HOST` | Local server bind address |
| `LLM_API_KEY` | OpenAI-compatible LLM key |
| `LLM_BASE_URL` | Chat completions base URL |
| `LLM_MODEL` | Chat model name |
| `MUSIC_SOURCE` | `spotify`, `netease`, `auto` or `demo` |
| `SPOTIFY_CLIENT_ID` | Spotify app client id |
| `SPOTIFY_CLIENT_SECRET` | Spotify app secret for search/import |
| `SPOTIFY_REDIRECT_URI` | Spotify callback, commonly `http://127.0.0.1:8888/callback` |
| `SPOTIFY_MARKET` | Search market, commonly `US` |
| `NETEASE_API_BASE` | NetEaseCloudMusicApi-compatible base URL |
| `NETEASE_AUTO_START` | Whether local NetEase service auto-starts |
| `TTS_PROVIDER` | `auto`, `xiaomi`, `fish` or browser fallback behavior |
| `XIAOMI_TTS_API_KEY` | Xiaomi MiMo key |
| `XIAOMI_TTS_ENDPOINT` | Xiaomi OpenAI-compatible endpoint |
| `FISH_AUDIO_API_KEY` / `FISH_AUDIO_VOICE_ID` | Fish Audio credentials |
| `FEISHU_USER_ACCESS_TOKEN` | Feishu user token for calendar reads |
| `FEISHU_CALENDAR_ID` | Calendar id, default `primary` |
| `OPENWEATHER_API_KEY` | Optional OpenWeather key |
| `WEATHER_CITY` | Optional weather city override |
| `WEATHER_UNITS` | `metric` or `imperial` |

## Spotify Playback Checklist

1. Confirm `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` and `SPOTIFY_REDIRECT_URI` are set.
2. Start Codio.
3. Click `LOGIN` in the app.
4. Confirm `/api/spotify/status` returns `connected: true`.
5. Keep the Codio tab open so the Spotify Web Playback SDK device remains active.
6. Use a Spotify Premium account for full in-browser playback.

If playback silently fails, check:

- Browser console for Spotify SDK account/auth errors.
- `/api/spotify/token` for 401 responses.
- Whether another Spotify device stole playback.
- Whether the selected track has a Spotify URI.

## NetEase Checklist

Run the bundled NetEase service when needed:

```bash
npm run netease
```

Use NetEase as backup. Region restrictions and VIP limitations can prevent direct streams.

## TTS Checklist

- Use `TTS_PROVIDER=xiaomi` with Xiaomi credentials for MiMo voice.
- Use `TTS_PROVIDER=fish` with Fish credentials for Fish Audio.
- Use `TTS_PROVIDER=auto` to try cloud providers and fall back to browser speech.
- Long host intros are split by `server/hostIntro.js`.
- Frontend speech sessions cancel stale voice when switching tracks or forcing Host.

## Weather Checklist

- With `OPENWEATHER_API_KEY`, weather uses OpenWeather.
- Without a key, weather uses Open-Meteo.
- Orlando and Florida aliases are known locally.
- If both providers fail, UI shows fallback weather and radio planning continues.

## Taste Import

Spotify playlist:

```bash
npm run import:spotify -- https://open.spotify.com/playlist/<playlist_id>
```

Spotify library CSV:

```bash
npm run import:spotify-library -- "/absolute/path/My Spotify Library.csv"
```

The imported cache is used for profile tags, artist weighting, discovery filtering and daily radio segment queries.

## Smoke Tests

```bash
node --check server/index.js
node --check server/router.js
node --check server/curator.js
node --check public/app.js
curl http://127.0.0.1:8080/api/integrations
curl http://127.0.0.1:8080/api/weather
```

## Common Fixes

If `npm start` fails with missing `package.json`, run it from the project directory:

```bash
cd "/Users/som1ove/Documents/New project"
npm start
```

If the UI shows old assets, refresh the page after `public/sw.js` cache version changes.

If Codio keeps recommending weak generic tracks, inspect `server/router.js` and `server/curator.js` filters before changing prompts.
