import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';

const SPOTIFY_LIBRARY_PATH = path.join(config.root, 'user', 'imports', 'spotify-library.json');

function splitArtists(artist = '') {
  return String(artist)
    .split(/\s*(?:,|、|&| and | feat\.| ft\.)\s*/i)
    .map((item) => item.trim())
    .filter(Boolean);
}

function topCounts(items, limit = 32) {
  const counts = new Map();
  for (const item of items.filter(Boolean)) counts.set(item, (counts.get(item) || 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function hashText(text = '') {
  return [...String(text)].reduce((total, char) => ((total * 31) + char.charCodeAt(0)) >>> 0, 7);
}

function rotate(items = [], seed = 0) {
  if (!items.length) return [];
  const offset = seed % items.length;
  return [...items.slice(offset), ...items.slice(0, offset)];
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

export async function getImportedTasteProfile() {
  const library = await readJson(SPOTIFY_LIBRARY_PATH, null);
  const tracks = Array.isArray(library?.tracks) ? library.tracks : [];
  const artistNames = tracks.flatMap((track) => splitArtists(track.artist));
  const primaryArtists = tracks.map((track) => splitArtists(track.artist)[0]).filter(Boolean);

  return {
    source: library?.source || 'none',
    importedAt: library?.importedAt || null,
    totalTracks: tracks.length,
    tracks: tracks.map((track) => ({
      song: track.song,
      artist: track.artist,
      album: track.album || '',
      playlist: track.playlist || ''
    })),
    topArtists: topCounts(artistNames.length ? artistNames : primaryArtists),
    topPrimaryArtists: topCounts(primaryArtists),
    topPlaylists: Array.isArray(library?.taste?.topPlaylists) ? library.taste.topPlaylists : [],
    sample: tracks.slice(0, 80).map((track) => ({ song: track.song, artist: track.artist }))
  };
}

export function getKnownTasteKeys(tasteProfile = {}) {
  const tracks = Array.isArray(tasteProfile.tracks) ? tasteProfile.tracks : [];
  return new Set(tracks.map((track) => `${track.song || ''} ${track.artist || ''}`.toLowerCase()));
}

export function pickTasteArtists(tasteProfile = {}, segmentId = 'morning', limit = 4) {
  const top = (tasteProfile.topPrimaryArtists?.length ? tasteProfile.topPrimaryArtists : tasteProfile.topArtists || [])
    .map((item) => item.name);

  const segmentPatterns = {
    morning: /Jay Chou|周杰伦|Eason|陈奕迅|JJ Lin|林俊杰|Khalil|方大同|David Tao|陶喆|Tanya|蔡健雅|Gareth|毛不易/i,
    'late-morning': /Jay Chou|周杰伦|JJ Lin|林俊杰|Khalil|方大同|David Tao|陶喆|keshi|Gareth|陈奕迅|Eason/i,
    afternoon: /Gareth|keshi|Khalil|方大同|Jay Chou|周杰伦|落日飞车|Sunset Rollercoaster|David Tao|陶喆/i,
    evening: /Eason|陈奕迅|Jay Chou|周杰伦|Khalil|方大同|David Tao|陶喆|Tanya|蔡健雅|Pakho|周柏豪/i,
    night: /Eason|陈奕迅|Jay Chou|周杰伦|keshi|Tanya|蔡健雅|Khalil|方大同|David Tao|陶喆|毛不易/i
  };

  const preferred = top.filter((name) => segmentPatterns[segmentId]?.test(name));
  return unique([...preferred, ...top]).slice(0, limit);
}

export function pickDailyTasteTrackQueries(tasteProfile = {}, { segmentId = 'morning', date = '', recentPlays = [], limit = 6 } = {}) {
  const tracks = Array.isArray(tasteProfile.tracks) ? tasteProfile.tracks : [];
  const topArtistNames = (tasteProfile.topPrimaryArtists || tasteProfile.topArtists || [])
    .slice(0, 32)
    .map((item) => item.name);
  const recentKeys = new Set(
    recentPlays
      .map((play) => `${play.song?.title || ''} ${play.song?.artist || ''}`.toLowerCase())
      .filter(Boolean)
  );
  const segmentPatterns = {
    morning: /jay chou|周杰伦|eason|陈奕迅|jj lin|林俊杰|gareth|khalil|方大同|david tao|陶喆|tanya|蔡健雅/i,
    'late-morning': /jay chou|周杰伦|eason|陈奕迅|jj lin|林俊杰|keshi|khalil|方大同|david tao|陶喆|gareth/i,
    afternoon: /keshi|gareth|khalil|方大同|jay chou|周杰伦|david tao|陶喆|the weeknd|post malone|justin bieber/i,
    evening: /eason|陈奕迅|jay chou|周杰伦|khalil|方大同|david tao|陶喆|pakho|周柏豪|tanya|蔡健雅|stefanie sun/i,
    night: /eason|陈奕迅|keshi|jay chou|周杰伦|tanya|蔡健雅|xxxtentacion|juice wrld|khalil|方大同|david tao|陶喆/i
  };
  const pool = tracks
    .map((track, index) => {
      const key = `${track.song || ''} ${track.artist || ''}`.toLowerCase();
      if (recentKeys.has(key)) return null;
      let score = 0;
      const artistRank = topArtistNames.findIndex((artist) => String(track.artist || '').toLowerCase().includes(artist.toLowerCase()));
      if (artistRank >= 0) score += Math.max(2, 20 - artistRank);
      if (segmentPatterns[segmentId]?.test(track.artist || '')) score += 8;
      if (score > 0 && track.playlist === '小栗心事') score += 5;
      if (score > 0 && track.playlist === '孤独小栗' && (segmentId === 'night' || segmentId === 'evening')) score += 5;
      if (score > 0 && track.playlist === '小栗大王' && segmentId === 'afternoon') score += 4;
      return { track, score, index };
    })
    .filter(Boolean)
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.track);

  return rotate(pool, hashText(`${date}:${segmentId}`))
    .slice(0, limit)
    .map((track) => `${track.song} ${track.artist}`);
}

export function searchTasteTracks(tasteProfile = {}, query = '', limit = 12) {
  const text = String(query || '').toLowerCase();
  const tokens = text
    .split(/[\s,，。！？!?.、]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
  const tracks = Array.isArray(tasteProfile.tracks) ? tasteProfile.tracks : [];
  const languageIntent = /英文|英语|外语|欧美|western|english/.test(text)
    ? 'english'
    : /韩语|韩国|kpop|k-pop|korean/.test(text)
    ? 'korean'
    : /日语|日本|jpop|j-pop|japanese/.test(text)
    ? 'japanese'
    : /粤语|廣東|广东|cantonese/.test(text)
    ? 'cantonese'
    : '';
  const generic = /推荐|来(几|一)?首|放(点|些)?歌|播放音乐|听歌|随便|我爱听|适合我|歌单/.test(text)
    && !/jay chou|周杰伦|eason|陈奕迅|keshi|gareth|jj lin|林俊杰|khalil|方大同|david tao|陶喆|tanya|蔡健雅|rnb|r&b|民谣|city pop|说唱|rap|emo|深夜|早上|下午|晚上|华语|中文|粤语|英文|kpop|hip.?hop/i.test(text);
  const topArtistNames = (tasteProfile.topPrimaryArtists || tasteProfile.topArtists || [])
    .slice(0, 16)
    .map((item) => item.name);

  return tracks
    .map((track, index) => {
      const haystack = `${track.song || ''} ${track.artist || ''} ${track.album || ''} ${track.playlist || ''}`.toLowerCase();
      let score = 0;
      for (const token of tokens) {
        if (haystack.includes(token)) score += token.length;
      }
      if (/深夜|夜晚|emo|难过|低落|安静|温柔/.test(text) && /eason|陈奕迅|keshi|jay chou|周杰伦|tanya|蔡健雅|khalil|方大同/i.test(track.artist || '')) score += 5;
      if (/轻音乐|輕音樂|轻松|放松|舒缓|纯音乐|器乐|ambient|instrumental|chill|lofi/.test(text) && /andrew spacey|kuzu mellow|marconi|lofi|joanna wang|王若琳|房东的猫|陈粒|郭顶|the chairs|椅子乐团/i.test(`${track.artist || ''} ${track.song || ''} ${track.album || ''}`)) score += 10;
      if (/民谣|民謠|folk|acoustic/.test(text) && /赵雷|宋冬野|陈粒|房东的猫|马頔|好妹妹|李健|bon iver|novo amor|ben howard/i.test(track.artist || '')) score += 10;
      if (/摇滚|搖滾|rock|alt rock|indie rock/.test(text) && /万能青年旅店|新裤子|草东|告五人|五月天|radiohead|coldplay|arctic monkeys|the strokes|the 1975/i.test(track.artist || '')) score += 10;
      if (/r&b|rnb|节奏布鲁斯|soul/.test(text) && /khalil|方大同|david tao|陶喆|the crane|9m88|karencici|øzi|ozi|daniel caesar|frank ocean|sza|brent faiyaz|giveon|omar apollo/i.test(track.artist || '')) score += 10;
      if (/city\s*pop|城市流行|citypop/.test(text) && /落日飞车|sunset rollercoaster|椅子乐团|the chairs|甜約翰|宇宙人|mariya takeuchi/i.test(track.artist || '')) score += 10;
      if (/说唱|說唱|rap|hip.?hop|嘻哈/.test(text) && /soft lipa|蛋堡|法老|key.l|刘聪|王以太|满舒克|jid|drake|mac miller|juice wrld|post malone/i.test(track.artist || '')) score += 10;
      if (/早上|早晨|上午|清晨/.test(text) && /jay chou|周杰伦|eason|陈奕迅|jj lin|林俊杰|gareth|khalil|方大同/i.test(track.artist || '')) score += 5;
      if (/下午|提神|续航|city|indie|pop/.test(text) && /keshi|gareth|khalil|方大同|jay chou|周杰伦/i.test(track.artist || '')) score += 5;
      if (/华语|中文|国语/.test(text) && /jay chou|周杰伦|eason|陈奕迅|jj lin|林俊杰|khalil|方大同|david tao|陶喆|tanya|蔡健雅|pakho|周柏豪|g\.e\.m/i.test(track.artist || '')) score += 4;
      if (languageIntent === 'english' && /keshi|the weeknd|post malone|justin bieber|drake|xxxtentacion|juice wrld|jid|rihanna|frank ocean|daniel caesar|giveon|joji|eminem|88rising/i.test(track.artist || '')) score += 12;
      if (languageIntent === 'korean' && /bigbang|newjeans|dean|crush|dpr|bibi|jungkook|taeyeon|exo/i.test(track.artist || '')) score += 12;
      if (languageIntent === 'japanese' && /hikaru utada|utada|宇多田|vaundy|藤井風|kenshi yonezu|aimyon|mariya takeuchi/i.test(track.artist || '')) score += 12;
      if (languageIntent === 'cantonese' && /eason|陈奕迅|hins|张敬轩|gareth|pakho|周柏豪|aga|林家谦|leo ku|古巨基/i.test(track.artist || '')) score += 12;
      if (generic) {
        const artistRank = topArtistNames.findIndex((artist) => String(track.artist || '').toLowerCase().includes(artist.toLowerCase()));
        if (artistRank >= 0) score += Math.max(2, 18 - artistRank);
        if (track.playlist === '小栗心事') score += 3;
      }
      return { track, score, index };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((item) => item.track);
}
