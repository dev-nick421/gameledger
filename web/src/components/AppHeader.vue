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

function logout() {
  auth.logout();
  router.push({ name: 'library' });
}
</script>

<template>
  <header
    class="sticky top-0 z-40 border-b border-gray-200 bg-white/80 backdrop-blur dark:border-shelf-border dark:bg-shelf-bg/80"
  >
    <div class="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
      <!-- Brand = home -->
      <RouterLink
        :to="{ name: 'library' }"
        class="flex items-center gap-2 text-base font-bold tracking-tight"
      >
        <AppLogo />
        <span class="hidden sm:inline bg-gradient-to-r from-[#e84bd0] to-[#9b5cf6] bg-clip-text text-transparent">GameLedger</span>
      </RouterLink>

      <div class="flex items-center gap-1">
        <ThemeToggle />

        <!-- Arrange library -->
        <button
          v-if="auth.isAuthenticated && onLibrary"
          class="inline-flex h-8 w-8 items-center justify-center rounded-lg transition"
          :class="layout.arranging
            ? 'bg-shelf-accent/10 text-shelf-accent'
            : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-shelf-elevated dark:hover:text-gray-100'"
          :title="layout.arranging ? 'Done arranging' : 'Arrange sections'"
          aria-label="Arrange sections"
          @click="layout.toggleArranging()"
        >
          <svg class="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="5 9 2 12 5 15" /><polyline points="9 5 12 2 15 5" /><polyline points="15 19 12 22 9 19" /><polyline points="19 9 22 12 19 15" /><line x1="2" y1="12" x2="22" y2="12" /><line x1="12" y1="2" x2="12" y2="22" />
          </svg>
        </button>

        <!-- Settings -->
        <RouterLink
          v-if="auth.isAuthenticated"
          :to="{ name: 'settings-scanning' }"
          class="inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-shelf-elevated dark:hover:text-gray-100"
          title="Settings"
          aria-label="Settings"
        >
          <svg class="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </RouterLink>

        <button
          v-if="auth.isAuthenticated"
          class="rounded-lg px-2.5 py-1.5 text-sm text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-shelf-elevated dark:hover:text-gray-100"
          @click="logout"
        >
          Logout
        </button>
        <RouterLink
          v-else
          :to="{ name: 'login' }"
          class="rounded-lg px-2.5 py-1.5 text-sm text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-shelf-elevated dark:hover:text-gray-100"
        >
          Login
        </RouterLink>
      </div>
    </div>
  </header>
</template>
