const audio = document.querySelector('#audio');
const commandForm = document.querySelector('#commandForm');
const commandInput = document.querySelector('#commandInput');
const socketStatus = document.querySelector('#socketStatus');
const songTitle = document.querySelector('#songTitle');
const songArtist = document.querySelector('#songArtist');
const coverArt = document.querySelector('#coverArt');
const chatLog = document.querySelector('#chatLog');
const queueEl = document.querySelector('#queue');
const refreshQueueBtn = document.querySelector('#refreshQueueBtn');
const aiBlurb = document.querySelector('#aiBlurb');
const weatherEl = document.querySelector('#weather');
const playsEl = document.querySelector('#plays');
const schedulesEl = document.querySelector('#schedules');
const memoryEl = document.querySelector('#memory');
const playPauseBtn = document.querySelector('#playPauseBtn');
const previousBtn = document.querySelector('#previousBtn');
const nextBtn = document.querySelector('#nextBtn');
const progress = document.querySelector('#progress');
const elapsed = document.querySelector('#elapsed');
const duration = document.querySelector('#duration');
const volume = document.querySelector('#volume');
const likeBtn = document.querySelector('#likeBtn');
const dislikeBtn = document.querySelector('#dislikeBtn');
const spotifyLoginBtn = document.querySelector('#spotifyLoginBtn');
const profileBtn = document.querySelector('#profileBtn');
const cardModeBtn = document.querySelector('#cardModeBtn');
const darkModeBtn = document.querySelector('#darkModeBtn');
const lightModeBtn = document.querySelector('#lightModeBtn');
const settingsForm = document.querySelector('#settingsForm');
const sourceStatus = document.querySelector('#sourceStatus');
const neteaseStatus = document.querySelector('#neteaseStatus');
const dailyPlanEl = document.querySelector('#dailyPlan');
const planStatus = document.querySelector('#planStatus');
const hostNowBtn = document.querySelector('#hostNowBtn');
const enterRadioBtn = document.querySelector('#enterRadioBtn');
const episodeMood = document.querySelector('#episodeMood');
const episodeTitle = document.querySelector('#episodeTitle');
const episodeCaption = document.querySelector('#episodeCaption');
const clockTime = document.querySelector('#clockTime');
const clockDay = document.querySelector('#clockDay');
const clockDate = document.querySelector('#clockDate');
const signalBars = [...document.querySelectorAll('.signal-stack span')];
const profileOverlay = document.querySelector('#profileOverlay');
const profileBackBtn = document.querySelector('#profileBackBtn');
const profileCloseBtn = document.querySelector('#profileCloseBtn');
const profileAvatar = document.querySelector('#profileAvatar');
const profileName = document.querySelector('#profileName');
const profileStatus = document.querySelector('#profileStatus');
const profileBio = document.querySelector('#profileBio');
const profileOnAir = document.querySelector('#profileOnAir');
const profileGenres = document.querySelector('#profileGenres');
const profileListener = document.querySelector('#profileListener');
const profileTags = document.querySelector('#profileTags');
const profileArtists = document.querySelector('#profileArtists');
const profileSongs = document.querySelector('#profileSongs');

const CODIO_AVATAR = '/assets/codio-avatar.jpeg';
const USER_AVATAR = '/assets/user-avatar.png';

let socket;
let queue = [];
let history = [];
let currentSong = null;
let currentQueueIndex = -1;
let voiceEnabled = true;
let likedKeys = new Set();
let dislikedKeys = new Set();
let spotifyPlayer = null;
let spotifyDeviceId = '';
let spotifyReady = false;
let spotifyPlaying = false;
let spotifyLastTrackId = '';
let spotifyEndHandledFor = '';
let spotifyWatchTimer = null;
let voiceUnlocked = false;
let pendingSpeechEvent = null;
const activeVoiceAudios = new Set();
let speechSession = 0;
let visualizerFrame = 0;
let visualizerPositionSeconds = 0;
let visualizerLastTick = performance.now();
let lastFocusedElement = null;
let lastSongStartedAt = 0;

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  })[char]);
}

