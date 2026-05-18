# Codio AI 电台

Codio 是一个本地优先的中文 AI 音乐电台：PWA 播放器运行在 localhost，Node.js 本地服务负责路由、记忆、音乐源、天气、日程、TTS 和 AI 主播逻辑。

## 快速运行

```bash
npm install
npm start
```

默认地址是 `http://127.0.0.1:8080`。如果端口被占用：

```bash
PORT=8081 npm start
```

## 当前能力

- 播放器：Spotify Web Playback SDK、上一首/下一首、进度条、音量、喜欢/不喜欢、队列刷新、Card/Profile 视图。
- AI 主播：中文对话、意图分流、分段旁白、歌曲介绍、深夜电台式聊天、同一首歌播放中不重复重启。
- 个性化：读取 `user/taste.md`、`user/routines.md`、`user/mood-rules.md`、Spotify 导入缓存和本地播放/收藏/不喜欢记录。
- 音乐源：Spotify 为推荐主播放源；网易云作为可选中文搜索/歌词/备用播放源；demo mp3 只做兜底。
- 语音：小米 MiMo、Fish Audio 或浏览器内置语音，按 `.env` 配置自动选择。
- 外部上下文：OpenWeather 优先，Open-Meteo 免 key 兜底；飞书日程未配置时使用本地 schedule。

## 文档

- [架构说明](docs/architecture.md)
- [API 合约](docs/api.md)
- [运行手册](docs/runbook.md)
- [AI 接手规则](AGENTS.md)

## 环境变量

复制 `.env.example` 为 `.env`，按需要配置：

```env
PORT=8080
HOST=127.0.0.1
LLM_API_KEY=
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini
MUSIC_SOURCE=spotify
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=
SPOTIFY_REDIRECT_URI=http://127.0.0.1:8888/callback
SPOTIFY_MARKET=US
NETEASE_API_BASE=http://127.0.0.1:3003
TTS_PROVIDER=auto
XIAOMI_TTS_API_KEY=
FISH_AUDIO_API_KEY=
OPENWEATHER_API_KEY=
WEATHER_CITY=
```

不要把 `.env`、`data/spotify-token.json` 或任何 API key 提交到仓库。

## Spotify 授权

1. 启动本地服务。
2. 打开 Codio 页面并点击 `LOGIN`。
3. 完成 Spotify 授权后会自动回到 Codio。
4. 网页内完整播放需要 Spotify Premium；无 Premium 时可搜索但无法完整播放。

## 导入 Spotify 品味

导入 Spotify 歌单：

```bash
npm run import:spotify -- https://open.spotify.com/playlist/<playlist_id>
```

导入 Spotify Library CSV：

```bash
npm run import:spotify-library -- "/path/to/My Spotify Library.csv"
```

导入结果写入本地 `user/imports/`，`server/context.js` 和 `server/taste.js` 会把这些数据作为长期品味样本。这个目录包含个人听歌数据，默认不提交到 GitHub。

## 常用脚本

```bash
npm start
npm run netease
npm run import:spotify -- <playlist-url>
npm run import:spotify-library -- <csv-path>
node --check server/index.js
node --check public/app.js
```
