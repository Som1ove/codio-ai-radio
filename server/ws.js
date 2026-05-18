import crypto from 'node:crypto';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function encodeFrame(payload) {
  const data = Buffer.from(JSON.stringify(payload));
  const header = data.length < 126
    ? Buffer.from([0x81, data.length])
    : Buffer.from([0x81, 126, data.length >> 8, data.length & 255]);
  return Buffer.concat([header, data]);
}

function decodeFrame(buffer) {
  const length = buffer[1] & 0x7f;
  const maskStart = length === 126 ? 4 : 2;
  const payloadLength = length === 126 ? buffer.readUInt16BE(2) : length;
  const mask = buffer.subarray(maskStart, maskStart + 4);
  const payload = buffer.subarray(maskStart + 4, maskStart + 4 + payloadLength);
  for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
  return JSON.parse(payload.toString('utf8'));
}

export function createWebSocketHub(server, onMessage) {
  const clients = new Set();

  server.on('upgrade', (req, socket) => {
    if (req.url !== '/ws' && req.url !== '/stream') {
      socket.destroy();
      return;
    }

    const accept = crypto
      .createHash('sha1')
      .update(req.headers['sec-websocket-key'] + GUID)
      .digest('base64');

    socket.write([
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`,
      '',
      ''
    ].join('\r\n'));

    clients.add(socket);
    socket.write(encodeFrame({ type: 'connected', at: new Date().toISOString() }));
    socket.on('data', async (buffer) => {
      try {
        const message = decodeFrame(buffer);
        await onMessage(message, socket);
      } catch (error) {
        socket.write(encodeFrame({ type: 'error', message: error.message }));
      }
    });
    socket.on('close', () => clients.delete(socket));
    socket.on('error', () => clients.delete(socket));
  });

  return {
    broadcast(payload) {
      for (const client of clients) {
        if (!client.destroyed) client.write(encodeFrame(payload));
      }
    }
  };
}