function formatTime(seconds = 0) {
  if (!Number.isFinite(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${mins}:${secs}`;
}

function hashString(value = '') {
  return [...String(value)].reduce((total, char) => ((total * 33) ^ char.charCodeAt(0)) >>> 0, 5381);
}

function csvToArray(value) {
  return String(value || '').split(/[,，]/).map((item) => item.trim()).filter(Boolean);
}

function renderClock() {
  const now = new Date();
  clockTime.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  clockDay.textContent = now.toLocaleDateString('en-US', { weekday: 'long' });
  clockDate.textContent = now.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
}

function songKey(song) {
  return [song?.source || '', song?.id || '', song?.title || '', song?.artist || ''].join('::');
}

function normalizeSongTitle(title = '') {
  return String(title)
    .toLowerCase()
    .normalize('NFKC')
    .replace(/\s*[-–—]\s*(live|remaster(?:ed)?|remix|karaoke|instrumental|伴奏|纯音乐|完整版|版|edit|radio edit|demo).*$/i, '')
    .replace(/\((?:[^)]*(live|remaster(?:ed)?|remix|karaoke|instrumental|伴奏|纯音乐|完整版|版|edit|demo)[^)]*)\)/gi, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function songIdentity(song = {}) {
  const artist = String(song.artist || '').split(/\s*(?:,|、|&| and | feat\.| ft\.)\s*/i)[0].toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}.]+/gu, '');
  return `${normalizeSongTitle(song.title)}::${artist}`;
}

function isSamePlayableSong(left = {}, right = {}) {
  if (!left || !right) return false;
  if (left.uri && right.uri && left.uri === right.uri) return true;
  if (left.source && right.source && left.id && right.id && left.source === right.source && String(left.id) === String(right.id)) return true;
  return songIdentity(left) === songIdentity(right);
}

function currentPlaybackSeconds() {
  return Number(progress.value) || Number(audio.currentTime) || visualizerPositionSeconds || 0;
}

function isMediaActivelyPlaying() {
  if (currentSong?.source === 'spotify') return spotifyPlaying;
  return !audio.paused && Boolean(audio.src);
}

function shouldAvoidPlayRestart(song) {
  return isSamePlayableSong(currentSong, song) && isMediaActivelyPlaying() && currentPlaybackSeconds() > 1.5;
}

function uniqueQueueSongs(songs = []) {
  const seen = new Set();
  return songs.filter((song) => {
    const key = songIdentity(song);
    if (!key.replace(/:/g, '') || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isWeakQueueSong(song = {}) {
  const title = normalizeSongTitle(song.title || '');
  const artist = String(song.artist || '').toLowerCase();
  return title === 'history'
    || /^history(?:part|pt|\d|$)/i.test(title)
    || /various artists|background music|relaxing music|study music|music therapy/i.test(artist);
}

function setTheme(theme) {
  const light = theme === 'light';
  document.body.classList.toggle('light', light);
  darkModeBtn.classList.toggle('selected', !light);
  lightModeBtn.classList.toggle('selected', light);
  localStorage.setItem('codio-theme', light ? 'light' : 'dark');
}

function setCardMode(enabled) {
  document.body.classList.toggle('card-mode', Boolean(enabled));
  cardModeBtn.classList.toggle('selected', Boolean(enabled));
  cardModeBtn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
  cardModeBtn.textContent = enabled ? 'FULL' : 'CARD';
  localStorage.setItem('codio-card-mode', enabled ? 'on' : 'off');
  if (enabled) startVisualizer();
}

function renderProfile(profile) {
  profileName.textContent = profile.name || 'Codio';
  profileStatus.textContent = profile.status || '一开机我就打碟';
  profileAvatar.innerHTML = `<img src="${CODIO_AVATAR}" alt="">`;
  profileBio.innerHTML = (profile.bio || [])
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join('');
  profileOnAir.textContent = profile.stats?.onAir || '24/7';
  profileGenres.textContent = profile.stats?.genres ?? (profile.tags || []).length;
  profileListener.textContent = profile.stats?.listener || 1;
  profileTags.innerHTML = (profile.tags || [])
    .map((tag) => `<span>${escapeHtml(tag)}</span>`)
    .join('');
  profileArtists.innerHTML = (profile.topArtists || [])
    .slice(0, 6)
    .map((artist) => `<p><strong>${escapeHtml(artist.name)}</strong><em>${artist.count || ''}</em></p>`)
    .join('') || '<p><strong>还在学习你的口味</strong><em>soon</em></p>';
  profileSongs.innerHTML = (profile.recentSongs || [])
    .slice(0, 5)
    .map((song) => `<p><strong>${escapeHtml(song.title || song.song || 'Unknown')}</strong><em>${escapeHtml(song.artist || '')}</em></p>`)
    .join('') || '<p><strong>播放几首歌后这里会更新</strong><em>live</em></p>';
}

async function openProfile() {
  lastFocusedElement = document.activeElement;
  profileOverlay.classList.add('open');
  profileOverlay.setAttribute('aria-hidden', 'false');
  profileBackBtn.focus({ preventScroll: true });
  try {
    const profile = await fetch('/api/profile').then((response) => response.json());
    renderProfile(profile);
  } catch {
    renderProfile({
      name: 'Codio',
      status: '暂时读不到 taste',
      bio: ['本地服务还没把 profile 送过来。刷新或重启后我会再试。'],
      stats: { onAir: '24/7', genres: 0, listener: 1 },
      tags: ['private radio']
    });
  }
}

function closeProfile() {
  profileOverlay.classList.remove('open');
  profileOverlay.setAttribute('aria-hidden', 'true');
  if (lastFocusedElement?.focus) lastFocusedElement.focus({ preventScroll: true });
}

function findQueueIndex(song) {
  const key = songKey(song);
  return queue.findIndex((item) => songKey(item) === key);
}

function addBubble(role, text) {
  const article = document.createElement('article');
  article.className = role === 'user' ? 'bubble user' : 'bubble nora';
  const stamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  article.innerHTML = role === 'user'
    ? `<span class="bubble-icon user-avatar" aria-hidden="true"><img src="${USER_AVATAR}" alt=""></span><div><time>you • ${stamp}</time><p>${escapeHtml(text)}</p></div>`
    : `<button class="bubble-icon" type="button" aria-label="打开 Codio profile"><img src="${CODIO_AVATAR}" alt=""></button><div><time>Codio • ${stamp}</time>${escapeHtml(text).split('\n').map((line) => `<p>${line}</p>`).join('')}</div>`;
  chatLog.append(article);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function pickSoftVoice() {
  if (!('speechSynthesis' in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  const preferred = [
    /ting-ting/i,
    /mei-jia/i,
    /sin-ji/i,
    /li-mu/i,
    /zh.*female/i,
    /mandarin/i,
    /chinese/i,
    /zh/i
  ];
  return preferred.map((pattern) => voices.find((voice) => pattern.test(`${voice.name} ${voice.lang}`))).find(Boolean) || voices[0] || null;
}

function speak(event, { force = false } = {}) {
  const session = speechSession;
  if (!voiceEnabled || !event?.text) return Promise.resolve();
  if (event.speech?.audioUrl) {
    if (session !== speechSession) return Promise.resolve();
    const voice = new Audio(event.speech.audioUrl);
    activeVoiceAudios.add(voice);
    return new Promise((resolve) => {
      const done = () => {
        activeVoiceAudios.delete(voice);
        resolve();
      };
      voice.addEventListener('ended', done, { once: true });
      voice.addEventListener('error', done, { once: true });
      voice.play().catch(done);
      if (session !== speechSession) {
        voice.pause();
        done();
      }
    });
  }

  if ('speechSynthesis' in window && event.text) {
    if (!voiceUnlocked && !force) {
      pendingSpeechEvent = event;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(event.text);
      const timeout = window.setTimeout(resolve, Math.min(9000, Math.max(2200, event.text.length * 180)));
      utterance.lang = 'zh-CN';
      utterance.voice = pickSoftVoice();
      utterance.rate = 0.82;
      utterance.pitch = 0.88;
      utterance.volume = 0.86;
      utterance.onend = () => {
        window.clearTimeout(timeout);
        resolve();
      };
      utterance.onerror = () => {
        window.clearTimeout(timeout);
        resolve();
      };
      window.speechSynthesis.cancel();
      if (session === speechSession) window.speechSynthesis.speak(utterance);
      else {
        window.clearTimeout(timeout);
        resolve();
      }
    });
  }
  return Promise.resolve();
}

function cancelSpeech() {
  speechSession += 1;
  pendingSpeechEvent = null;
  for (const voice of activeVoiceAudios) {
    voice.pause();
    voice.src = '';
  }
  activeVoiceAudios.clear();
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
}

function unlockVoice() {
  if (voiceUnlocked) return;
  voiceUnlocked = true;
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    const warmup = new SpeechSynthesisUtterance(' ');
    warmup.volume = 0;
    window.speechSynthesis.speak(warmup);
  }
  if (pendingSpeechEvent) {
    const event = pendingSpeechEvent;
    pendingSpeechEvent = null;
    setTimeout(() => speak(event, { force: true }), 120);
  }
}

function updateLikeButton() {
  const liked = currentSong && likedKeys.has(songKey(currentSong));
  const disliked = currentSong && dislikedKeys.has(songKey(currentSong));
  likeBtn.classList.toggle('active', Boolean(liked));
  likeBtn.textContent = liked ? '♥' : '♡';
  dislikeBtn.classList.toggle('active', Boolean(disliked));
  dislikeBtn.textContent = disliked ? '×' : '×';
}

function setPlayingState(isPlaying) {
  document.body.classList.toggle('is-playing', Boolean(isPlaying));
  if (isPlaying) startVisualizer();
  else stopVisualizer();
}

function syncVisualizerPosition(seconds = Number(progress.value) || 0) {
  visualizerPositionSeconds = Number(seconds) || 0;
  visualizerLastTick = performance.now();
}

function visualizerHeight(index, seconds, volumeLevel, seed) {
  const phase = seconds * (1.4 + ((seed >> (index % 8)) & 7) * 0.08) + index * 0.72;
  const slow = Math.sin(phase) * 0.5 + 0.5;
  const pulse = Math.sin(seconds * 4.2 + index * 1.37 + seed * 0.0001) * 0.5 + 0.5;
  const shimmer = Math.sin(seconds * 8.4 + index * 0.41) * 0.5 + 0.5;
  const personality = 0.72 + (((seed >> (index % 16)) & 15) / 28);
  const level = (slow * 0.42 + pulse * 0.42 + shimmer * 0.16) * personality * (0.55 + volumeLevel * 0.7);
  return Math.max(18, Math.min(178, 26 + level * 142));
}

function paintVisualizer() {
  const now = performance.now();
  const playing = currentSong?.source === 'spotify' ? spotifyPlaying : !audio.paused && Boolean(audio.src);
  if (playing) visualizerPositionSeconds += (now - visualizerLastTick) / 1000;
  visualizerLastTick = now;

  const volumeLevel = Math.max(0.08, Number(volume.value || 70) / 100);
  const seed = hashString(`${currentSong?.id || ''}:${currentSong?.title || ''}:${currentSong?.artist || ''}`);
  signalBars.forEach((bar, index) => {
    const idle = 22 + ((index * 17 + seed) % 38);
    const height = playing ? visualizerHeight(index, visualizerPositionSeconds, volumeLevel, seed) : idle;
    bar.style.setProperty('--bar-height', `${height.toFixed(1)}px`);
    bar.style.setProperty('--bar-scale', (height / 178).toFixed(3));
    bar.style.setProperty('--bar-opacity', playing ? String(0.72 + (height / 178) * 0.28) : '0.42');
  });

  if (playing || document.body.classList.contains('card-mode')) {
    visualizerFrame = requestAnimationFrame(paintVisualizer);
  } else {
    visualizerFrame = 0;
  }
}

function startVisualizer() {
  syncVisualizerPosition();
  if (!visualizerFrame) visualizerFrame = requestAnimationFrame(paintVisualizer);
}

function stopVisualizer() {
  if (visualizerFrame) cancelAnimationFrame(visualizerFrame);
  visualizerFrame = 0;
  paintVisualizer();
}

async function getSpotifyToken() {
  const response = await fetch('/api/spotify/token');
  if (!response.ok) return '';
  const data = await response.json();
  return data.accessToken || '';
}

function setupSpotifyPlayer() {
  if (spotifyPlayer || !window.Spotify) return;
  spotifyPlayer = new window.Spotify.Player({
    name: 'Codio FM',
    getOAuthToken: async (callback) => callback(await getSpotifyToken()),
    volume: Number(volume.value) / 100
  });
  spotifyPlayer.addListener('ready', ({ device_id: deviceId }) => {
    spotifyDeviceId = deviceId;
    spotifyReady = true;
    sourceStatus.textContent = 'Spotify 播放器已就绪';
  });
  spotifyPlayer.addListener('not_ready', () => {
    spotifyReady = false;
    sourceStatus.textContent = 'Spotify 播放器离线';
  });
  spotifyPlayer.addListener('initialization_error', ({ message }) => {
    addBubble('nora', `Spotify 播放器初始化失败：${message}`);
  });
  spotifyPlayer.addListener('authentication_error', () => {
    addBubble('nora', 'Spotify 授权过期了。点右上角 LOGIN 重新授权一次。');
  });
  spotifyPlayer.addListener('account_error', () => {
    addBubble('nora', 'Spotify 网页内完整播放需要 Premium。当前账号可能不是 Premium。');
  });
  spotifyPlayer.addListener('playback_error', ({ message }) => {
    addBubble('nora', `Spotify 播放没有成功：${message}`);
  });
  spotifyPlayer.addListener('player_state_changed', (state) => {
    if (!state) return;
    spotifyPlaying = !state.paused;
    setPlayingState(spotifyPlaying);
    playPauseBtn.textContent = state.paused ? '▶' : 'Ⅱ';
    progress.max = Math.floor((state.duration || 0) / 1000) || 100;
    progress.value = Math.floor((state.position || 0) / 1000);
    syncVisualizerPosition((state.position || 0) / 1000);
    elapsed.textContent = formatTime((state.position || 0) / 1000);
    duration.textContent = formatTime((state.duration || 0) / 1000);
    const trackId = state.track_window?.current_track?.id || currentSong?.id || '';
    if (trackId && trackId !== spotifyLastTrackId) {
      spotifyLastTrackId = trackId;
      spotifyEndHandledFor = '';
    }
    const nearEnd = state.duration > 0 && state.position >= state.duration - 1200;
    if (trackId && state.paused && nearEnd && spotifyEndHandledFor !== trackId) {
      spotifyEndHandledFor = trackId;
      setTimeout(playNext, 400);
    }
  });
  spotifyPlayer.connect();
}

function startSpotifyEndWatcher() {
  if (spotifyWatchTimer) clearInterval(spotifyWatchTimer);
  spotifyWatchTimer = setInterval(async () => {
    if (!spotifyPlayer || currentSong?.source !== 'spotify' || !spotifyPlaying) return;
    const state = await spotifyPlayer.getCurrentState().catch(() => null);
    if (!state) return;
    progress.max = Math.floor((state.duration || 0) / 1000) || 100;
    progress.value = Math.floor((state.position || 0) / 1000);
    syncVisualizerPosition((state.position || 0) / 1000);
    elapsed.textContent = formatTime((state.position || 0) / 1000);
    duration.textContent = formatTime((state.duration || 0) / 1000);
    const trackId = state.track_window?.current_track?.id || currentSong?.id || '';
    const remaining = (state.duration || 0) - (state.position || 0);
    if (trackId && state.duration > 0 && remaining <= 1800 && spotifyEndHandledFor !== trackId) {
      spotifyEndHandledFor = trackId;
      spotifyPlaying = false;
      setPlayingState(false);
      setTimeout(playNext, 500);
    }
  }, 1000);
}

async function playSpotifySong(song) {
  if (!song?.uri) return false;
  if (!spotifyPlayer) setupSpotifyPlayer();
  if (!spotifyReady || !spotifyDeviceId) {
    addBubble('nora', 'Spotify 播放器正在连接。第一次使用需要点 LOGIN 授权，并且账号需要 Premium。');
    return false;
  }
  const response = await fetch('/api/spotify/play', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uri: song.uri, deviceId: spotifyDeviceId })
  });
  if (!response.ok) {
    addBubble('nora', 'Spotify 没有接管播放。请确认你已经登录 Spotify Premium，然后再点一次播放。');
    return false;
  }
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  spotifyPlaying = true;
  setPlayingState(true);
  spotifyEndHandledFor = '';
  playPauseBtn.textContent = 'Ⅱ';
  startSpotifyEndWatcher();
  return true;
}

function renderSong(song, autoplay = true) {
  if (!song) return;
  currentSong = song;
  if (autoplay) lastSongStartedAt = Date.now();
  syncVisualizerPosition(0);
  const queueIndex = findQueueIndex(song);
  if (queueIndex !== -1) currentQueueIndex = queueIndex;
  songTitle.textContent = song.title || '未命名歌曲';
  songArtist.textContent = [song.artist, song.album].filter(Boolean).join(' - ') || '未知艺人';
  coverArt.innerHTML = song.cover ? `<img alt="" src="${song.cover}">` : '<span>♪</span>';
  aiBlurb.textContent = `NOW PLAYING · ${song.title || '未命名歌曲'}${song.artist ? ` - ${song.artist}` : ''}`;
  updateLikeButton();

  if (song.source === 'spotify') {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    startSpotifyEndWatcher();
  }

  if (song.source !== 'spotify' && song.url && audio.src !== song.url) {
    if (spotifyPlayer && spotifyPlaying) spotifyPlayer.pause();
    spotifyPlaying = false;
    setPlayingState(false);
    if (spotifyWatchTimer) clearInterval(spotifyWatchTimer);
    audio.src = song.url;
    progress.value = 0;
    syncVisualizerPosition(0);
    elapsed.textContent = '0:00';
  }

  if (song.source !== 'spotify' && !song.url && song.externalUrl) {
    addBubble('nora', `这首歌来自 ${song.source}，当前没有可直接播放的音频链接。我会继续换一首能在应用内播放的歌。`);
  }

  if (autoplay && song.source === 'spotify' && song.uri) {
    playSpotifySong(song);
  } else if (autoplay && song.url) {
    audio.play().catch(() => addBubble('nora', '我已经准备好音乐了。浏览器需要你点一下播放，才会开始出声。'));
  }
  renderQueue();
}

function renderQueue(songs) {
  queue = uniqueQueueSongs(songs || queue).filter((song) => !isWeakQueueSong(song));
  if (currentSong) {
    const queueIndex = findQueueIndex(currentSong);
    currentQueueIndex = queueIndex;
  }
  if (!queue.length) {
    queueEl.className = 'queue empty';
    queueEl.textContent = '暂无队列';
    currentQueueIndex = -1;
    return;
  }

  queueEl.className = 'queue';
  queueEl.innerHTML = '';
  queue.forEach((song, index) => {
    const item = document.createElement('button');
    item.className = index === currentQueueIndex ? 'song active' : 'song';
    item.type = 'button';
    item.dataset.index = String(index + 1);
    item.innerHTML = `<strong>${escapeHtml(song.title)}</strong><p>${escapeHtml(song.artist)} · ${escapeHtml(song.source)}</p>`;
    item.addEventListener('click', () => {
      currentQueueIndex = index;
      playSong(song);
    });
    queueEl.append(item);
  });
}

function renderDailyPlan(plan) {
  if (!dailyPlanEl) {
    const activeSegment = plan?.segments?.find((segment) => segment.id === plan.activeSegmentId) || plan?.segments?.[0];
    if (activeSegment) {
      episodeMood.textContent = activeSegment.id.replace('-', ' ').toUpperCase();
      episodeTitle.textContent = activeSegment.title;
      episodeCaption.textContent = activeSegment.mood || activeSegment.reason || 'curated for this hour';
    }
    if (planStatus) planStatus.textContent = plan?.activeSegmentId || 'TODAY';
    return;
  }
  if (!plan?.segments?.length) {
    dailyPlanEl.className = 'daily-plan empty';
    dailyPlanEl.textContent = '暂无今日编排';
    return;
  }

  planStatus.textContent = plan.activeSegmentId || 'TODAY';
  const activeSegment = plan.segments.find((segment) => segment.id === plan.activeSegmentId) || plan.segments[0];
  if (activeSegment) {
    episodeMood.textContent = activeSegment.id.replace('-', ' ').toUpperCase();
    episodeTitle.textContent = activeSegment.title;
    episodeCaption.textContent = activeSegment.mood || activeSegment.reason || 'curated for this hour';
  }
  dailyPlanEl.className = 'daily-plan';
  dailyPlanEl.innerHTML = plan.segments.map((segment) => {
    const active = segment.id === plan.activeSegmentId ? ' active' : '';
    return `
      <article class="plan-item${active}">
        <time>${escapeHtml(segment.time)}</time>
        <div>
          <strong>${escapeHtml(segment.title)}</strong>
          <p>${escapeHtml(segment.reason)}</p>
        </div>
      </article>
    `;
  }).join('');
  if (plan.summary) aiBlurb.textContent = plan.summary;
}

async function playSong(song) {
  cancelSpeech();
  const response = await fetch('/api/play', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ song, reason: '手动选择队列歌曲' })
  });
  const data = await response.json();
  if (data.events?.length) await handleEvent({ type: 'command-result', result: data });
  else renderSong(data.song);
  refreshState();
}

async function handleEvent(event) {
  if (event.type === 'command-result') {
    const session = speechSession;
    for (const nested of event.result.events || []) {
      if (session !== speechSession) break;
      await handleEvent(nested);
    }
    return;
  }
  if (event.type === 'radio-result') {
    if (event.result.events?.some((nested) => nested.type === 'queue')) {
      const queueEvent = event.result.events.find((nested) => nested.type === 'queue');
      renderQueue(queueEvent.songs || []);
    }
    const session = speechSession;
    for (const nested of event.result.events || []) {
      if (session !== speechSession) break;
      if (nested.type !== 'queue') await handleEvent(nested);
    }
    return;
  }
  if (event.type === 'speech') {
    const session = speechSession;
    addBubble('nora', event.text);
    if (!event.role?.includes('host-intro')) aiBlurb.textContent = event.text;
    await speak(event);
    if (session !== speechSession) return;
  }
  if (event.type === 'queue') renderQueue(event.songs);
  if (event.type === 'play') {
    if (shouldAvoidPlayRestart(event.song)) {
      currentSong = { ...currentSong, ...event.song };
      updateLikeButton();
      renderQueue();
      return;
    }
    renderSong(event.song);
  }
  if (event.type === 'weather') {
    const temp = event.weather.temp == null ? '' : `，${event.weather.temp} 度`;
    weatherEl.textContent = `${event.weather.summary}${temp}`;
  }
  if (event.type === 'memory') memoryEl.textContent = '已更新';
  if (event.type === 'schedule') {
    schedulesEl.textContent = '已添加';
    refreshState();
  }
}

async function sendCommand(text) {
  addBubble('user', text);
  commandInput.value = '';
  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    await handleEvent({ type: 'command-result', result: await response.json() });
    setTimeout(refreshState, 500);
  } catch {
    addBubble('nora', '我刚刚没有把这句话送到本地服务。你可以稍后再发一次，我还在。');
  }
}

function connectSocket() {
  socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/stream`);
  socket.addEventListener('open', () => {
    socketStatus.textContent = '已连接';
    socketStatus.classList.add('online');
  });
  socket.addEventListener('close', () => {
    socketStatus.textContent = '未连接';
    socketStatus.classList.remove('online');
    setTimeout(connectSocket, 1200);
  });
  socket.addEventListener('message', (message) => handleEvent(JSON.parse(message.data)));
}

function fillSettings(preferences) {
  settingsForm.musicSource.value = preferences.musicSource || 'auto';
  settingsForm.city.value = preferences.city || '';
  settingsForm.favoriteGenres.value = (preferences.favoriteGenres || []).join(', ');
  settingsForm.favoriteArtists.value = (preferences.favoriteArtists || []).join(', ');
  settingsForm.avoidGenres.value = (preferences.avoidGenres || []).join(', ');
  settingsForm.voiceEnabled.checked = preferences.voiceEnabled !== false;
  voiceEnabled = preferences.voiceEnabled !== false;
}

async function refreshIntegrations() {
  const data = await fetch('/api/integrations').then((response) => response.json()).catch(() => null);
  if (!data) return;
  const active = settingsForm.musicSource.value || data.active;
  const detail = data[active] || data[data.active] || data.demo;
  sourceStatus.textContent = active === 'spotify' && data.spotifyAuth?.connected
    ? 'Spotify 已授权'
    : detail?.configured ? active : `${active} 未配置`;
  spotifyLoginBtn.textContent = data.spotifyAuth?.connected ? 'SPOTIFY' : 'LOGIN';
  if (data.spotifyAuth?.connected) {
    settingsForm.musicSource.value = 'spotify';
    setupSpotifyPlayer();
  }
  neteaseStatus.textContent = data.netease?.configured ? '网易云已配置' : '网易云未配置';
}

async function refreshState() {
  const [state, weather, plan] = await Promise.all([
    fetch('/api/state').then((response) => response.json()),
    fetch('/api/weather').then((response) => response.json()).catch(() => null),
    fetch('/api/plan/today').then((response) => response.json()).catch(() => null)
  ]);

  history = state.plays.map((play) => play.song).filter(Boolean).reverse();
  likedKeys = new Set((state.likes || []).map((item) => item.key));
  dislikedKeys = new Set((state.dislikes || []).map((item) => item.key));
  updateLikeButton();
  if (!queue.length && history.length) renderQueue(history.slice(0, 5));
  playsEl.textContent = state.plays.length;
  schedulesEl.textContent = state.schedules.length;
  const genres = state.preferences.favoriteGenres || [];
  const artists = state.preferences.favoriteArtists || [];
  memoryEl.textContent = [...genres, ...artists].slice(0, 2).join('，') || '已就绪';
  fillSettings(state.preferences);
  refreshIntegrations();

  const latest = state.plays.at(-1)?.song;
  if (latest && (!currentSong || latest.id !== currentSong.id)) renderSong(latest, false);

  if (weather) {
    const temp = weather.temp == null ? '' : `，${weather.temp} 度`;
    weatherEl.textContent = `${weather.summary}${temp}`;
  }
  if (plan) renderDailyPlan(plan);
}

async function refreshQueue() {
  refreshQueueBtn.disabled = true;
  refreshQueueBtn.textContent = '刷新中';
  try {
    const response = await fetch('/api/queue/refresh', { method: 'POST' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    if (result.plan) renderDailyPlan({ ...result.plan, activeSegmentId: result.activeSegmentId });
    renderQueue(result.songs || []);
    const message = result.songs?.length
      ? `我重新排好了当前时段的 ${result.songs.length} 首歌。现在不会打断正在播放的这首，点下一首就会进入新队列。`
      : '我刚刚没能从音乐源拿到新歌单，等 Spotify 连接稳定后再试一次。';
    addBubble('nora', message);
    aiBlurb.textContent = message;
  } catch {
    addBubble('nora', '刷新歌单没有成功。先确认本地服务已经重启，然后再点一次。');
  } finally {
    refreshQueueBtn.disabled = false;
    refreshQueueBtn.textContent = 'REFRESH';
  }
}

async function radioTick(force = false) {
  if (!force && lastSongStartedAt && Date.now() - lastSongStartedAt < 180_000) return;
  if (force) {
    cancelSpeech();
    hostNowBtn.disabled = true;
    hostNowBtn.textContent = 'ON AIR';
  }

  try {
    const response = await fetch('/api/radio/tick', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        force,
        isPlaying: currentSong?.source === 'spotify' ? spotifyPlaying : !audio.paused && Boolean(audio.src),
        currentSong
      })
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    if (result.events?.length) {
      await handleEvent({ type: 'radio-result', result });
    } else if (force) {
      addBubble('nora', '我已经在当前电台时段里了。要不要我重新规划今天的歌单？');
    }
    if (result.plan) renderDailyPlan({ ...result.plan, activeSegmentId: result.activeSegmentId });
  } catch {
    if (force) addBubble('nora', '我现在连不上本地电台服务。先确认服务已经重启，然后刷新这个页面。');
  } finally {
    if (force) {
      hostNowBtn.disabled = false;
      hostNowBtn.textContent = 'HOST';
    }
  }
}

function playPrevious() {
  if (queue.length) {
    const base = currentQueueIndex >= 0 ? currentQueueIndex : findQueueIndex(currentSong);
    const previousIndex = base > 0 ? base - 1 : queue.length - 1;
    currentQueueIndex = previousIndex;
    playSong(queue[previousIndex]);
    return;
  }

  const index = history.findIndex((song) => songKey(song) === songKey(currentSong));
  const previous = history[index + 1] || history[1] || history[0];
  if (previous) playSong(previous);
}

function playNext() {
  if (queue.length) {
    const base = currentQueueIndex >= 0 ? currentQueueIndex : findQueueIndex(currentSong);
    const nextIndex = base >= 0 ? (base + 1) % queue.length : 0;
    currentQueueIndex = nextIndex;
    playSong(queue[nextIndex]);
    return;
  }

  const next = history.find((song) => songKey(song) !== songKey(currentSong)) || history[0];
  if (next) playSong(next);
}

commandForm.addEventListener('submit', (event) => {
  event.preventDefault();
  unlockVoice();
  const text = commandInput.value.trim();
  if (text) {
    commandInput.value = '';
    sendCommand(text);
  }
});

document.querySelectorAll('[data-command]').forEach((button) => {
  button.addEventListener('click', () => sendCommand(button.dataset.command));
});

hostNowBtn.addEventListener('click', () => {
  unlockVoice();
  radioTick(true);
});
enterRadioBtn.addEventListener('click', () => {
  unlockVoice();
  radioTick(true);
});

playPauseBtn.addEventListener('click', () => {
  unlockVoice();
  if (currentSong?.source === 'spotify' && currentSong?.uri) {
    if (spotifyPlayer && spotifyReady) spotifyPlayer.togglePlay();
    else playSpotifySong(currentSong);
    return;
  }
  if (!audio.src && currentSong?.url) audio.src = currentSong.url;
  if (audio.paused) audio.play().catch(() => addBubble('nora', '我已经准备好音乐了。浏览器需要你点一下播放，才会开始出声。'));
  else audio.pause();
});

nextBtn.addEventListener('click', () => {
  unlockVoice();
  playNext();
});
refreshQueueBtn.addEventListener('click', () => {
  unlockVoice();
  refreshQueue();
});
previousBtn.addEventListener('click', () => {
  unlockVoice();
  playPrevious();
});
document.addEventListener('pointerdown', unlockVoice, { once: true });
document.addEventListener('keydown', unlockVoice, { once: true });
audio.addEventListener('play', () => {
  spotifyPlaying = false;
  setPlayingState(true);
  playPauseBtn.textContent = 'Ⅱ';
  playPauseBtn.setAttribute('aria-label', '暂停');
});

audio.addEventListener('pause', () => {
  if (!spotifyPlaying) setPlayingState(false);
  playPauseBtn.textContent = '▶';
  playPauseBtn.setAttribute('aria-label', '播放');
});

audio.addEventListener('timeupdate', () => {
  progress.max = Math.floor(audio.duration || 100);
  progress.value = Math.floor(audio.currentTime || 0);
  syncVisualizerPosition(audio.currentTime || 0);
  elapsed.textContent = formatTime(audio.currentTime);
  duration.textContent = formatTime(audio.duration);
});

audio.addEventListener('ended', playNext);

progress.addEventListener('input', () => {
  const seconds = Number(progress.value);
  if (currentSong?.source === 'spotify' && spotifyPlayer) {
    spotifyPlayer.seek(seconds * 1000).catch(() => {
      addBubble('nora', 'Spotify 暂时没有接受这次跳转。等播放器完全连上后再拖一次。');
    });
    syncVisualizerPosition(seconds);
    return;
  }
  audio.currentTime = seconds;
  syncVisualizerPosition(seconds);
});

volume.addEventListener('input', () => {
  audio.volume = Number(volume.value) / 100;
  if (spotifyPlayer) spotifyPlayer.setVolume(Number(volume.value) / 100);
});

likeBtn.addEventListener('click', async () => {
  if (!currentSong) return;
  const response = await fetch('/api/likes/toggle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ song: currentSong })
  });
  const data = await response.json();
  likedKeys = new Set((data.likes || []).map((item) => item.key));
  if (data.dislikes) dislikedKeys = new Set((data.dislikes || []).map((item) => item.key));
  updateLikeButton();
  memoryEl.textContent = data.liked ? '已收藏' : '已取消收藏';
});

dislikeBtn.addEventListener('click', async () => {
  if (!currentSong) return;
  const response = await fetch('/api/dislikes/toggle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ song: currentSong })
  });
  const data = await response.json();
  dislikedKeys = new Set((data.dislikes || []).map((item) => item.key));
  if (data.likes) likedKeys = new Set((data.likes || []).map((item) => item.key));
  updateLikeButton();
  memoryEl.textContent = data.disliked ? '已记住不喜欢' : '已取消不喜欢';
});

