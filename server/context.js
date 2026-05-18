import { getState } from './state.js';
import { getWeather } from './weather.js';
import { getCalendarContext } from './calendar.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { getSpotifyTasteTracks } from './spotifyPlaylist.js';
import { getImportedTasteProfile } from './taste.js';

async function readText(relativePath, fallback = '') {
  try {
    return await fs.readFile(path.join(config.root, relativePath), 'utf8');
  } catch {
    return fallback;
  }
}

async function readJson(relativePath, fallback = {}) {
  try {
    return JSON.parse(await readText(relativePath, JSON.stringify(fallback)));
  } catch {
    return fallback;
  }
}

async function buildPlaylistTaste(playlists) {
  const sources = Array.isArray(playlists.sources) ? playlists.sources : [];
  const spotifySources = sources.filter((source) => source.type === 'spotify' && (source.id || source.url));
  const imported = [];

  for (const source of spotifySources) {
    const tracks = await getSpotifyTasteTracks(source.id || source.url).catch(() => []);
    imported.push({
      source: 'spotify',
      id: source.id || '',
      url: source.url || '',
      tracks
    });
  }

  return {
    imported,
    tracks: imported.flatMap((item) => item.tracks).slice(0, 300)
  };
}

export async function buildContext(userText) {
  const state = await getState();
  const weather = await getWeather(state.preferences.city).catch((error) => ({
    city: state.preferences.city,
    summary: 'weather unavailable',
    error: error.message
  }));
  const calendar = await getCalendarContext().catch((error) => ({
    source: 'local',
    connected: false,
    error: error.message,
    events: state.schedules.filter((schedule) => schedule.enabled)
  }));

  const recentMessages = state.messages.slice(-12).map((message) => ({
    role: message.role,
    content: message.content
  }));
  const [personaPrompt, userTaste, routines, moodRules, playlists] = await Promise.all([
    readText('prompts/dj-persona.md'),
    readText('user/taste.md'),
    readText('user/routines.md'),
    readText('user/mood-rules.md'),
    readJson('user/playlists.json', {})
  ]);
  const [playlistTaste, importedTaste] = await Promise.all([
    buildPlaylistTaste(playlists),
    getImportedTasteProfile()
  ]);
  const tasteTracks = [
    ...(importedTaste.tracks || []),
    ...(playlistTaste.tracks || [])
  ].slice(0, 500);

  return {
    userText,
    persona: state.persona,
    promptParts: {
      system: personaPrompt,
      userTaste,
      routines,
      moodRules,
      playlists,
      playlistTaste: { ...playlistTaste, importedLibrary: importedTaste, tracks: tasteTracks },
      environment: { weather, calendar, now: new Date().toISOString() },
      memory: { recentMessages, recentPlays: state.plays.slice(-10), preferences: state.preferences },
      execution: { schedules: state.schedules.filter((schedule) => schedule.enabled) }
    },
    preferences: state.preferences,
    weather,
    calendar,
    recentMessages,
    recentPlays: state.plays.slice(-10),
    schedules: state.schedules.filter((schedule) => schedule.enabled)
  };
}
