import { buildContext } from './context.js';
import { callLLM, generateHostIntro } from './claude.js';
import { addMessage, addPlay, addSchedule, rememberPreference } from './state.js';
import { getWeather } from './weather.js';
import { getPlayableSongs, getSongUrl, recommendSongs, searchSongs } from './music.js';
import { synthesizeSpeech } from './tts.js';
import { buildHostIntroEvents } from './hostIntro.js';
import { getKnownTasteKeys, searchTasteTracks } from './taste.js';
import { config } from './config.js';

function normalizeSongTitle(title = '') {
  return String(title)
    .toLowerCase()
    .normalize('NFKC')
    .replace(/\s*[-–—]\s*(live|remaster(?:ed)?|remix|karaoke|instrumental|伴奏|纯音乐|完整版|版|edit|radio edit|demo).*$/i, '')
    .replace(/\((?:[^)]*(live|remaster(?:ed)?|remix|karaoke|instrumental|伴奏|纯音乐|完整版|版|edit|demo)[^)]*)\)/gi, '')
    .replace(/\[(?:[^\]]*(live|remaster(?:ed)?|remix|karaoke|instrumental|伴奏|纯音乐|完整版|版|edit|demo)[^\]]*)\]/gi, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function primaryArtist(artist = '') {
  return String(artist)
    .split(/\s*(?:,|、|&| and | feat\.| ft\.)\s*/i)[0]
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}.]+/gu, '');
}

function songIdentity(song = {}) {
  return `${normalizeSongTitle(song.title)}::${primaryArtist(song.artist)}`;
}

function uniqueSongs(songs = []) {
  const seen = new Set();
  const unique = [];
  for (const song of songs) {
    const identity = songIdentity(song);
    const fallback = `${song.source}:${song.id || song.title}:${song.artist}`;
    const key = identity.replace(/:/g, '') ? identity : fallback;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(song);
    }
  }
  return unique;
}