spotifyLoginBtn.addEventListener('click', () => {
  window.location.href = '/auth/spotify/login';
});

profileBtn.addEventListener('click', openProfile);
profileBackBtn.addEventListener('click', closeProfile);
profileCloseBtn.addEventListener('click', closeProfile);
profileOverlay.addEventListener('click', (event) => {
  if (event.target === profileOverlay) closeProfile();
});
chatLog.addEventListener('click', (event) => {
  if (event.target.closest('.bubble.nora .bubble-icon')) openProfile();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeProfile();
});

cardModeBtn.addEventListener('click', () => {
  setCardMode(!document.body.classList.contains('card-mode'));
});

darkModeBtn.addEventListener('click', () => setTheme('dark'));
lightModeBtn.addEventListener('click', () => setTheme('light'));

settingsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const preferences = {
    musicSource: settingsForm.musicSource.value,
    city: settingsForm.city.value.trim(),
    favoriteGenres: csvToArray(settingsForm.favoriteGenres.value),
    favoriteArtists: csvToArray(settingsForm.favoriteArtists.value),
    avoidGenres: csvToArray(settingsForm.avoidGenres.value),
    voiceEnabled: settingsForm.voiceEnabled.checked
  };
  const response = await fetch('/api/preferences', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ preferences })
  });
  const data = await response.json();
  memoryEl.textContent = '已保存';
  fillSettings(data.preferences);
  refreshIntegrations();
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

audio.volume = Number(volume.value) / 100;
window.onSpotifyWebPlaybackSDKReady = setupSpotifyPlayer;
setTheme(localStorage.getItem('codio-theme') || 'dark');
setCardMode(localStorage.getItem('codio-card-mode') === 'on');
if (!visualizerFrame) paintVisualizer();
renderClock();
setInterval(renderClock, 1000);
connectSocket();
refreshState();
setTimeout(() => radioTick(false), 1500);
setInterval(() => radioTick(false), 60_000);
