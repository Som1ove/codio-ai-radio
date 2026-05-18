import { spawn } from 'node:child_process';
import path from 'node:path';
import { config } from './config.js';

let child = null;
let status = {
  running: false,
  managed: false,
  baseUrl: config.netease.baseUrl,
  lastError: ''
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getPort() {
  try {
    return new URL(config.netease.baseUrl).port || '80';
  } catch {
    return '3003';
  }
}

export async function pingNetease() {
  if (!config.netease.baseUrl) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1600);
  try {
    const url = new URL(`${config.netease.baseUrl}/search`);
    url.searchParams.set('keywords', 'test');
    url.searchParams.set('limit', '1');
    const response = await fetch(url, { signal: controller.signal });
    status.running = response.ok;
    status.lastError = response.ok ? '' : `HTTP ${response.status}`;
    return response.ok;
  } catch (error) {
    status.running = false;
    status.lastError = error.message;
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function ensureNeteaseService() {
  status.baseUrl = config.netease.baseUrl;
  if (!config.netease.baseUrl) return status;
  if (await pingNetease()) return status;
  if (!config.netease.autoStart || child) return status;

  const appPath = path.join(config.root, 'node_modules', 'NeteaseCloudMusicApi', 'app.js');
  child = spawn(process.execPath, [appPath], {
    cwd: config.root,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: getPort()
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  status.managed = true;

  child.stdout.on('data', () => {});
  child.stderr.on('data', (chunk) => {
    status.lastError = chunk.toString().slice(0, 300);
  });
  child.on('exit', () => {
    child = null;
    status.running = false;
    status.managed = false;
  });

  for (let i = 0; i < 15; i += 1) {
    await sleep(500);
    if (await pingNetease()) return status;
  }
  return status;
}

export function getNeteaseServiceStatus() {
  return { ...status };
}
