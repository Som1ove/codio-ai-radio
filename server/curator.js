import { getCalendarContext } from './calendar.js';
import { getWeather } from './weather.js';
import { getPlayableSongs, searchSongs } from './music.js';
import { addMessage, getState, updateState } from './state.js';
import { synthesizeSpeech } from './tts.js';
import { getImportedTasteProfile, pickDailyTasteTrackQueries, pickTasteArtists } from './taste.js';
import { generateDjChatter, generateHostIntro } from './claude.js';
import { buildHostIntroEvents } from './hostIntro.js';

const RADIO_PLAN_VERSION = 2;
const BLOCKED_QUERY_WORDS = new Set([
  'history',
  'radio',
  'playlist',
  'mix',
  'music',
  'songs',
  'track',
  'tracks',
  'collection',
  'compilation'
]);

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function hashText(text = '') {
  return [...String(text)].reduce((total, char) => ((total * 33) + char.charCodeAt(0)) >>> 0, 11);
}

function rotate(items = [], seed = 0) {
  if (!items.length) return [];
  const offset = seed % items.length;
  return [...items.slice(offset), ...items.slice(0, offset)];
}

function normalizeText(value = '') {
  return String(value)
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}&+ ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isWeakSearchQuery(query = '') {
  const normalized = normalizeText(query);
  if (!normalized) return true;
  if (BLOCKED_QUERY_WORDS.has(normalized)) return true;
  const words = normalized.split(' ').filter(Boolean);
  return words.length === 1 && BLOCKED_QUERY_WORDS.has(words[0]);
}

function isWeakRadioResult(song = {}) {
  const title = normalizeText(song.title || '');
  const artist = normalizeText(song.artist || '');
  if (BLOCKED_QUERY_WORDS.has(title)) return true;
  if (title === 'history' || /^history(?: part| pt|\d|\s|$)/i.test(title)) return true;
  if (/^(various artists|unknown|spotify|karaoke|background music|relaxing music|study music|music therapy)$/.test(artist)) return true;
  return false;
}

