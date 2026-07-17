<script setup>
import { onMounted } from 'vue';
import { RouterView } from 'vue-router';
import { useSettingsStore } from '../stores/settings.js';

// Settings shell: a sidebar of categories + a routed content pane. Each category
// (Scanning, Providers, Library, Paths) is its own nested route so it behaves
// like a real page/tab Scanning included (issue #15).
const settings = useSettingsStore();

const sections = [
  { name: 'settings-scanning', label: 'Scanning', icon: 'scan' },
  { name: 'settings-scheduler', label: 'Scheduler', icon: 'clock' },
  { name: 'settings-providers', label: 'Providers', icon: 'plug' },
  { name: 'settings-library', label: 'Library', icon: 'sliders' },
  { name: 'settings-games', label: 'Manage Games', icon: 'gamepad' },
  { name: 'settings-paths', label: 'Paths', icon: 'folder' },
  { name: 'settings-logs', label: 'Logs', icon: 'list' },
];

onMounted(() => settings.load());
</script>

<template>
  <div class="flex flex-col gap-6 md:flex-row">
    <!-- Sidebar -->
    <aside class="md:w-52 md:shrink-0">
      <h1 class="mb-3 px-2 text-xl font-bold">Settings</h1>
      <nav class="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
        <RouterLink
          v-for="s in sections"
          :key="s.name"
          :to="{ name: s.name }"
          class="flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-shelf-elevated"
          active-class="!bg-shelf-accent/10 !text-shelf-accent"
        >
          <svg class="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <template v-if="s.icon === 'scan'">
              <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
              <line x1="7" y1="12" x2="17" y2="12" />
            </template>
            <template v-else-if="s.icon === 'plug'">
              <path d="M9 2v6M15 2v6M6 8h12l-1 5a5 5 0 0 1-5 4h0a5 5 0 0 1-5-4L6 8z" /><path d="M12 17v5" />
            </template>
            <template v-else-if="s.icon === 'sliders'">
              <line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" />
              <line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" />
              <line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" />
              <line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" />
            </template>
            <template v-else-if="s.icon === 'clock'">
              <circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 14" />
            </template>
            <template v-else-if="s.icon === 'list'">
              <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
              <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
            </template>
            <template v-else-if="s.icon === 'gamepad'">
              <line x1="6" y1="11" x2="10" y2="11" /><line x1="8" y1="9" x2="8" y2="13" />
              <line x1="15" y1="12" x2="15.01" y2="12" /><line x1="18" y1="10" x2="18.01" y2="10" />
              <rect x="2" y="6" width="20" height="12" rx="6" />
            </template>
            <template v-else>
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </template>
          </svg>
          {{ s.label }}
        </RouterLink>
      </nav>
    </aside>

    <!-- Content -->
    <div class="min-w-0 flex-1">
      <RouterView />
    </div>
  </div>
</template>
