# Codio API

Base URL: `http://127.0.0.1:8080`

All JSON routes return JSON unless noted.

## Core State

`GET /api/state`

Returns full local state: persona, preferences, messages, plays, likes, dislikes, plans and schedules.

`GET /api/now`

Returns current song, weather, calendar and preferences.

`GET /api/profile`

Returns profile card data derived from imported taste, recent plays, likes and preferences.

`POST /api/preferences`

Body:

```json
{ "preferences": { "musicSource": "spotify", "city": "Orlando" } }
```

Updates preference fields.

## Chat And Radio

`POST /api/chat`

Body:

```json
{ "text": "介绍一下自己，并向我推荐一首歌" }
```

Routes the command through `server/router.js` and returns ordered events such as `speech`, `queue`, `play`, `weather`, `memory` and `schedule`.

`POST /api/command`

Compatibility alias for `/api/chat`.

`GET /api/plan/today`

Returns the current daily radio plan and active segment id.

`POST /api/plan/today`

Forces regeneration of the daily radio plan.

`POST /api/queue/refresh`

Refreshes the active segment queue without interrupting the currently playing song.

`POST /api/radio/tick`

Body:

```json
{ "force": true, "isPlaying": true, "currentSong": { "title": "..." } }
```

Runs host/chatter logic and may return speech, queue and play events.

## Music

`GET /api/search?q=<query>`

Searches the active music source.

`GET /api/next?mood=<text>`

Returns one playable candidate plus a short candidate list.

`POST /api/play`

Body:

```json
{ "song": { "source": "spotify", "uri": "spotify:track:..." }, "reason": "手动选择队列歌曲" }
```

Generates a host intro for manual queue selection and returns speech plus play events.

`POST /api/likes/toggle`

Toggles like for a song.

`POST /api/dislikes/toggle`

Toggles dislike for a song, removes any matching like and adds the primary artist to avoid preferences.

`GET /api/stream/netease/:id`

Proxies a NetEase audio URL with range support when NetEase returns a playable stream.

## Spotify

`GET /auth/spotify/login`

Starts Spotify PKCE login.

`GET /callback`

Handles Spotify callback on the app port.

`GET /api/spotify/status`

Returns configured/connected status.

`GET /api/spotify/token`

Returns a user access token for the Spotify Web Playback SDK. This route requires local Spotify authorization.

`POST /api/spotify/play`

Body:

```json
{ "uri": "spotify:track:...", "deviceId": "spotify_sdk_device_id" }
```

Tells Spotify Connect to play the URI on the browser SDK device.

## Taste Import

`POST /api/taste/spotify`

Body:

```json
{ "playlist": "https://open.spotify.com/playlist/..." }
```

Fetches playlist tracks and returns simplified `{ song, artist }` entries.

`GET /api/taste`

Returns persona and preferences.

## External Context

`GET /api/weather`

Returns OpenWeather/Open-Meteo/fallback weather.

`GET /api/calendar`

Returns Feishu events plus local schedules when configured.

`GET /api/integrations`

Returns configured source status for Spotify, NetEase and demo providers.

## WebSocket

`WS /stream`

Accepts:

```json
{ "type": "command", "text": "推荐一点深夜英文歌" }
```

Broadcasts:

```json
{ "type": "command-result", "result": { "events": [] } }
```

`WS /ws` remains as compatibility behavior through the same WebSocket hub.
