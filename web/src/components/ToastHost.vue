<script setup>
import { useToastStore } from '../stores/toast.js';

// Mounted once at the app root so a toast is visible no matter which view is
// active (Library, Settings, a game detail page, ...).
const toastStore = useToastStore();

const ICON_CLASS = {
  ok: 'text-emerald-500',
  warn: 'text-amber-500',
  error: 'text-red-500',
  info: 'text-shelf-accent',
};
</script>

<template>
  <div
    class="pointer-events-none fixed inset-x-0 bottom-4 z-[70] flex flex-col items-center gap-2 px-4 sm:bottom-6"
    aria-live="polite"
  >
    <TransitionGroup name="toast">
      <div
        v-for="t in toastStore.toasts"
        :key="t.id"
        class="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border border-gray-200 bg-white p-3 pr-2 text-sm text-gray-800 shadow-lg dark:border-shelf-border dark:bg-shelf-elevated dark:text-gray-100"
        role="status"
      >
        <svg class="mt-0.5 h-5 w-5 shrink-0" :class="ICON_CLASS[t.kind] || ICON_CLASS.info" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <template v-if="t.kind === 'ok'"><circle cx="12" cy="12" r="9" /><polyline points="8 12.5 11 15.5 16 9.5" /></template>
          <template v-else-if="t.kind === 'warn' || t.kind === 'error'"><circle cx="12" cy="12" r="9" /><line x1="12" y1="8" x2="12" y2="12.5" /><line x1="12" y1="16" x2="12.01" y2="16" /></template>
          <template v-else><circle cx="12" cy="12" r="9" /><line x1="12" y1="11" x2="12" y2="16" /><line x1="12" y1="8" x2="12.01" y2="8" /></template>
        </svg>
        <p class="min-w-0 flex-1 leading-5">{{ t.text }}</p>
        <button
          class="-my-0.5 shrink-0 rounded-md p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-shelf-border dark:hover:text-gray-200"
          aria-label="Dismiss"
          @click="toastStore.dismiss(t.id)"
        >
          <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition: all 0.25s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(8px) scale(0.98);
}
</style>
