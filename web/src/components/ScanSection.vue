<script setup>
import { ref, onMounted, onUnmounted, computed, watch } from 'vue';
import client from '../api/client.js';
import { useJobsStore } from '../stores/jobs.js';
import { useToastStore } from '../stores/toast.js';

// Library scanning, embedded as a section of the Settings page
const jobsStore = useJobsStore();
const toast = useToastStore();
const queue = ref({ running: [], pending: [], failed: [], completed: [], isRunning: false });
const loaded = ref(false);

// Live per-job progress comes from the app-level WebSocket via the store. Jobs
// that have finished drop out of the live list once the queue catches up.
const failedIds = computed(() => new Set(queue.value.failed.map((j) => String(j.id))));
const liveJobs = computed(() =>
  Object.values(jobsStore.live).filter((j) => j.status !== 'completed' && j.status !== 'failed' && !failedIds.value.has(String(j.jobId))),
);
const busy = computed(() => queue.value.running.length > 0 || queue.value.pending.length > 0);

async function loadQueue() {
  try {
    const { data } = await client.get('/queue');
    queue.value = data;
  } finally {
    loaded.value = true;
  }
}

async function startScan() {
  try {
    await client.post('/scan');
    toast.push('Scan started.', 'ok');
    await loadQueue();
  } catch (err) {
    if (err.response?.status === 409) toast.push('A scan is already in progress.', 'warn');
    else toast.push('Failed to start the scan.', 'error');
  }
}

async function cancelScan() {
  try {
    const { data } = await client.delete('/queue');
    toast.push(`Cancelled ${data.cancelled} job${data.cancelled === 1 ? '' : 's'}.`, 'ok');
    jobsStore.clear();
    await loadQueue();
  } catch {
    toast.push('Failed to cancel the scan.', 'error');
  }
}

const refreshing = ref(false);
async function refreshLibrary() {
  refreshing.value = true;
  try {
    const { data } = await client.post('/library/refresh');
    toast.push(
      data.removed
        ? `Removed ${data.removed} missing game${data.removed === 1 ? '' : 's'} from the library.`
        : 'Library is already in sync with disk.',
      'ok',
    );
  } catch {
    toast.push('Failed to refresh the library.', 'error');
  } finally {
    refreshing.value = false;
  }
}

async function retry(job) {
  try {
    await client.post(`/queue/${job.id}/retry`);
    toast.push(`Retrying “${job.sourceName}”…`, 'info');
  } catch (err) {
    if (err.response?.status === 409) toast.push('Wait for the current scan to finish first.', 'warn');
    else toast.push('Failed to retry the job.', 'error');
  }
}

// Dismiss a failed job. Its folder is untouched, so the next scan simply picks
// it up again.
async function clearJob(job) {
  try {
    await client.delete(`/queue/${job.id}`);
    jobsStore.remove(job.id);
    queue.value.failed = queue.value.failed.filter((j) => j.id !== job.id);
  } catch {
    toast.push('Failed to clear the job.', 'error');
  }
}

async function clearFailed() {
  try {
    const ids = queue.value.failed.map((j) => j.id);
    const { data } = await client.delete('/queue/failed');
    jobsStore.remove(...ids);
    toast.push(`Cleared ${data.cleared} failed job${data.cleared === 1 ? '' : 's'}.`, 'ok');
    await loadQueue();
  } catch {
    toast.push('Failed to clear the failed jobs.', 'error');
  }
}

// Refresh queue counts whenever a job event arrives.
let refreshTimer = null;
watch(
  () => jobsStore.live,
  () => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(loadQueue, 500);
  },
  { deep: true },
);

onMounted(loadQueue);
onUnmounted(() => clearTimeout(refreshTimer));
</script>

