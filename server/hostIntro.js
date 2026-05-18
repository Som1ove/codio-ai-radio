import { synthesizeSpeech } from './tts.js';

export function splitHostIntro(text = '') {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  const sentences = normalized.match(/[^。！？!?]+[。！？!?]?/g)?.map((item) => item.trim()).filter(Boolean) || [normalized];
  const parts = [];
  let buffer = '';

  for (const sentence of sentences) {
    const next = buffer ? `${buffer}${sentence}` : sentence;
    if (next.length >= 42 || parts.length >= 2) {
      parts.push(next);
      buffer = '';
    } else {
      buffer = next;
    }
  }
  if (buffer) parts.push(buffer);

  if (parts.length <= 3) return parts;
  return [parts[0], parts[1], parts.slice(2).join('')];
}

export async function buildHostIntroEvents(text, extra = {}) {
  const parts = splitHostIntro(text);
  const events = [];
  for (const [index, part] of parts.entries()) {
    events.push({
      type: 'speech',
      text: part,
      speech: await synthesizeSpeech(part),
      role: 'host-intro',
      introPart: index + 1,
      introTotal: parts.length,
      ...extra
    });
  }
  return events;
}
