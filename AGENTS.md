# AGENTS.md

## 项目边界

- 这是本地优先 PWA + Node.js 服务，不引入前端框架，现有前端入口是 `public/index.html`、`public/styles.css`、`public/app.js`。
- 主服务入口是 `server/index.js`；不要改回根目录旧 `server.js` 作为运行入口。
- 真实状态写入 `data/state.db`，它是 JSON 文件，不是 SQLite。不要把密钥、token 或播放历史提交到仓库。
- `.env` 只在本地使用；文档只写变量名，不写用户实际 key。

## 关键模块

- `server/router.js`：把用户中文指令拆成 say/play/recommend/weather/remember/schedule 等动作，并用本地规则兜底。
- `server/context.js`：把 persona、用户资料、天气、日程、品味导入、播放历史组合成 LLM 上下文。
- `server/claude.js`：OpenAI-compatible chat completions 适配器，同时生成主播旁白。
- `server/curator.js`：每日电台计划、时段歌单、自动 chatter 和 Host 模式。
- `server/music.js`：Spotify / NetEase / demo 搜索和可播放性解析。
- `server/spotifyAuth.js`：Spotify PKCE 登录、token 持久化和 Web Playback SDK 播放控制。
- `server/tts.js`：小米 MiMo、Fish Audio、浏览器语音 fallback。
- `server/state.js`：messages、plays、likes、dislikes、plans、preferences、schedules。

## 播放规则

- Spotify 是国外使用场景的主播放源。完整网页内播放依赖 Spotify Web Playback SDK 和 Premium。
- 网易云只作为可选源；地区/VIP 限制会导致很多歌曲拿不到直链。
- 不要重新加入“外部平台打开”作为主流程。用户目标是在 Codio 内听到。
- 播放事件到达时，如果同一首歌已经播放超过 1.5 秒，前端会同步 UI 而不重启歌曲。

## 主播规则

- Codio 是 24 小时在线 AI 电台主播，不是普通搜索框。
- 用户请求“轻音乐、民谣、摇滚、日本爵士、英文歌”等风格时，不能直接把整句当 Spotify 搜索词；必须先走 `router.js` 的语言/风格/艺人意图解析。
- 点 Host 或自动电台时，旁白应分段播放；切歌或强制 Host 前必须取消旧旁白，避免多段 TTS 重叠。
- 用户问“介绍一下自己”时必须回答自我介绍；如果同句还要求推荐歌曲，先介绍再推荐。

## UI 规则

- 保持 Codio 的黑色电台感、像素字、柔和绿色 accent 和 Card/Profile 双视图。
- 用户聊天头像来自 `public/assets/user-avatar.png`；Codio 头像来自 `public/assets/codio-avatar.jpeg`。
- 聊天气泡里 Codio 头像可点击打开 profile。
- 不要恢复顶部 HOME/XHS/MUSIC/VIDEO 导航，也不要恢复底部“今日电台”大面板。

## 验证

- 修改前端脚本后运行 `node --check public/app.js`。
- 修改服务端脚本后运行 `node --check server/<file>.js`，必要时对相关文件一起检查。
- 改 PWA 静态资源时更新 `public/sw.js` 的 cache 名称或资源列表，避免旧 UI 缓存。