<template>
  <section class="card p-5">
    <div class="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 class="section-title">
          Library scanning
          <span v-if="busy" class="badge bg-shelf-accent/10 text-shelf-accent">
            <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-current"></span>
            Running
          </span>
        </h2>
        <p class="section-desc">Find new games in your library paths, match them and package them for download.</p>
      </div>
      <div class="flex gap-2">
        <button v-if="busy" class="btn-ghost" @click="cancelScan">
          <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
          Cancel scan
        </button>
        <button class="btn-primary" @click="startScan">
          <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
            <line x1="7" y1="12" x2="17" y2="12" />
          </svg>
          Scan Library
        </button>
      </div>
    </div>

    <!-- Live progress (persists across navigation via jobs store) -->
    <div v-if="liveJobs.length === 0" class="flex items-center gap-3 rounded-lg border border-dashed border-gray-200 px-4 py-5 text-sm text-gray-500 dark:border-shelf-border dark:text-gray-400">
      <svg class="h-5 w-5 shrink-0 text-gray-300 dark:text-shelf-border" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>
      No active jobs. Start a scan to see live progress here.
    </div>
    <ul v-else class="space-y-2">
      <li
        v-for="job in liveJobs"
        :key="job.jobId"
        class="rounded-lg border border-gray-100 px-4 py-3 dark:border-shelf-border/70"
      >
        <div class="flex items-center justify-between gap-3 text-sm">
          <span class="min-w-0 truncate font-medium">{{ job.sourceName }}</span>
          <span class="shrink-0 text-xs text-gray-500 dark:text-gray-400">{{ job.stage }} · {{ job.progress || 0 }}%</span>
        </div>
        <div class="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-shelf-elevated">
          <div
            class="h-full rounded-full bg-gradient-to-r from-[#e84bd0] to-[#9b5cf6] transition-all"
            :style="{ width: `${job.progress || 0}%` }"
          ></div>
        </div>
      </li>
    </ul>

    <!-- Queue -->
    <div class="mt-5 grid gap-3 sm:grid-cols-3">
      <div class="rounded-lg bg-gray-50 p-3.5 dark:bg-black/15">
        <h3 class="mb-2 flex items-center gap-1.5 text-sm font-semibold">
          <svg class="h-4 w-4 text-shelf-accent" :class="{ 'animate-spin': queue.running.length }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
          Running
          <span class="ml-auto text-xs font-medium text-gray-400">{{ queue.running.length }}</span>
        </h3>
        <p v-if="!queue.running.length" class="text-xs text-gray-400">None</p>
        <ul class="space-y-1 text-sm">
          <li v-for="j in queue.running" :key="j.id" class="truncate">{{ j.sourceName }} <span class="text-gray-400">· {{ j.stage }}</span></li>
        </ul>
      </div>
      <div class="rounded-lg bg-gray-50 p-3.5 dark:bg-black/15">
        <h3 class="mb-2 flex items-center gap-1.5 text-sm font-semibold">
          <svg class="h-4 w-4 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 14" />
          </svg>
          Pending
          <span class="ml-auto text-xs font-medium text-gray-400">{{ queue.pending.length }}</span>
        </h3>
        <p v-if="!queue.pending.length" class="text-xs text-gray-400">None</p>
        <ul class="space-y-1 text-sm">
          <li v-for="j in queue.pending" :key="j.id" class="truncate">{{ j.sourceName }}</li>
        </ul>
      </div>
      <div class="rounded-lg bg-gray-50 p-3.5 dark:bg-black/15">
        <h3 class="mb-2 flex items-center gap-1.5 text-sm font-semibold">
          <svg class="h-4 w-4 text-red-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="9" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          Failed
          <span class="ml-auto text-xs font-medium text-gray-400">{{ queue.failed.length }}</span>
          <button
            v-if="queue.failed.length > 1"
            v-tooltip="'Dismiss every failed job. Their folders stay put and are picked up again on the next scan.'"
            class="-my-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-gray-500 transition hover:bg-gray-200 hover:text-gray-900 dark:hover:bg-shelf-elevated dark:hover:text-gray-100"
            @click="clearFailed"
          >
            Clear all
          </button>
        </h3>
        <p v-if="!queue.failed.length" class="text-xs text-gray-400">None</p>
        <ul class="space-y-1 text-sm">
          <li v-for="j in queue.failed" :key="j.id" class="group flex items-center gap-1">
            <span v-tooltip="j.error || 'Failed'" class="min-w-0 flex-1 truncate" tabindex="0">{{ j.sourceName }}</span>
            <button
              v-tooltip="'Retry'"
              class="icon-btn !h-7 !w-7 hover:!text-shelf-accent"
              :aria-label="`Retry ${j.sourceName}`"
              @click="retry(j)"
            >
              <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M23 4v6h-6M1 20v-6h6" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
            </button>
            <button
              v-tooltip="'Dismiss'"
              class="icon-btn !h-7 !w-7 hover:!text-red-500"
              :aria-label="`Dismiss ${j.sourceName}`"
              @click="clearJob(j)"
            >
              <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </li>
        </ul>
      </div>
    </div>
  </section>

  <!-- Refresh: reconcile the catalogue with what's actually on disk -->
  <section class="card mt-4 p-5">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div class="min-w-0 flex-1">
        <h2 class="section-title">
          <svg class="h-5 w-5 text-shelf-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M23 4v6h-6M1 20v-6h6" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
          Refresh library
        </h2>
        <p class="section-desc">
          Sync the library with disk. Games whose files were deleted from the
          library folder are removed from the catalogue.
        </p>
      </div>
      <button class="btn-ghost shrink-0" :disabled="refreshing" @click="refreshLibrary">
        {{ refreshing ? 'Refreshing…' : 'Refresh library' }}
      </button>
    </div>
  </section>
</template>
