// Drives scheduled scans and library refreshes. Intentionally simple
// (setInterval) Phase 1 needs a handful of coarse cadences, not cron
// precision. Two independent timers, or one combined timer when synced

const INTERVALS = {
  off: null,
  hourly: 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

export function isValidSchedule(value) {
  return Object.prototype.hasOwnProperty.call(INTERVALS, value);
}

const label = (s) => (s === '6h' ? 'every 6 hours' : s);

export function createScheduler({ scanner, logger }) {
  let scanTimer = null;
  let refreshTimer = null;
  let comboTimer = null;

  const note = (message, meta) => logger?.scheduler(message, meta ? { meta } : undefined);

  function clearAll() {
    for (const t of [scanTimer, refreshTimer, comboTimer]) {
      if (t) clearInterval(t);
    }
    scanTimer = refreshTimer = comboTimer = null;
  }

  async function runScan(trigger) {
    if (scanner.isRunning()) {
      note(`${trigger} scan skipped a scan is already running`);
      return;
    }
    note(`running ${trigger} scan`);
    try {
      const { queued } = await scanner.scanAll();
      note(`${trigger} scan finished ${queued} item${queued === 1 ? '' : 's'} queued`, { queued });
    } catch (err) {
      logger?.scheduler(`${trigger} scan failed: ${err?.message ?? err}`, { level: 'error' });
    }
  }

  async function runRefresh(trigger) {
    note(`running ${trigger} library refresh`);
    try {
      const { removed } = await scanner.refreshLibrary();
      note(`${trigger} refresh finished ${removed} game${removed === 1 ? '' : 's'} pruned`, { removed });
    } catch (err) {
      logger?.scheduler(`${trigger} refresh failed: ${err?.message ?? err}`, { level: 'error' });
    }
  }

  // Apply a schedule configuration. Accepts the three Setting fields; tolerates
  // a bare string for backwards-compatible callers (treated as the scan cadence).
  function reschedule(config) {
    const cfg = typeof config === 'string' ? { scanSchedule: config } : (config ?? {});
    const scanSchedule = cfg.scanSchedule ?? 'off';
    const refreshSchedule = cfg.refreshSchedule ?? 'off';
    const synced = Boolean(cfg.syncSchedules);

    clearAll();

    if (synced) {
      // One timer on the scanning cadence: refresh first > scan
      const ms = INTERVALS[scanSchedule];
      if (ms) {
        comboTimer = setInterval(async () => {
          await runRefresh('scheduled');
          await runScan('scheduled');
        }, ms);
        if (typeof comboTimer.unref === 'function') comboTimer.unref();
      }
      note(
        ms
          ? `synced schedule active refresh + scan ${label(scanSchedule)}`
          : 'schedules idle (synced, scanning off)',
      );
      return;
    }

    const scanMs = INTERVALS[scanSchedule];
    if (scanMs) {
      scanTimer = setInterval(() => runScan('scheduled'), scanMs);
      if (typeof scanTimer.unref === 'function') scanTimer.unref();
    }
    const refreshMs = INTERVALS[refreshSchedule];
    if (refreshMs) {
      refreshTimer = setInterval(() => runRefresh('scheduled'), refreshMs);
      if (typeof refreshTimer.unref === 'function') refreshTimer.unref();
    }
    note(
      `schedules updated scan: ${scanMs ? label(scanSchedule) : 'off'}, ` +
        `refresh: ${refreshMs ? label(refreshSchedule) : 'off'}`,
    );
  }

  function stop() {
    clearAll();
  }

  return { reschedule, stop };
}

export default createScheduler;