function isGenericLabelTrack(song = {}) {
  const title = String(song.title || '').toLowerCase().trim();
  const artist = String(song.artist || '').toLowerCase();
  const normalized = title
    .replace(/[()[\]{}]/g, ' ')
    .replace(/[^\p{L}\p{N}&+ ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const genreWords = '(jazz|rock|folk|r&b|rnb|soul|city pop|pop|rap|hip hop|lofi|lo fi|ambient|electronic|edm|house|techno|piano|guitar|acoustic|instrumental|classical|japanese|korean|chinese|cantonese)';
  const utilityWords = '(playlist|mix|music|songs|beats|bgm|background|study|sleep|relax|relaxing|chill|focus|work|coffee|cafe|lounge|radio|collection|compilation|instrumental)';
  const genericPatterns = [
    new RegExp(`^${genreWords} ${utilityWords}$`, 'i'),
    new RegExp(`^${utilityWords} ${genreWords}$`, 'i'),
    new RegExp(`^${genreWords} ${genreWords} ${utilityWords}$`, 'i'),
    new RegExp(`^${utilityWords} ${utilityWords} ${genreWords}$`, 'i'),
    /^(japanese jazz|jazz music|rock music|folk music|r&b music|lofi beats|study beats|sleep music|relaxing music|background music|piano music|guitar music|meditation music)$/i
  ];
  const genericArtist = /various artists|relaxing|background|study|sleep|playlist|music therapy|meditation|coffee|cafe|jazz music|rock music|lofi|beats/i.test(artist);
  return genericPatterns.some((pattern) => pattern.test(normalized))
    || (genericArtist && new RegExp(`${genreWords}|${utilityWords}`, 'i').test(normalized));
}

function topTasteArtists(context, limit = 4) {
  const artists = context.promptParts?.playlistTaste?.importedLibrary?.topPrimaryArtists || [];
  return artists.slice(0, limit).map((artist) => artist.name).filter(Boolean);
}

function detectArtistIntent(text = '', context = {}) {
  const normalized = String(text).toLowerCase();
  const imported = context.promptParts?.playlistTaste?.importedLibrary;
  const libraryArtists = [
    ...(imported?.topPrimaryArtists || []),
    ...(imported?.topArtists || [])
  ].map((item) => item.name).filter(Boolean);
  const knownAliases = [
    '宋冬野', '赵雷', '陈粒', '马頔', '李健', '房东的猫',
    '周杰伦', 'Jay Chou', '陈奕迅', 'Eason Chan', '林俊杰', 'JJ Lin',
    '方大同', 'Khalil Fong', '陶喆', 'David Tao', '蔡健雅', 'Tanya Chua',
    'Gareth.T', 'keshi', '落日飞车', 'Sunset Rollercoaster',
    '张敬轩', 'Hins Cheung', '周柏豪', 'Pakho Chau', 'AGA',
    'SZA', 'The Weeknd', 'Daniel Caesar', 'Frank Ocean', 'Joji', 'Giveon',
    'BIGBANG', 'DPR IAN', 'NewJeans'
  ];
  return [...new Set([...libraryArtists, ...knownAliases])]
    .filter((artist) => artist && normalized.includes(String(artist).toLowerCase()))
    .slice(0, 5);
}

function isGenericRecommendation(text = '', context = {}) {
  const normalized = String(text).toLowerCase();
  const generic = /推荐|来(几|一)?首|放(点|些)?歌|播放音乐|听歌|随便|我爱听|适合我|歌单/.test(normalized);
  const hasArtist = detectArtistIntent(text, context).length > 0;
  const specific = /jay chou|周杰伦|eason|陈奕迅|keshi|gareth|jj lin|林俊杰|khalil|方大同|david tao|陶喆|tanya|蔡健雅|rnb|r&b|民谣|city pop|说唱|rap|emo|深夜|早上|下午|晚上|华语|中文|粤语|英文|英语|外语|欧美|日语|日本|japanese|韩语|韩国|kpop|jpop|hip.?hop|爵士|jazz|摇滚|rock|轻音乐|电子|indie|独立/i.test(normalized);
  return generic && !specific && !hasArtist;
}

function detectLanguageIntent(text = '') {
  const normalized = String(text).toLowerCase();
  if (/英文|英语|外语|欧美|western|english/.test(normalized)) return 'english';
  if (/韩语|韩国|kpop|k-pop|korean/.test(normalized)) return 'korean';
  if (/日语|日本|jpop|j-pop|japanese/.test(normalized)) return 'japanese';
  if (/粤语|廣東|广东|cantonese/.test(normalized)) return 'cantonese';
  if (/华语|中文|国语|mandarin|chinese/.test(normalized)) return 'chinese';
  return '';
}

function wantsDiscovery(text = '') {
  return /没听过|沒聽過|新歌|新鲜|新鮮|发现|發現|探索|类似|相似|别重复|不要重复|没放过|沒放過|没听腻|沒聽膩|surprise|discover/i.test(String(text));
}

function detectGenreIntent(text = '') {
  const normalized = String(text).toLowerCase();
  const genres = [];
  const checks = [
    ['light', /轻音乐|輕音樂|轻松|放松|舒缓|纯音乐|器乐|ambient|instrumental|chill|lofi/],
    ['folk', /民谣|民謠|folk|acoustic/],
    ['rock', /摇滚|搖滾|rock|alt rock|indie rock/],
    ['rnb', /r&b|rnb|节奏布鲁斯|soul/],
    ['citypop', /city\s*pop|城市流行|citypop/],
    ['rap', /说唱|說唱|rap|hip.?hop|嘻哈/],
    ['electronic', /电子|電子|electronic|edm|house|techno/],
    ['jazz', /爵士|jazz/],
    ['indie', /独立|獨立|indie/],
    ['pop', /流行|pop/]
  ];
  for (const [genre, pattern] of checks) {
    if (pattern.test(normalized)) genres.push(genre);
  }
  return genres;
}

function genreQueries(genres = [], text = '') {
  const language = detectLanguageIntent(text);
  const night = /深夜|夜晚|emo|难过|低落|安静|温柔|放松/i.test(text);
  const pools = {
    light: language === 'english'
      ? ['lofi chill instrumental', 'ambient pop mellow', 'piano chill playlist', 'acoustic instrumental calm', 'soft indie instrumental']
      : ['轻音乐 放松', '华语 轻音乐', '纯音乐 放松', '钢琴 轻音乐', 'lofi mandopop', '房东的猫 acoustic', '陈粒 安静'],
    folk: language === 'english'
      ? ['Bon Iver folk', 'Novo Amor acoustic', 'Ben Howard folk', 'The Paper Kites acoustic', 'Passenger folk']
      : ['宋冬野 民谣', '赵雷 民谣', '房东的猫 民谣', '陈粒 民谣', '马頔 民谣', '好妹妹 民谣', '李健 民谣'],
    rock: language === 'english'
      ? ['Arctic Monkeys', 'The Strokes', 'Radiohead', 'Coldplay alternative rock', 'The 1975']
      : ['万能青年旅店 摇滚', '新裤子 摇滚', '草东没有派对', '告五人 摇滚', '五月天 摇滚', '痛仰 摇滚'],
    rnb: language === 'english'
      ? ['Daniel Caesar R&B', 'Frank Ocean R&B', 'SZA R&B', 'Brent Faiyaz R&B', 'Giveon R&B', 'Omar Apollo R&B']
      : ['方大同 R&B', '陶喆 R&B', 'The Crane R&B', '9m88 soul', '孙盛希 R&B', 'Karencici R&B', 'ØZI R&B'],
    citypop: ['落日飞车 city pop', '椅子乐团 city pop', '甜約翰 city pop', 'Yogee New Waves city pop', 'Mariya Takeuchi city pop', '宇宙人 city pop'],
    rap: language === 'english'
      ? ['Drake melodic rap', 'Mac Miller swimming', 'JID melodic rap', 'Post Malone melodic rap', 'Juice WRLD melodic']
      : ['Soft Lipa 蛋堡', '法老 说唱', '刘聪 KEY.L', '王以太 说唱', '满舒克 说唱', '功夫胖 说唱'],
    electronic: ['ODESZA', 'M83 electronic', 'Porter Robinson', 'Fred again', '落日飞车 electronic', 'Kiasmos'],
    jazz: language === 'japanese'
      ? ['Ryo Fukui Scenery', 'Hiromi Spectrum', 'Soil & Pimp Sessions Summer Goddess', 'T-Square Truth', 'Casiopea Mint Jams', 'H ZETTRIO Dancing in the mood', 'fox capture plan 疾走する閃光']
      : language === 'english'
      ? ['Norah Jones jazz', 'Chet Baker jazz', 'Laufey jazz', 'Robert Glasper jazz', 'BADBADNOTGOOD jazz']
      : ['9m88 jazz', '王若琳 jazz', 'Norah Jones jazz', 'Chet Baker jazz', 'Laufey jazz'],
    indie: ['deca joins indie', 'I Mean Us indie', '告五人 indie', '椅子乐团 indie', 'The Chairs indie', 'Steve Lacy indie'],
    pop: language === 'english'
      ? ['The Weeknd pop', 'Justin Bieber pop R&B', 'Post Malone pop', 'Rihanna pop', 'Troye Sivan pop']
      : ['周杰伦 流行', '陈奕迅 流行', '林俊杰 流行', '孙燕姿 流行', '李荣浩 流行']
  };
  return genres.flatMap((genre) => (pools[genre] || []).map((query) => night && !/night|深夜|夜晚|温柔|chill|calm|放松|安静/.test(query) ? `${query} night` : query));
}

function combinedIntentQueries(language, genres = [], text = '') {
  const combos = [];
  if (language === 'japanese' && genres.includes('jazz')) {
    combos.push(
      'Ryo Fukui Scenery',
      'Ryo Fukui Early Summer',
      'Hiromi jazz',
      'Hiromi Spectrum',
      'Casiopea jazz fusion',
      'Casiopea Mint Jams',
      'T-Square jazz fusion',
      'T-Square Truth',
      'H ZETTRIO jazz',
      'fox capture plan 疾走する閃光',
      'Soil & Pimp Sessions Summer Goddess'
    );
  }
  if (language === 'japanese' && genres.includes('citypop')) {
    combos.push('Mariya Takeuchi city pop', 'Anri city pop', 'Tatsuro Yamashita city pop', 'Taeko Onuki city pop');
  }
  if (language === 'english' && genres.includes('jazz')) {
    combos.push('Laufey jazz', 'Norah Jones jazz', 'Chet Baker jazz', 'Robert Glasper jazz');
  }
  if (language === 'english' && genres.includes('rnb')) {
    combos.push('Daniel Caesar R&B', 'Frank Ocean R&B', 'SZA R&B', 'Brent Faiyaz R&B', 'Giveon R&B');
  }
  return combos.map((query) => /深夜|夜晚|放松|安静/i.test(text) && !/night|chill|calm/i.test(query) ? `${query} chill` : query);
}

function languageQueries(language, text = '') {
  const mood = /深夜|夜晚|emo|难过|低落|安静|温柔|放松/i.test(text) ? 'night chill' : '';
  const pools = {
    english: [
      `keshi ${mood}`.trim(),
      `The Weeknd ${mood}`.trim(),
      `Daniel Caesar ${mood}`.trim(),
      `Frank Ocean ${mood}`.trim(),
      `Joji ${mood}`.trim(),
      `Giveon ${mood}`.trim(),
      'Post Malone melodic',
      'Justin Bieber R&B',
      'Drake R&B',
      'Juice WRLD melodic'
    ],
    korean: ['BIGBANG', 'NewJeans R&B', 'DEAN R&B', 'Crush Korean R&B', 'DPR IAN', 'BIBI Korean R&B', 'Jungkook R&B', 'TAEYEON ballad'],
    japanese: ['藤井風 R&B', '宇多田ヒカル R&B', 'Vaundy', 'iri R&B', 'Kenshi Yonezu', 'Aimyon', 'city pop Japanese', 'Mariya Takeuchi'],
    cantonese: ['Eason Chan 粤语', 'Hins Cheung 粤语', 'Gareth.T 粤语', 'Pakho Chau 粤语', 'AGA 粤语', '林家谦 粤语', 'RubberBand 粤语'],
    chinese: ['Jay Chou', 'Eason Chan', 'JJ Lin', 'Khalil Fong', 'David Tao', 'Gareth.T', 'Tanya Chua']
  };
  return pools[language] || [];
}

function discoveryQueries(text = '') {
  const night = /深夜|夜晚|emo|难过|低落|安静|温柔|放松/i.test(text);
  const english = detectLanguageIntent(text) === 'english';
  const pools = english ? [
    'Omar Apollo R&B', 'Brent Faiyaz night', 'SZA R&B', 'Steve Lacy indie R&B', 'Giveon night',
    'Joji night', 'Daniel Caesar R&B', 'Frank Ocean blonde', 'd4vd indie', 'Montell Fish night',
    'Rex Orange County mellow', 'Mac Miller swimming'
  ] : [
    '林家谦 粤语 R&B', '张敬轩 深夜', 'AGA 粤语 R&B', 'Serrini 粤语 indie', 'The Crane R&B',
    '9m88 soul', '孙盛希 R&B', 'Karencici R&B', 'ØZI R&B', 'J.Sheon R&B',
    'h3R3 深夜', '郑润泽 温柔', '郭顶 indie', '椅子乐团 city pop',
    'deca joins 夜晚', '甜約翰 city pop', 'I Mean Us indie', '告五人 温柔'
  ];
  return pools.map((query) => night && !/night|深夜|夜晚|温柔/.test(query) ? `${query} night` : query);
}

function buildSearchQueries({ userText, action, context }) {
  const base = [action.query, action.mood, userText]
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  const artistIntents = detectArtistIntent(userText, context);
  const language = detectLanguageIntent(userText);
  const genres = detectGenreIntent(userText);
  const discovery = wantsDiscovery(userText);
  const genericRecommendation = isGenericRecommendation(userText, context);
  const wantsPersonalTaste = genericRecommendation || genres.length > 0 || /我喜欢|我的品味|按我的|适合我|华语|中文|国语|早上|上午|下午|晚上|深夜|emo|放松|专注|开心|难过|低落|rnb|民谣|摇滚|说唱|rap|流行|英文|英语|外语|欧美|韩语|日语|kpop|jpop/i.test(userText);
  const tasteQueries = wantsPersonalTaste
    ? topTasteArtists(context, 8).map((artist) => genericRecommendation ? artist : `${artist} ${action.mood || userText}`)
    : [];
  const trackQueries = searchTasteTracks(
    context.promptParts?.playlistTaste?.importedLibrary,
    `${userText} ${action.mood || ''} ${action.query || ''}`,
    10
  ).map((track) => `${track.song} ${track.artist}`);
  const langQueries = languageQueries(language, `${userText} ${action.mood || ''}`);
  const styleQueries = genreQueries(genres, `${userText} ${action.mood || ''}`);
  const comboQueries = combinedIntentQueries(language, genres, `${userText} ${action.mood || ''}`);
  const ordered = artistIntents.length
    ? [
        ...artistIntents.flatMap((artist) => [
          artist,
          `${artist} 热门`,
          `${artist} ${genres.length ? genres.join(' ') : ''}`.trim()
        ]),
        ...trackQueries,
        ...styleQueries,
        ...langQueries,
        ...base
      ]
    : discovery
    ? [...styleQueries, ...discoveryQueries(`${userText} ${action.mood || ''}`), ...langQueries]
    : genres.length
    ? [...comboQueries, ...styleQueries, ...trackQueries, ...langQueries, ...base]
    : language
    ? [...langQueries, ...trackQueries, ...base]
    : genericRecommendation
    ? [...trackQueries, ...tasteQueries]
    : [...trackQueries, ...tasteQueries, ...base];
  return [...new Set(ordered)].slice(0, 12);
}

async function buildPlayableQueue({ userText, action, context }) {
  const queries = buildSearchQueries({ userText, action, context });
  const candidates = [];
  const discovery = wantsDiscovery(userText);
  const knownTasteKeys = discovery ? getKnownTasteKeys(context.promptParts?.playlistTaste?.importedLibrary) : new Set();
  const recentKeys = new Set((context.recentPlays || []).map((play) => songIdentity(play.song || {})));
  const requestedSource = /spotify/i.test(userText)
    ? 'spotify'
    : context.preferences?.musicSource || config.music.source;
  const strictSource = requestedSource === 'auto' ? 'auto' : `${requestedSource}-only`;
  for (const query of queries) {
    candidates.push(...await searchSongs(query, strictSource));
    const filteredBase = uniqueSongs(candidates).filter((song) => !isGenericLabelTrack(song));
    const filtered = discovery
      ? filteredBase.filter((song) => {
          const key = `${song.title || ''} ${song.artist || ''}`.toLowerCase();
          return !knownTasteKeys.has(key) && !recentKeys.has(songIdentity(song));
        })
      : filteredBase;
    const playable = await getPlayableSongs(filtered);
    if (playable.length >= 8) return playable.slice(0, 8);
  }

  const finalBase = uniqueSongs(candidates).filter((song) => !isGenericLabelTrack(song));
  const finalCandidates = discovery
    ? finalBase.filter((song) => {
        const key = `${song.title || ''} ${song.artist || ''}`.toLowerCase();
        return !knownTasteKeys.has(key) && !recentKeys.has(songIdentity(song));
      })
    : finalBase;
  let playable = await getPlayableSongs(finalCandidates);
  if (!playable.length && requestedSource !== 'spotify') {
    const fallback = await recommendSongs({
      mood: action.mood || action.query || userText,
      history: context.recentPlays,
      preferences: context.preferences
    });
    playable = await getPlayableSongs(fallback);
  }
  if (!playable.length && requestedSource !== 'spotify') {
    playable = await getPlayableSongs(await searchSongs(action.mood || action.query || userText, 'demo'));
  }
  return playable.slice(0, 8);
}

function llmFallbackMessage(error) {
  const message = String(error?.message || '');
  if (/insufficient_quota|quota|billing|429/i.test(message)) {
    return 'AI 大脑连上了，但 OpenAI 额度或账单不可用，所以我先用本地规则帮你排歌。';
  }
  if (/401|invalid_api_key|incorrect api key|unauthorized/i.test(message)) {
    return 'AI 大脑认证失败，可能是 OpenAI key 无效或已被关闭。我先用本地规则继续。';
  }
  if (/404|model/i.test(message)) {
    return 'AI 大脑的模型配置可能不可用，我先用本地规则继续。';
  }
  if (/ENOTFOUND|fetch failed|ECONN|ETIMEDOUT|network/i.test(message)) {
    return 'AI 大脑现在连不上网络接口，我先用本地规则继续。';
  }
  return 'AI 大脑暂时没有成功回应，我先用本地规则帮你排一组。';
}

function wantsSelfIntro(text = '') {
  return /介绍.*(自己|你)|你是谁|你能做什么|讲讲.*codio|codio.*是谁|self intro|introduce yourself/i.test(text);
}

export async function routeCommand(text) {
  await addMessage('user', text);
  const context = await buildContext(text);
  if (wantsSelfIntro(text) && !/推荐|放|播放|来(一|几)?首|听歌|music|song|recommend|play/i.test(text)) {
    const intro = '我是 Codio，你的私人 AI 电台主播。我会根据时间、天气、你的日程、最近听歌和收藏偏好来安排歌单，也会在适合的时候像深夜电台一样聊几句。你可以把我当成一个会记住口味、会策展、也会陪你听歌的本地电台。';
    const speech = await synthesizeSpeech(intro);
    await addMessage('assistant', intro, { action: 'self-intro' });
    return { actions: [{ type: 'say', text: intro }], events: [{ type: 'speech', text: intro, speech, role: 'self-intro' }] };
  }
  const actions = await callLLM(context).catch((error) => [
    { type: 'say', text: llmFallbackMessage(error) },
    { type: 'recommend', mood: text }
  ]);

  const events = [];

  if (wantsSelfIntro(text)) {
    const intro = '我是 Codio，你的私人 AI 电台主播。我会先理解你的状态，再从你的音乐口味和可用播放源里挑歌；我也会像深夜电台一样，在歌与歌之间说几句具体的话。';
    const speech = await synthesizeSpeech(intro);
    await addMessage('assistant', intro, { action: 'self-intro' });
    events.push({ type: 'speech', text: intro, speech, role: 'self-intro' });
  }

  for (const action of actions) {
    if (action.type === 'say' || action.type === 'segue') {
      const speech = await synthesizeSpeech(action.text);
      await addMessage('assistant', action.text, { action: action.type });
      events.push({ type: 'speech', text: action.text, speech });
    }

    if (action.type === 'weather') {
      const weather = await getWeather();
      const text = `${weather.city}现在的天气是${weather.summary}${weather.temp == null ? '' : `，${weather.temp} 度`}。`;
      const speech = await synthesizeSpeech(text);
      await addMessage('assistant', text, { action: 'weather', weather });
      events.push({ type: 'weather', weather });
      events.push({ type: 'speech', text, speech });
    }

    if (action.type === 'recommend') {
      const playableSongs = await buildPlayableQueue({ userText: text, action, context });
      if (!playableSongs.length) {
        const message = '我没有从 Spotify 拿到符合你品味的可播放结果，所以我不会用 demo 歌糊弄你。先确认 Spotify 已授权并且播放器已就绪，我再按你的歌单重新排。';
        const speech = await synthesizeSpeech(message);
        await addMessage('assistant', message, { action: 'spotify-empty' });
        events.push({ type: 'speech', text: message, speech });
        continue;
      }
      const queueSongs = playableSongs;
      const song = playableSongs[0];
      await addPlay(song, action.mood || 'recommendation');
      const introText = await generateHostIntro({
        segment: {
          id: 'user-request',
          title: '即时点歌',
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          mood: action.mood || text,
          reason: `用户刚刚说：${text}`
        },
        song,
        weather: context.weather,
        preferences: context.preferences,
        recentPlays: context.recentPlays
      });
      events.push({ type: 'queue', songs: queueSongs });
      events.push(...await buildHostIntroEvents(introText));
      events.push({ type: 'play', song });
    }

    if (action.type === 'play') {
      const playableSongs = await buildPlayableQueue({ userText: text, action, context });
      const [playable] = playableSongs;
      if (playable) {
        await addPlay(playable, action.query || text);
        const introText = await generateHostIntro({
          segment: {
            id: 'user-play',
            title: '即时播放',
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            mood: action.query || text,
            reason: `用户指定播放：${action.query || text}`
          },
          song: playable,
          weather: context.weather,
          preferences: context.preferences,
          recentPlays: context.recentPlays
        });
        events.push({ type: 'queue', songs: playableSongs });
        events.push(...await buildHostIntroEvents(introText));
        events.push({ type: 'play', song: playable });
      } else {
        const songs = await searchSongs(action.query || text);
        const unresolved = await getSongUrl(songs[0]);
        events.push({ type: 'speech', text: unresolved.playbackNote || '这首歌暂时没有可播放链接，我先换一首能在应用内播放的。' });
      }
    }

    if (action.type === 'remember') {
      const preferences = await rememberPreference(action.key || 'notes', action.value);
      events.push({ type: 'memory', preferences });
    }

    if (action.type === 'schedule') {
      const schedule = await addSchedule(action.time || '09:00', action.prompt || text);
      events.push({ type: 'schedule', schedule });
    }

    if (action.type === 'reason') {
      events.push({ type: 'reason', text: action.text });
    }
  }

  return { actions, events };
}
