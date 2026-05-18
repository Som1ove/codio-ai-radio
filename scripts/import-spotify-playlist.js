import fs from 'node:fs/promises';
import path from 'node:path';
import { importSpotifyPlaylist, toTasteTracks } from '../server/spotifyPlaylist.js';

const playlistUrlOrId = process.argv[2] || 'https://open.spotify.com/playlist/1irdLw7wwOWOPBRkZd3B7q';
const root = process.cwd();
const tastePath = path.join(root, 'user', 'taste.md');

function summarizeTracks(tracks) {
  const artistCounts = new Map();
  for (const track of tracks) {
    artistCounts.set(track.artist, (artistCounts.get(track.artist) || 0) + 1);
  }
  const topArtists = [...artistCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([artist, count]) => ({ artist, count }));

  return {
    importedAt: new Date().toISOString(),
    totalTracks: tracks.length,
    topArtists,
    sampleTracks: tracks.slice(0, 40).map((track) => `${track.song} - ${track.artist}`)
  };
}

async function main() {
  const payload = await importSpotifyPlaylist(playlistUrlOrId);
  const tracks = toTasteTracks(payload);
  const summary = summarizeTracks(tracks);

  const tasteAppend = [
    '',
    `## Spotify 导入：${payload.playlistId}`,
    '',
    `- 导入时间：${summary.importedAt}`,
    `- 歌曲数量：${summary.totalTracks}`,
    `- 高频艺人：${summary.topArtists.map((item) => item.artist).join('，') || '暂无'}`,
    `- AI 输入格式：${JSON.stringify(tracks.slice(0, 8))}`,
    `- 样本文件：user/imports/spotify-${payload.playlistId}.json`
  ].join('\n');
  await fs.appendFile(tastePath, `${tasteAppend}\n`);

  console.log(JSON.stringify(tracks, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
