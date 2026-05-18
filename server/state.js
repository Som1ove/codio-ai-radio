import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';

const dataDir = path.join(config.root, 'data');
const dbPath = path.join(dataDir, 'state.db');
const legacyJsonPath = path.join(dataDir, 'state.json');

const initialState = {
  persona: {
    name: 'Codio',
    style: '温暖、克制、有情绪感的深夜电台 DJ，回答简短，懂得根据天气、记忆和听歌历史选歌',
    language: '中文为主，除非用户明确要求其他语言'
  },
  preferences: {
    favoriteGenres: ['华语', 'City Pop'],
    favoriteArtists: [],
    avoidGenres: [],
    voiceEnabled: true,
    city: config.weather.city || '北京',
    musicSource: config.music.source
  },
  messages: [],
  plays: [],
  likes: [],
  dislikes: [],
  plans: [],
  schedules: []
};

let cache;

function normalize(saved = {}) {
  const next = structuredClone(initialState);
  next.persona = { ...next.persona, ...(saved.persona || {}) };
  const legacyPersonaNames = new Set(['Mira', ['Clau', 'dio'].join('')]);
  if (legacyPersonaNames.has(next.persona.name)) next.persona.name = initialState.persona.name;
  if (next.persona.language === 'English unless the user writes another language') {
    next.persona.language = initialState.persona.language;
  }
  if (next.persona.style === 'warm late-night radio host, concise, emotionally aware, musically curious') {
    next.persona.style = initialState.persona.style;
  }
  next.preferences = { ...next.preferences, ...(saved.preferences || {}) };
  if (!next.preferences.favoriteGenres?.length) next.preferences.favoriteGenres = initialState.preferences.favoriteGenres;
  next.messages = Array.isArray(saved.messages)
    ? saved.messages
        .filter((message) => message.role && typeof message.content === 'string')
        .slice(-100)
    : [];
  next.plays = Array.isArray(saved.plays) ? saved.plays.slice(-200) : [];
  next.likes = Array.isArray(saved.likes) ? saved.likes : [];
  next.dislikes = Array.isArray(saved.dislikes) ? saved.dislikes : [];
  next.plans = Array.isArray(saved.plans) ? saved.plans : [];
  next.schedules = Array.isArray(saved.schedules) ? saved.schedules : [];
  return next;
}

async function ensure() {
  await fs.mkdir(dataDir, { recursive: true });
  try {
    let raw;
    try {
      raw = await fs.readFile(dbPath, 'utf8');
    } catch {
      raw = await fs.readFile(legacyJsonPath, 'utf8');
    }
    cache = normalize(JSON.parse(raw));
    await save();
  } catch {
    cache = structuredClone(initialState);
    await save();
  }
}

async function save() {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(dbPath, JSON.stringify(cache, null, 2));
}

export async function getState() {
  if (!cache) await ensure();
  return cache;
}

export async function updateState(mutator) {
  if (!cache) await ensure();
  const result = await mutator(cache);
  await save();
  return result ?? cache;
}

export async function addMessage(role, content, meta = {}) {
  return updateState((state) => {
    const message = { id: crypto.randomUUID(), role, content, meta, at: new Date().toISOString() };
    state.messages.push(message);
    state.messages = state.messages.slice(-100);
    return message;
  });
}

export async function addPlay(song, reason = '') {
  return updateState((state) => {
    const play = { id: crypto.randomUUID(), song, reason, at: new Date().toISOString() };
    state.plays.push(play);
    state.plays = state.plays.slice(-200);
    return play;
  });
}

export async function toggleLike(song) {
  return updateState((state) => {
    const key = [song?.source || '', song?.id || '', song?.title || '', song?.artist || ''].join('::');
    const index = state.likes.findIndex((item) => item.key === key);
    if (index >= 0) {
      state.likes.splice(index, 1);
      return { liked: false, likes: state.likes };
    }
    state.likes.unshift({ key, song, at: new Date().toISOString() });
    state.likes = state.likes.slice(0, 500);
    return { liked: true, likes: state.likes };
  });
}

export async function toggleDislike(song) {
  return updateState((state) => {
    const key = [song?.source || '', song?.id || '', song?.title || '', song?.artist || ''].join('::');
    const index = state.dislikes.findIndex((item) => item.key === key);
    if (index >= 0) {
      state.dislikes.splice(index, 1);
      return { disliked: false, dislikes: state.dislikes };
    }
    state.likes = state.likes.filter((item) => item.key !== key);
    state.dislikes.unshift({ key, song, at: new Date().toISOString() });
    state.dislikes = state.dislikes.slice(0, 500);
    const artist = song?.artist && String(song.artist).split(/\s*(?:,|、|&| and | feat\.| ft\.)\s*/i)[0];
    if (artist && Array.isArray(state.preferences.avoidGenres) && !state.preferences.avoidGenres.includes(artist)) {
      state.preferences.avoidGenres.push(artist);
    }
    return { disliked: true, dislikes: state.dislikes, likes: state.likes, preferences: state.preferences };
  });
}

export async function rememberPreference(key, value) {
  return updateState((state) => {
    if (Array.isArray(state.preferences[key])) {
      if (!state.preferences[key].includes(value)) state.preferences[key].push(value);
    } else {
      state.preferences[key] = value;
    }
    return state.preferences;
  });
}

export async function updatePreferences(values = {}) {
  return updateState((state) => {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) continue;
      state.preferences[key] = value;
    }
    return state.preferences;
  });
}

export async function addSchedule(time, prompt) {
  return updateState((state) => {
    const schedule = {
      id: crypto.randomUUID(),
      time,
      prompt,
      enabled: true,
      lastRunDate: null,
      createdAt: new Date().toISOString()
    };
    state.schedules.push(schedule);
    return schedule;
  });
}
