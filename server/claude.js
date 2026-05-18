import { config } from './config.js';

function fallbackActions(context) {
  const text = context.userText.toLowerCase();
  const actions = [];
  const isLowMood = ['emo', 'down', '难过', '不开心', '低落', '焦虑', '烦', '累'].some((word) => text.includes(word));

  if (/介绍.*(自己|你)|你是谁|你能做什么|讲讲.*codio|codio.*是谁|self intro|introduce yourself/i.test(context.userText)
    && !/推荐|放|播放|来(一|几)?首|听歌|music|song|recommend|play/i.test(context.userText)) {
    return [{
      type: 'say',
      text: '我是 Codio，你的私人 AI 电台主播。我会根据时间、天气、你的日程、最近听歌和收藏偏好来安排歌单，也会在适合的时候像深夜电台一样聊几句。你可以把我当成一个会记住口味、会策展、也会陪你听歌的本地电台。'
    }];
  }

  if (text.includes('weather') || text.includes('天气')) {
    actions.push({
      type: 'say',
      text: `${context.weather.city}现在的天气是${context.weather.summary}${context.weather.temp == null ? '，暂时拿不到实时温度' : `，${context.weather.temp} 度`}。`
    });
  }

  if (text.includes('remember') || text.includes('记住')) {
    actions.push({ type: 'remember', key: 'notes', value: context.userText.replace(/^remember\s*/i, '').replace(/^记住\s*/i, '') });
  }

  if (text.includes('schedule') || text.includes('定时') || text.includes('安排')) {
    actions.push({ type: 'schedule', time: '09:00', prompt: context.userText });
  }

  if (text.includes('play') || text.includes('music') || text.includes('recommend') || text.includes('放') || text.includes('音乐') || text.includes('推荐') || actions.length === 0) {
    actions.push({ type: 'recommend', mood: context.userText });
    actions.unshift({
      type: 'say',
      text: isLowMood
        ? 'Hey，我懂你。有时候情绪会像下午的阴天，说不上为什么，就是有点 down。我先放一首温柔一点的歌，陪你把心慢慢放下来。'
        : '好，我来排一组适合现在氛围的歌，先从你的偏好和可用音乐源里挑。'
    });
  }

  return actions;
}

function systemPrompt(context) {
  return `${context.promptParts?.system || ''}

你是 ${context.persona.name}，一个本地优先的 AI 音乐 DJ。
风格：${context.persona.style}
语言：${context.persona.language}

只返回 JSON，格式如下：
{
  "actions": [
    { "type": "say", "text": "一句简短中文口播" },
    { "type": "recommend", "mood": "搜索关键词或情绪描述" },
    { "type": "play", "query": "歌曲或艺人" },
    { "type": "remember", "key": "favoriteGenres|favoriteArtists|avoidGenres|city|notes", "value": "..." },
    { "type": "weather" },
    { "type": "schedule", "time": "HH:MM", "prompt": "..." },
    { "type": "reason", "text": "简短原因" },
    { "type": "segue", "text": "一句转场词" }
  ]
}

上下文：
用户语料：${context.promptParts?.userTaste || ''}
日常例程：${context.promptParts?.routines || ''}
情绪规则：${context.promptParts?.moodRules || ''}
播放清单：${JSON.stringify(context.promptParts?.playlists || {})}
Spotify 歌单品味样本，格式为 [{song, artist}]：${JSON.stringify((context.promptParts?.playlistTaste?.tracks || []).slice(0, 120))}
天气：${JSON.stringify(context.weather)}
偏好：${JSON.stringify(context.preferences)}
最近播放：${JSON.stringify(context.recentPlays)}
日程：${JSON.stringify(context.calendar?.events || context.schedules)}`;
}

function parseActions(raw, context) {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.actions)) return parsed.actions;
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed.actions)) return parsed.actions;
      } catch {
        // fall through to local heuristic
      }
    }
  }
  return fallbackActions(context);
}

