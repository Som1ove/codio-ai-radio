import { config } from './config.js';

function browserFallback(text, note = '将使用浏览器内置语音朗读。配置云端 TTS 后可生成语音音频。') {
  return { text, audioUrl: null, source: 'browser', note };
}

function audioResponse(text, arrayBuffer, source) {
  const base64 = Buffer.from(arrayBuffer).toString('base64');
  return { text, audioUrl: `data:audio/mpeg;base64,${base64}`, source };
}

async function synthesizeFish(text) {
  const response = await fetch('https://api.fish.audio/v1/tts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.fish.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      text,
      reference_id: config.fish.voiceId,
      format: 'mp3'
    })
  });

  if (!response.ok) throw new Error(`Fish Audio failed: ${response.status}`);
  return audioResponse(text, await response.arrayBuffer(), 'fish');
}

async function synthesizeXiaomi(text) {
  const endpoint = config.xiaomi.ttsEndpoint.replace(/\/$/, '');
  const url = endpoint.endsWith('/chat/completions') ? endpoint : `${endpoint}/chat/completions`;
  const voice = config.xiaomi.voice || 'mimo_default';
  const format = 'mp3';
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.xiaomi.apiKey}`,
      'api-key': config.xiaomi.apiKey,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg, application/json'
    },
    body: JSON.stringify({
      model: config.xiaomi.model,
      messages: [
        {
          role: 'assistant',
          content: text
        }
      ],
      audio: {
        voice,
        format
      },
      tts: {
        speaker: voice,
        audio_type: 'URL',
        codec: format.toUpperCase(),
        emotion: {
          category: 'WARM',
          level: 'LOW'
        }
      }
    })
  });

  if (!response.ok) throw new Error(`Xiaomi TTS failed: ${response.status}`);

  const contentType = response.headers.get('content-type') || '';
  if (/audio|mpeg|octet-stream/i.test(contentType)) {
    return audioResponse(text, await response.arrayBuffer(), 'xiaomi');
  }

  const payload = await response.json();
  const messageAudio = payload.choices?.[0]?.message?.audio || payload.choices?.[0]?.delta?.audio;
  const audioPayload = payload.audio || payload.data?.audio || messageAudio || payload;
  if (audioPayload.audioUrl || audioPayload.audio_url || audioPayload.url) {
    return { text, audioUrl: audioPayload.audioUrl || audioPayload.audio_url || audioPayload.url, source: 'xiaomi' };
  }
  const base64 = audioPayload.audio || audioPayload.audioBase64 || audioPayload.audio_base64 || audioPayload.data || audioPayload.b64_json;
  if (base64) return { text, audioUrl: `data:audio/mpeg;base64,${base64}`, source: 'xiaomi' };

  throw new Error('Xiaomi TTS response did not include audio.');
}

export async function synthesizeSpeech(text) {
  const provider = config.tts.provider;

  if ((provider === 'xiaomi' || provider === 'auto') && config.xiaomi.ttsEndpoint && config.xiaomi.apiKey) {
    try {
      return await synthesizeXiaomi(text);
    } catch (error) {
      if (provider === 'xiaomi') return browserFallback(text, `小米 TTS 暂时失败：${error.message}`);
    }
  }

  if ((provider === 'fish' || provider === 'auto') && config.fish.apiKey && config.fish.voiceId) {
    try {
      return await synthesizeFish(text);
    } catch (error) {
      if (provider === 'fish') return browserFallback(text, `Fish Audio 暂时失败：${error.message}`);
    }
  }

  return browserFallback(text);
}
