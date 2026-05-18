import fs from 'node:fs/promises';
import path from 'node:path';

const inputPath = process.argv[2] || '/Users/som1ove/Downloads/My Spotify Library.csv';
const root = process.cwd();
const outPath = path.join(root, 'user', 'imports', 'spotify-library.json');
const tastePath = path.join(root, 'user', 'taste.md');

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function topCounts(items, limit = 24) {
  const counts = new Map();
  for (const item of items.filter(Boolean)) counts.set(item, (counts.get(item) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([name, count]) => ({ name, count }));
}

function splitArtists(artist = '') {
  return String(artist)
    .split(/\s*(?:,|、|&| and | feat\.| ft\.)\s*/i)
    .map((item) => item.trim())
    .filter(Boolean);
}

async function main() {
  const raw = await fs.readFile(inputPath, 'utf8');
  const rows = parseCsv(raw.replace(/^\uFEFF/, ''));
  const headers = rows[0].map((header) => header.trim());
  const index = Object.fromEntries(headers.map((header, i) => [header, i]));

  const tracks = rows.slice(1)
    .map((row) => ({
      song: row[index['Track name']]?.trim() || '',
      artist: row[index['Artist name']]?.trim() || '',
      album: row[index.Album]?.trim() || '',
      playlist: row[index['Playlist name']]?.trim() || '',
      spotifyId: row[index['Spotify - id']]?.trim() || '',
      isrc: row[index.ISRC]?.trim() || ''
    }))
    .filter((track) => track.song && track.artist);

  const payload = {
    source: 'spotify-library-csv',
    importedAt: new Date().toISOString(),
    inputPath,
    totalTracks: tracks.length,
    tracks,
    taste: {
      topArtists: topCounts(tracks.flatMap((track) => splitArtists(track.artist))),
      topPrimaryArtists: topCounts(tracks.map((track) => splitArtists(track.artist)[0])),
      topPlaylists: topCounts(tracks.map((track) => track.playlist)),
      sample: tracks.slice(0, 60).map((track) => ({ song: track.song, artist: track.artist }))
    }
  };

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(payload, null, 2));

  const tasteBlock = [
    '',
    '## Spotify Library CSV 导入',
    '',
    `- 导入时间：${payload.importedAt}`,
    `- 歌曲数量：${payload.totalTracks}`,
    `- 高频艺人：${payload.taste.topArtists.slice(0, 12).map((item) => `${item.name}(${item.count})`).join('，')}`,
    `- 主要歌单：${payload.taste.topPlaylists.slice(0, 8).map((item) => `${item.name}(${item.count})`).join('，')}`,
    '- Codio 使用方式：把 `user/imports/spotify-library.json` 中的 `tracks` 当作长期品味样本，推荐时优先学习这些歌曲的艺人、语种、年代、能量和情绪。'
  ].join('\n');
  const currentTaste = await fs.readFile(tastePath, 'utf8').catch(() => '');
  const cleanedTaste = currentTaste.replace(/\n## Spotify Library CSV 导入[\s\S]*?(?=\n## |\n?$)/g, '').trimEnd();
  await fs.writeFile(tastePath, `${cleanedTaste}${tasteBlock}\n`);

  console.log(JSON.stringify({
    saved: outPath,
    totalTracks: payload.totalTracks,
    topArtists: payload.taste.topArtists.slice(0, 10)
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