function minutesNow() {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

function toMinutes(hhmm) {
  const [hour, minute] = String(hhmm).split(':').map(Number);
  return hour * 60 + minute;
}

function pickChinesePreference(preferences = {}, tasteProfile = {}) {
  const artists = preferences.favoriteArtists || [];
  const genres = preferences.favoriteGenres || [];
  const importedArtists = pickTasteArtists(tasteProfile, 'morning', 3);
  const chinese = [...artists, ...genres].find((item) => /华语|中文|国语|毛不易|陈绮贞|告五人|落日飞车/.test(item));
  return chinese || importedArtists[0] || artists[0] || genres[0] || '华语 温柔';
}

function weatherMood(weather = {}) {
  const summary = weather.summary || '';
  if (weather.source === 'fallback' || /不可用/.test(summary)) return '稳定、不过分打扰';
  if (/雨|雾|阴|雪/.test(summary)) return '低亮度、柔和、留白多';
  if (/晴|晴朗/.test(summary)) return '清爽、明亮、轻轻提神';
  return '稳定、不过分打扰';
}

function hasWeather(weather = {}) {
  return weather.source !== 'fallback' && weather.summary && !/不可用/.test(weather.summary);
}

function weatherLine(weather = {}) {
  if (!hasWeather(weather)) return `今天先按${weather.city || '你所在城市'}的时间、日程和你的华语偏好来编排`;
  const temp = weather.temp == null ? '' : `，${weather.temp} 度`;
  return `今天${weather.city || '这里'}是${weather.summary}${temp}`;
}

function eventHint(calendar = {}) {
  const events = calendar.events || [];
  if (!events.length) return '今天没有读取到明确日程，可以自由铺陈音乐。';
  return `今天有 ${events.length} 个日程，音乐要给日程之间留出缓冲。`;
}

function dailyStyleQueries(segmentId, date, limit = 6) {
  const stylePools = {
    morning: [
      '郭顶 温柔 华语', '孙燕姿 温柔', '告五人 温柔', '陈粒 安静', '房东的猫 早晨',
      '李荣浩 温柔', '卢广仲 清晨', '徐佳莹 温柔', '王若琳 轻松', '韦礼安 早晨'
    ],
    'late-morning': [
      '方大同 R&B 工作', '陶喆 R&B', '王力宏 R&B', '韦礼安 acoustic', '李荣浩 acoustic',
      '孙盛希 R&B', '9m88 soul', 'ØZI R&B', 'The Crane R&B', 'Karencici R&B'
    ],
    afternoon: [
      '落日飞车 city pop', 'The Chairs 椅子乐团', 'Deca Joins indie', '告五人 indie pop',
      '甜約翰 city pop', 'I Mean Us indie', '宇宙人 city pop', 'Gareth.T R&B', 'ØZI R&B', 'The Weeknd pop'
    ],
    evening: [
      '张敬轩 粤语', '林宥嘉 晚上', '陈奕迅 粤语', '方大同 晚上', '陶喆 晚上',
      '蔡健雅 晚上', '孙燕姿 晚上', '周柏豪 粤语', '林家谦 粤语', 'AGA 粤语'
    ],
    night: [
      'keshi night', 'Joji night', 'Frank Ocean night', 'Daniel Caesar R&B', 'Giveon night',
      '陈奕迅 深夜', '林宥嘉 深夜', 'h3R3 深夜', 'J.Sheon R&B', 'deca joins 夜晚'
    ]
  };
  return rotate(stylePools[segmentId] || [], hashText(`${date}:${segmentId}:style`)).slice(0, limit);
}

function buildSegments({ preferences, weather, calendar, tasteProfile, date, recentPlays }) {
  const chineseTaste = pickChinesePreference(preferences, tasteProfile);
  const morningArtists = pickTasteArtists(tasteProfile, 'morning', 3);
  const focusArtists = pickTasteArtists(tasteProfile, 'late-morning', 3);
  const afternoonArtists = pickTasteArtists(tasteProfile, 'afternoon', 3);
  const eveningArtists = pickTasteArtists(tasteProfile, 'evening', 3);
  const nightArtists = pickTasteArtists(tasteProfile, 'night', 3);
  const morningTracks = pickDailyTasteTrackQueries(tasteProfile, { segmentId: 'morning', date, recentPlays });
  const focusTracks = pickDailyTasteTrackQueries(tasteProfile, { segmentId: 'late-morning', date, recentPlays });
  const afternoonTracks = pickDailyTasteTrackQueries(tasteProfile, { segmentId: 'afternoon', date, recentPlays });
  const eveningTracks = pickDailyTasteTrackQueries(tasteProfile, { segmentId: 'evening', date, recentPlays });
  const nightTracks = pickDailyTasteTrackQueries(tasteProfile, { segmentId: 'night', date, recentPlays });
  const morningStyles = dailyStyleQueries('morning', date);
  const focusStyles = dailyStyleQueries('late-morning', date);
  const afternoonStyles = dailyStyleQueries('afternoon', date);
  const eveningStyles = dailyStyleQueries('evening', date);
  const nightStyles = dailyStyleQueries('night', date);
  const mood = weatherMood(weather);
  const scheduleNote = eventHint(calendar);

  return [
    {
      id: 'morning',
      time: '07:00',
      title: '早安华语电台',
      search: `${chineseTaste} 早晨 温柔`,
      searches: [
        ...morningTracks,
        ...morningStyles,
        ...morningArtists.map((artist) => `${artist} 早晨 温柔`),
        `${chineseTaste} 早晨 温柔`,
        '华语 民谣 早晨',
        '中文 温柔 女声',
        '毛不易 早安'
      ],
      mood: `早晨醒来，${mood}`,
      hostLine: `早上好。${weatherLine(weather)}，我先用一组华语歌把一天轻轻打开。${scheduleNote}`,
      reason: '早晨优先华语、温柔人声和低负担旋律。'
    },
    {
      id: 'late-morning',
      time: '10:00',
      title: '上午专注层',
      search: `${chineseTaste} acoustic lofi focus`,
      searches: [
        ...focusTracks,
        ...focusStyles,
        ...focusArtists.map((artist) => `${artist} acoustic 安静`),
        `${chineseTaste} acoustic lofi focus`,
        '中文 独立 轻音乐',
        '华语 安静 工作',
        'lofi mandopop'
      ],
      mood: '进入工作或学习，少打扰、稳定推进',
      hostLine: '我把电台切到上午专注层。接下来少说话，音乐会更稳一点，不抢你的注意力。',
      reason: '上午降低歌词密度和情绪起伏。'
    },
    {
      id: 'afternoon',
      time: '14:00',
      title: '下午续航',
      search: `${chineseTaste} indie pop city pop`,
      searches: [
        ...afternoonTracks,
        ...afternoonStyles,
        ...afternoonArtists.map((artist) => `${artist} 下午 indie pop`),
        `${chineseTaste} indie pop city pop`,
        '华语 city pop',
        '落日飞车',
        '中文 indie pop 下午'
      ],
      mood: '下午有一点疲惫，需要补能但不炸',
      hostLine: '下午这段我会把亮度调高一点，但不突然吵起来。我们慢慢续航。',
      reason: '下午加入更明亮的节奏和旋律线。'
    },
    {
      id: 'evening',
      time: '19:00',
      title: '晚间散步',
      search: `${chineseTaste} 夜晚 民谣`,
      searches: [
        ...eveningTracks,
        ...eveningStyles,
        ...eveningArtists.map((artist) => `${artist} 夜晚 民谣`),
        `${chineseTaste} 夜晚 民谣`,
        '陈绮贞 夜晚',
        '华语 民谣 晚安',
        '中文 acoustic evening'
      ],
      mood: '从白天抽离，回到自己的节奏',
      hostLine: '晚上好。现在适合把白天放远一点，我来接一段更像散步的歌。',
      reason: '傍晚转为叙事感、空气感和人声陪伴。'
    },
    {
      id: 'night',
      time: '22:30',
      title: '深夜情绪托底',
      search: `${chineseTaste} 深夜 emo 温柔`,
      searches: [
        ...nightTracks,
        ...nightStyles,
        ...nightArtists.map((artist) => `${artist} 深夜 温柔`),
        `${chineseTaste} 深夜 emo 温柔`,
        '华语 emo 深夜',
        '中文 安静 深夜',
        '毛不易 深夜'
      ],
      mood: '夜深，允许低落，但不要坠下去',
      hostLine: '夜深了。接下来我少说，只在换段落时陪你一句，歌会更软一点。',
      reason: '深夜选择低动态、低攻击性、能承接情绪的歌。'
    }
  ];
}

function currentSegment(plan) {
  const now = minutesNow();
  return [...(plan?.segments || [])]
    .reverse()
    .find((segment) => toMinutes(segment.time) <= now) || plan?.segments?.[0];
}

function minutesSince(iso) {
  if (!iso) return Number.POSITIVE_INFINITY;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return Number.POSITIVE_INFINITY;
  return (Date.now() - then) / 60_000;
}

function chatterIntervalMinutes() {
  const hour = new Date().getHours();
  if (hour >= 22 || hour < 2) return 7;
  if (hour < 8) return 12;
  return 15;
}

function shouldChatter(plan, { isPlaying = false } = {}) {
  return isPlaying && minutesSince(plan.lastHostAt) >= chatterIntervalMinutes();
}

function makeChatterLine(segment, { currentSong } = {}) {
  const title = currentSong?.title || '这首歌';
  const artist = currentSong?.artist || '这个声音';
  const album = currentSong?.album ? `，收在《${currentSong.album}》里` : '';
  const songText = currentSong?.title ? `《${title}》 - ${artist}${album}` : '这一段音乐';
  const hour = new Date().getHours();
  const titleSignals = [
    [/雨|rain/i, '雨感'],
    [/晴|sun|光|light/i, '明亮'],
    [/夜|night|midnight|月|moon/i, '夜色'],
    [/爱|love|heart/i, '感情'],
    [/路|北|home|return/i, '路途'],
    [/孤|alone|lonely/i, '孤独']
  ];
  const signal = titleSignals.find(([pattern]) => pattern.test(`${title} ${album}`))?.[1] || '';
  const timeText = hour >= 22 || hour < 2 ? '深夜' : hour < 11 ? '早上' : hour < 18 ? '下午' : '晚上';

  if (signal === '雨感') return `${songText}，名字里有一点潮湿的空气。${timeText}听它，像把外面的声音稍微关小。`;
  if (signal === '明亮') return `${songText} 这个名字有光感，我想把它放在这里，让今天不要一下子太重。`;
  if (signal === '夜色') return `${songText} 很适合${timeText}，标题已经把空间拉暗了一点，情绪不用说破。`;
  if (signal === '感情') return `${songText} 这样的题目容易太满，但现在这版我会听它比较轻的那一面。`;
  if (signal === '路途') return `${songText} 有一种在路上的感觉，适合让思绪往前走一点，不急着抵达。`;
  if (signal === '孤独') return `${songText} 把孤独说得不太响，这种歌适合放在电台里慢慢经过。`;
  if (/keshi|joji|frank ocean|daniel caesar|giveon/i.test(artist)) {
    return `${songText} 这一类声音很会处理距离感，靠近一点，又不把情绪压到你面前。`;
  }
  if (/jay chou|周杰伦|eason|陈奕迅|song dongye|宋冬野|赵雷|陈粒/i.test(artist)) {
    return `${songText} 的重心在人声和叙事上，我会把它放得近一点，像有人在旁边慢慢讲。`;
  }
  return `${songText}。我先不急着解释它，只把这首歌放在${timeText}的这个位置，让你自己听它怎么落下来。`;
}

async function hydrateSegmentSongs(segment, source = 'auto') {
  const candidates = [];
  const seen = new Set();
  const strictSource = source === 'auto' ? 'auto' : `${source}-only`;
  const queries = (segment.searches || [segment.search]).filter((query) => !isWeakSearchQuery(query));
  for (const query of queries) {
    const songs = await searchSongs(query, strictSource);
    for (const song of songs.filter((item) => !isWeakRadioResult(item))) {
      const key = `${song.source}:${song.id || song.title}:${song.artist}`;
      if (!seen.has(key)) {
        seen.add(key);
        candidates.push(song);
      }
    }
    const playableSongs = (await getPlayableSongs(candidates)).filter((item) => !isWeakRadioResult(item));
    if (playableSongs.length >= 8) return playableSongs.slice(0, 8);
  }

  const playableSongs = (await getPlayableSongs(candidates)).filter((item) => !isWeakRadioResult(item));
  if (playableSongs.length) return playableSongs.slice(0, 8);

  if (source === 'spotify') return [];

  const fallbackSongs = await searchSongs(`${segment.id} ${segment.search}`, 'demo');
  const playableFallback = await getPlayableSongs(fallbackSongs);
  return playableFallback.slice(0, 8);
}

export async function getOrCreateDailyPlan({ force = false } = {}) {
  const state = await getState();
  const date = todayKey();
  const tasteProfile = await getImportedTasteProfile();
  const existing = state.plans.find((plan) => plan.date === date && plan.kind === 'daily-radio');
  if (existing && !force && existing.tasteImportedAt === tasteProfile.importedAt && existing.planVersion === RADIO_PLAN_VERSION) return existing;

  const weather = await getWeather(state.preferences.city).catch(() => ({ summary: '天气暂不可用' }));
  const calendar = await getCalendarContext({ days: 1 }).catch(() => ({ events: [], source: 'local' }));
  const segments = buildSegments({
    preferences: state.preferences,
    weather,
    calendar,
    tasteProfile,
    date,
    recentPlays: state.plays.slice(-80)
  });

  const plan = {
    id: crypto.randomUUID(),
    kind: 'daily-radio',
    planVersion: RADIO_PLAN_VERSION,
    date,
    createdAt: new Date().toISOString(),
    tasteImportedAt: tasteProfile.importedAt,
    tasteSummary: {
      totalTracks: tasteProfile.totalTracks,
      topArtists: (tasteProfile.topPrimaryArtists || tasteProfile.topArtists || []).slice(0, 12)
    },
    weather,
    calendar,
    summary: hasWeather(weather)
      ? `今天的电台会围绕${weather.city || '当地'}的${weather.summary}、你的日程和华语偏好来编排。`
      : `今天的电台会先围绕${weather.city || state.preferences.city || '你所在城市'}的时间、你的日程和华语偏好来编排。`,
    segments,
    lastSpokenSegmentId: null,
    lastHostAt: null
  };

  return updateState((draft) => {
    draft.plans = draft.plans.filter((item) => !(item.date === date && item.kind === 'daily-radio'));
    draft.plans.push(plan);
    draft.plans = draft.plans.slice(-14);
    return plan;
  });
}

export async function getTodayPlanWithSongs() {
  const plan = await getOrCreateDailyPlan();
  const active = currentSegment(plan);
  return {
    ...plan,
    activeSegmentId: active?.id || null
  };
}

export async function refreshTodayQueue() {
  const plan = await getOrCreateDailyPlan({ force: true });
  const active = currentSegment(plan);
  const state = await getState();
  const songs = active ? await hydrateSegmentSongs(active, state.preferences?.musicSource || 'auto') : [];
  return {
    plan,
    activeSegmentId: active?.id || null,
    songs
  };
}

export async function radioTick({ force = false, isPlaying = false, currentSong = null } = {}) {
  const plan = await getOrCreateDailyPlan();
  const segment = currentSegment(plan);
  if (!segment) return { events: [], plan };

  const segmentChanged = plan.lastSpokenSegmentId !== segment.id;
  if (!force && segmentChanged && isPlaying && currentSong?.title) {
    return { events: [], plan, activeSegmentId: segment.id };
  }
  const wantsChatter = !force && !segmentChanged && shouldChatter(plan, { isPlaying });
  const shouldSpeak = force || segmentChanged || wantsChatter;
  if (!shouldSpeak) return { events: [], plan, activeSegmentId: segment.id };

  if (wantsChatter) {
    const state = await getState();
    const generatedLine = await generateDjChatter({
      segment,
      currentSong,
      weather: plan.weather,
      recentPlays: state.plays.slice(-10)
    }).catch(() => '');
    const line = generatedLine || makeChatterLine(segment, { currentSong });
    const speech = await synthesizeSpeech(line);
    await addMessage('assistant', line, { action: 'host-chatter', segmentId: segment.id });
    const updatedPlan = await updateState((draft) => {
      const found = draft.plans.find((item) => item.id === plan.id);
      if (found) found.lastHostAt = new Date().toISOString();
      return found || plan;
    });
    return {
      events: [{ type: 'speech', text: line, speech, role: 'host-chatter' }],
      plan: updatedPlan,
      activeSegmentId: segment.id
    };
  }

  const state = await getState();
  const songs = await hydrateSegmentSongs(segment, state.preferences?.musicSource || 'auto');
  const introText = songs[0]
    ? await generateHostIntro({
        segment,
        song: songs[0],
        weather: plan.weather,
        preferences: state.preferences,
        recentPlays: state.plays.slice(-10)
      })
    : segment.hostLine;
  await addMessage('assistant', introText, { action: 'host-intro', segmentId: segment.id, song: songs[0] || null });
  const events = [
    ...await buildHostIntroEvents(introText),
    { type: 'queue', songs },
    ...(songs[0]
      ? [{ type: 'play', song: songs[0] }]
      : [{ type: 'speech', text: '我刚刚没有拿到可播放队列，正在等音乐源恢复。' }])
  ];

  const updatedPlan = await updateState((draft) => {
    const found = draft.plans.find((item) => item.id === plan.id);
    if (found) {
      found.lastSpokenSegmentId = segment.id;
      found.lastHostAt = new Date().toISOString();
    }
    return found || plan;
  });

  return { events, plan: updatedPlan, activeSegmentId: segment.id };
}
