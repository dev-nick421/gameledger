<script setup>
import { computed } from 'vue';
import { RouterLink, useRouter, useRoute } from 'vue-router';
import { useAuthStore } from '../stores/auth.js';
import { useLayoutStore } from '../stores/layout.js';
import ThemeToggle from './ThemeToggle.vue';
import AppLogo from './AppLogo.vue';

const auth = useAuthStore();
const layout = useLayoutStore();
const router = useRouter();
const route = useRoute();

const onLibrary = computed(() => route.name === 'library');
const inSettings = computed(() => route.path.startsWith('/admin'));

function logout() {
  auth.logout();
  router.push({ name: 'library' });
}
</script>

<template>
  <header
    class="sticky top-0 z-40 border-b border-gray-200/80 bg-white/80 backdrop-blur-md dark:border-shelf-border/70 dark:bg-shelf-bg/75"
  >
    <div class="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
      <!-- Brand = home -->
      <RouterLink
        :to="{ name: 'library' }"
        class="flex items-center gap-2.5 rounded-lg text-base font-bold tracking-tight focus:outline-none focus-visible:ring-2 focus-visible:ring-shelf-accent/60"
        aria-label="GameLedger library"
      >
        <AppLogo />
        <span class="hidden bg-gradient-to-r from-[#e84bd0] to-[#9b5cf6] bg-clip-text text-transparent sm:inline">GameLedger</span>
      </RouterLink>

      <div class="flex items-center gap-1">
        <ThemeToggle />

        <!-- Arrange library -->
        <button
          v-if="auth.isAuthenticated && onLibrary"
          v-tooltip="layout.arranging ? 'Done arranging' : 'Arrange sections'"
          class="icon-btn"
          :class="{ '!bg-shelf-accent/10 !text-shelf-accent': layout.arranging }"
          aria-label="Arrange sections"
          :aria-pressed="layout.arranging"
          @click="layout.toggleArranging()"
        >
          <svg class="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="5 9 2 12 5 15" /><polyline points="9 5 12 2 15 5" /><polyline points="15 19 12 22 9 19" /><polyline points="19 9 22 12 19 15" /><line x1="2" y1="12" x2="22" y2="12" /><line x1="12" y1="2" x2="12" y2="22" />
          </svg>
        </button>

        <!-- Settings -->
        <RouterLink
          v-if="auth.isAuthenticated"
          v-tooltip="'Settings'"
          :to="{ name: 'settings-scanning' }"
          class="icon-btn"
          :class="{ '!bg-shelf-accent/10 !text-shelf-accent': inSettings }"
          aria-label="Settings"
        >
          <svg class="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </RouterLink>

        <span class="mx-1 h-5 w-px bg-gray-200 dark:bg-shelf-border" aria-hidden="true"></span>

        <button
          v-if="auth.isAuthenticated"
          class="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-gray-600 transition hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-shelf-elevated dark:hover:text-gray-100"
          @click="logout"
        >
          <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
          Logout
        </button>
        <RouterLink
          v-else
          :to="{ name: 'login' }"
          class="inline-flex h-9 items-center gap-1.5 rounded-lg bg-gray-900 px-3 text-sm font-medium text-white transition hover:bg-gray-700 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200"
        >
          Login
        </RouterLink>
      </div>
    </div>
  </header>
</template>