export async function callLLM(context) {
  if (!config.llm.apiKey) return fallbackActions(context);

  const response = await fetch(`${config.llm.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.llm.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: config.llm.model,
      temperature: 0.7,
      messages: [
        { role: 'system', content: systemPrompt(context) },
        ...context.recentMessages,
        { role: 'user', content: context.userText }
      ]
    })
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`LLM request failed: ${response.status} ${detail}`);
  }
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';
  return parseActions(content, context);
}

export async function generateDjChatter({ segment, currentSong, weather, recentPlays = [] } = {}) {
  if (!config.llm.apiKey || !currentSong?.title) return '';

  const response = await fetch(`${config.llm.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.llm.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: config.llm.model,
      temperature: 0.86,
      messages: [
        {
          role: 'system',
          content: [
            '你是 Codio，一个中文深夜电台主播。',
            '请根据当前歌曲本身生成一段自然口播，不要套模板，不要说“我会让它多留一点尾音”。',
            '必须具体提到这首歌的歌名或歌手，可以根据歌名、歌手、专辑、时段、天气做温柔推断。',
            '不要编造歌曲事实、创作背景或歌词；如果不知道，就聊听感、标题意象、此刻情绪。',
            '长度 35 到 90 个中文字符，像真实电台 DJ 随口说的一句。只输出口播文本。'
          ].join('\n')
        },
        {
          role: 'user',
          content: JSON.stringify({
            song: {
              title: currentSong.title,
              artist: currentSong.artist,
              album: currentSong.album || '',
              source: currentSong.source || ''
            },
            segment: {
              id: segment?.id,
              title: segment?.title,
              mood: segment?.mood,
              reason: segment?.reason
            },
            weather,
            recentPlays: recentPlays.slice(-5).map((play) => ({
              title: play.song?.title,
              artist: play.song?.artist
            }))
          })
        }
      ]
    })
  });

  if (!response.ok) return '';
  const data = await response.json();
  return (data.choices?.[0]?.message?.content || '').trim().replace(/^["“]|["”]$/g, '');
}

function formatList(items = []) {
  return items.filter(Boolean).join(' / ') || '未知';
}

export function buildHostIntroFallback({ segment, song, weather } = {}) {
  const title = song?.title || '这首歌';
  const artist = song?.artist || '这位音乐人';
  const slotTitle = segment?.title || '当前时段';
  const mood = segment?.mood || segment?.reason || '现在的状态';
  const reason = song?.playbackNote || segment?.reason || '它和这个时段的气质贴得比较近';
  const weatherText = weather?.summary && !/不可用/.test(weather.summary)
    ? `外面是${weather.summary}${weather.temp == null ? '' : `，${weather.temp} 度`}`
    : '我先按你的时间和最近口味来接歌';
  return `接下来播放《${title}》，${artist}。我把它放在「${slotTitle}」，是因为${reason}，也能接住${mood}。${weatherText}，这首歌会让电台稍微靠近一点。从听感上看，我不去编它的故事，只听它的标题、声音和此刻的位置：它适合慢慢进入，而不是突然闯进来。`;
}

export async function generateHostIntro({ segment, song, weather, preferences = {}, recentPlays = [] } = {}) {
  const fallback = buildHostIntroFallback({ segment, song, weather });
  if (!config.llm.apiKey || !song?.title) return fallback;

  const response = await fetch(`${config.llm.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.llm.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: config.llm.model,
      temperature: 0.62,
      messages: [
        {
          role: 'system',
          content: [
            '你是 Codio，一个私人 AI 电台主播，不是普通聊天助手。',
            '写一段播放前口播，必须像电台主播在真正介绍下一首歌。',
            '严格使用给定上下文，不要编造发行年份、专辑事实、歌词、创作背景、合作人或真实八卦。',
            '如果不知道真实背景，就用“从听感上看”“从这首歌的气质看”来表达推断。',
            '必须包含：歌名/歌手、为什么现在播、和当前时段/天气/用户口味的关系、这首歌的听感画面。',
            '中文，4 句以内，90 到 170 个中文字符。不要 Markdown，不要 emoji，不要舞台指令。'
          ].join('\n')
        },
        {
          role: 'user',
          content: JSON.stringify({
            song: {
              title: song.title,
              artist: song.artist,
              album: song.album || '',
              source: song.source || '',
              playbackNote: song.playbackNote || ''
            },
            slot: {
              id: segment?.id,
              title: segment?.title,
              time: segment?.time,
              mood: segment?.mood,
              reason: segment?.reason,
              hostLine: segment?.hostLine
            },
            weather,
            preferences: {
              favoriteGenres: preferences.favoriteGenres || [],
              favoriteArtists: preferences.favoriteArtists || [],
              avoidGenres: preferences.avoidGenres || []
            },
            recentPlays: recentPlays.slice(-6).map((play) => ({
              title: play.song?.title,
              artist: play.song?.artist
            })),
            instruction: `写给下一首歌的播放前口播。用户偏好关键词：${formatList([...(preferences.favoriteGenres || []), ...(preferences.favoriteArtists || [])].slice(0, 10))}`
          })
        }
      ]
    })
  }).catch(() => null);

  if (!response?.ok) return fallback;
  const data = await response.json().catch(() => null);
  return (data?.choices?.[0]?.message?.content || fallback).trim().replace(/^["“]|["”]$/g, '');
}
