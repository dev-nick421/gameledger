<script setup>
import { ref, computed } from 'vue';
import { useSettingsStore } from '../../stores/settings.js';

// Two independent schedules scanning and refreshing with an option to run
// them together on the scanning cadence (refresh first, then scan)
const settings = useSettingsStore();
const message = ref(null);
const error = ref(null);

const CADENCES = [
  { value: 'off', label: 'Off' },
  { value: 'hourly', label: 'Every hour' },
  { value: '6h', label: 'Every 6 hours' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
];

const synced = computed({
  get: () => settings.syncSchedules,
  set: (v) => (settings.syncSchedules = v),
});

async function save() {
  message.value = null;
  error.value = null;
  try {
    await settings.save({
      scanSchedule: settings.scanSchedule,
      refreshSchedule: settings.refreshSchedule,
      syncSchedules: settings.syncSchedules,
    });
    message.value = 'Scheduler updated.';
  } catch (err) {
    error.value = err.response?.data?.error || 'Failed to save scheduler.';
  }
}
</script>

<template>
  <div class="space-y-4">
    <!-- Scanning schedule -->
    <section class="card p-5">
      <h2 class="flex items-center gap-2 text-lg font-semibold">
        <svg class="h-5 w-5 text-shelf-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
          <line x1="7" y1="12" x2="17" y2="12" />
        </svg>
        Scan library
      </h2>
      <p class="mb-3 mt-1 text-sm text-gray-500">
        How often to look for new games in your library paths and process them.
      </p>
      <select v-model="settings.scanSchedule" class="input max-w-xs">
        <option v-for="c in CADENCES" :key="c.value" :value="c.value">{{ c.label }}</option>
      </select>
    </section>

    <!-- Refresh schedule -->
    <section class="card p-5" :class="{ 'opacity-60': synced }">
      <h2 class="flex items-center gap-2 text-lg font-semibold">
        <svg class="h-5 w-5 text-shelf-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M23 4v6h-6M1 20v-6h6" />
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
        </svg>
        Refresh library
      </h2>
      <p class="mb-3 mt-1 text-sm text-gray-500">
        How often to reconcile the catalogue with disk, pruning games whose files
        were removed.
      </p>
      <select
        v-model="settings.refreshSchedule"
        class="input max-w-xs"
        :disabled="synced"
      >
        <option v-for="c in CADENCES" :key="c.value" :value="c.value">{{ c.label }}</option>
      </select>
      <p v-if="synced" class="mt-2 text-xs text-gray-400">
        Controlled by the scanning schedule while “Run both together” is on.
      </p>
    </section>

    <!-- Sync option -->
    <section class="card p-5">
      <label class="flex cursor-pointer items-start gap-3">
        <input v-model="synced" type="checkbox" class="mt-0.5 h-4 w-4 rounded" />
        <span>
          <span class="text-sm font-medium">Run both together</span>
          <span class="mt-0.5 block text-xs text-gray-500">
            Use a single timer on the scanning schedule. Each run refreshes the
            library first, then scans immediately after.
          </span>
        </span>
      </label>
    </section>

    <div class="flex items-center gap-3">
      <button class="btn-primary" @click="save">Save scheduler</button>
      <span v-if="message" class="text-sm text-emerald-600 dark:text-emerald-400">{{ message }}</span>
      <span v-if="error" class="text-sm text-red-600 dark:text-red-400">{{ error }}</span>
    </div>
  </div>
</template>
