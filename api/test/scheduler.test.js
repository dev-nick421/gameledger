import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createScheduler, isValidSchedule } from '../src/services/scheduler.js';

// A logger stub that records messages without touching a DB.
function fakeLogger() {
  const entries = [];
  return {
    entries,
    scheduler: (message, opts) => entries.push({ message, ...opts }),
  };
}

describe('scheduler', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('validates schedule vocabulary', () => {
    expect(isValidSchedule('daily')).toBe(true);
    expect(isValidSchedule('6h')).toBe(true);
    expect(isValidSchedule('off')).toBe(true);
    expect(isValidSchedule('yearly')).toBe(false);
  });

  it('runs an hourly scan on its own timer', async () => {
    const scanner = { isRunning: () => false, scanAll: vi.fn().mockResolvedValue({ queued: 2 }), refreshLibrary: vi.fn() };
    const scheduler = createScheduler({ scanner, logger: fakeLogger() });
    scheduler.reschedule({ scanSchedule: 'hourly', refreshSchedule: 'off', syncSchedules: false });

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(scanner.scanAll).toHaveBeenCalledTimes(1);
    expect(scanner.refreshLibrary).not.toHaveBeenCalled();
    scheduler.stop();
  });

  it('runs scan and refresh on independent timers', async () => {
    const scanner = { isRunning: () => false, scanAll: vi.fn().mockResolvedValue({ queued: 0 }), refreshLibrary: vi.fn().mockResolvedValue({ removed: 0 }) };
    const scheduler = createScheduler({ scanner, logger: fakeLogger() });
    scheduler.reschedule({ scanSchedule: 'hourly', refreshSchedule: 'daily', syncSchedules: false });

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000); // 1h: scan only
    expect(scanner.scanAll).toHaveBeenCalledTimes(1);
    expect(scanner.refreshLibrary).toHaveBeenCalledTimes(0);

    await vi.advanceTimersByTimeAsync(23 * 60 * 60 * 1000); // reach 24h: refresh fires
    expect(scanner.refreshLibrary).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });

  it('when synced, runs refresh before scan on the scan cadence', async () => {
    const order = [];
    const scanner = {
      isRunning: () => false,
      scanAll: vi.fn().mockImplementation(async () => { order.push('scan'); return { queued: 1 }; }),
      refreshLibrary: vi.fn().mockImplementation(async () => { order.push('refresh'); return { removed: 0 }; }),
    };
    const scheduler = createScheduler({ scanner, logger: fakeLogger() });
    scheduler.reschedule({ scanSchedule: 'hourly', refreshSchedule: 'daily', syncSchedules: true });

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(order).toEqual(['refresh', 'scan']);
    scheduler.stop();
  });

  it('does not start a scan when one is already running', async () => {
    const scanner = { isRunning: () => true, scanAll: vi.fn(), refreshLibrary: vi.fn() };
    const scheduler = createScheduler({ scanner, logger: fakeLogger() });
    scheduler.reschedule({ scanSchedule: 'hourly' });

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(scanner.scanAll).not.toHaveBeenCalled();
    scheduler.stop();
  });
});
