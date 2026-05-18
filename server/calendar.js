import { config } from './config.js';
import { getState } from './state.js';

function toUnixSeconds(date) {
  return Math.floor(date.getTime() / 1000);
}

function formatLocalEvent(schedule) {
  return {
    id: schedule.id,
    title: schedule.prompt || '本地音乐日程',
    start: schedule.time,
    end: '',
    source: 'local',
    enabled: schedule.enabled !== false
  };
}

async function getFeishuEvents({ days = 2 } = {}) {
  if (!config.feishu.userAccessToken) return [];

  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + days);

  const calendarId = encodeURIComponent(config.feishu.calendarId || 'primary');
  const url = new URL(`https://open.feishu.cn/open-apis/calendar/v4/calendars/${calendarId}/events`);
  url.searchParams.set('start_time', String(toUnixSeconds(start)));
  url.searchParams.set('end_time', String(toUnixSeconds(end)));
  url.searchParams.set('page_size', '20');

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${config.feishu.userAccessToken}`,
      'Content-Type': 'application/json; charset=utf-8'
    }
  });
  if (!response.ok) throw new Error(`Feishu calendar failed: ${response.status}`);

  const data = await response.json();
  if (data.code && data.code !== 0) throw new Error(data.msg || `Feishu calendar code ${data.code}`);

  return (data.data?.items || []).map((event) => ({
    id: event.event_id,
    title: event.summary || '未命名日程',
    start: event.start_time?.timestamp || event.start_time?.date || '',
    end: event.end_time?.timestamp || event.end_time?.date || '',
    source: 'feishu'
  }));
}

export async function getCalendarContext(options = {}) {
  const state = await getState();
  const local = state.schedules.filter((schedule) => schedule.enabled !== false).map(formatLocalEvent);

  try {
    const feishu = await getFeishuEvents(options);
    return {
      source: config.feishu.userAccessToken ? 'feishu' : 'local',
      connected: Boolean(config.feishu.userAccessToken),
      events: [...feishu, ...local].slice(0, 24),
      localSchedules: local
    };
  } catch (error) {
    return {
      source: 'local',
      connected: false,
      error: error.message,
      events: local,
      localSchedules: local
    };
  }
}
