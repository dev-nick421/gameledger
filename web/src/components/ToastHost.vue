<script setup>
import { useToastStore } from '../stores/toast.js';

// Mounted once at the app root so a toast is visible no matter which view is
// active (Library, Settings, a game detail page, ...).
const toastStore = useToastStore();
</script>

<template>
  <div class="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4">
    <TransitionGroup name="toast">
      <div
        v-for="t in toastStore.toasts"
        :key="t.id"
        class="pointer-events-auto w-full max-w-sm rounded-lg p-3 text-sm shadow-lg"
        :class="{
          'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-400': t.kind === 'ok',
          'bg-amber-100 text-amber-800 dark:bg-amber-500/10 dark:text-amber-400': t.kind === 'warn',
          'bg-gray-100 text-gray-800 dark:bg-shelf-elevated dark:text-gray-200': t.kind === 'info',
        }"
        @click="toastStore.dismiss(t.id)"
      >
        {{ t.text }}
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
  transform: translateY(8px);
}
</style>
