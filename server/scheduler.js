import { getState, updateState } from './state.js';
import { radioTick } from './curator.js';

function today() {
  return new Date().toISOString().slice(0, 10);
}

function currentHHMM() {
  return new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date());
}

export function startScheduler({ broadcast, runCommand }) {
  const tick = async () => {
    const state = await getState();
    const now = currentHHMM();
    const date = today();

    for (const schedule of state.schedules.filter((item) => item.enabled)) {
      if (schedule.time === now && schedule.lastRunDate !== date) {
        await updateState((draft) => {
          const found = draft.schedules.find((item) => item.id === schedule.id);
          if (found) found.lastRunDate = date;
        });
        broadcast({ type: 'schedule-fired', schedule });
        const result = await runCommand(schedule.prompt);
        broadcast({ type: 'command-result', result });
      }
    }

    const radio = await radioTick();
    if (radio.events?.length) broadcast({ type: 'command-result', result: radio });
  };

  const id = setInterval(() => tick().catch((error) => broadcast({ type: 'error', message: error.message })), 30_000);
  tick().catch(() => {});
  return () => clearInterval(id);
}
