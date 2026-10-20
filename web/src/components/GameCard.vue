<script setup>
import { computed } from 'vue';
import { RouterLink } from 'vue-router';

const props = defineProps({ item: { type: Object, required: true } });
const emit = defineEmits(['correct']);

const TERMINAL = ['Completed', 'Unmatched', 'Failed'];
const inProgress = computed(() => !TERMINAL.includes(props.item.status));
const isCompleted = computed(() => props.item.status === 'Completed');
const isUnmatched = computed(() => props.item.status === 'Unmatched');

const badgeClass = computed(() => {
  switch (props.item.status) {
    case 'Completed':
      return 'bg-emerald-500/90 text-white';
    case 'Unmatched':
      return 'bg-amber-500/90 text-white';
    case 'Failed':
      return 'bg-red-500/90 text-white';
    default:
      return 'bg-shelf-accent/90 text-white';
  }
});

// Completed games link to their detail page; Unmatched games open the
// correction modal; everything else is non-interactive.
const to = computed(() =>
  isCompleted.value ? { name: 'game', params: { igdbId: props.item.igdbId } } : null,
);

function handleClick() {
  if (isUnmatched.value) emit('correct', props.item);
}
</script>

<template>
  <component
    :is="to ? RouterLink : 'div'"
    :to="to"
    class="group relative block rounded-xl focus:outline-none"
    :class="{ 'cursor-pointer': isUnmatched }"
    :tabindex="isUnmatched ? 0 : undefined"
    @click="handleClick"
    @keydown.enter="handleClick"
  >
    <div
      class="relative aspect-[3/4] w-full overflow-hidden rounded-xl bg-gray-100 shadow-sm ring-1 ring-black/5 transition duration-200 group-hover:-translate-y-1 group-hover:shadow-xl group-hover:shadow-black/20 group-focus-visible:ring-2 group-focus-visible:ring-shelf-accent dark:bg-shelf-elevated dark:ring-white/5"
      :class="{ 'opacity-60': inProgress }"
    >
      <img
        v-if="item.coverUrl"
        :src="item.coverUrl"
        :alt="item.title"
        class="h-full w-full object-cover transition duration-300 group-hover:scale-105"
        loading="lazy"
      />
      <div v-else class="flex h-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-gray-100 to-gray-200 p-3 text-center dark:from-shelf-elevated dark:to-shelf-surface">
        <svg class="h-7 w-7 text-gray-300 dark:text-shelf-border" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="6" y1="11" x2="10" y2="11" /><line x1="8" y1="9" x2="8" y2="13" /><line x1="15" y1="12" x2="15.01" y2="12" /><line x1="18" y1="10" x2="18.01" y2="10" /><rect x="2" y="6" width="20" height="12" rx="6" />
        </svg>
        <span class="line-clamp-3 text-sm font-medium text-gray-500 dark:text-gray-400">{{ item.title }}</span>
      </div>

      <div
        v-if="inProgress"
        class="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/50"
      >
        <span class="h-6 w-6 animate-spin rounded-full border-2 border-white border-t-transparent"></span>
        <span class="text-xs font-medium text-white">{{ item.status }}…</span>
        <div v-if="item.progress != null" class="h-1.5 w-24 overflow-hidden rounded-full bg-white/30">
          <div class="h-full bg-white transition-all" :style="{ width: `${item.progress}%` }"></div>
        </div>
      </div>

      <div
        v-if="isUnmatched"
        class="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition group-hover:bg-black/50 group-hover:opacity-100 group-focus-visible:bg-black/50 group-focus-visible:opacity-100"
      >
        <span class="rounded-lg bg-white/95 px-3 py-1.5 text-xs font-semibold text-gray-900 shadow">Fix match</span>
      </div>

      <span v-if="!isCompleted" class="badge absolute left-2 top-2 shadow-sm backdrop-blur" :class="badgeClass">{{ item.status }}</span>
    </div>

    <div class="px-0.5 pt-2.5">
      <p class="truncate text-sm font-medium leading-5 transition group-hover:text-shelf-accent" :title="item.displayName || item.title">
        {{ item.title }}
      </p>
      <p class="text-xs text-gray-500 dark:text-gray-400">{{ item.releaseYear || '\u00a0' }}</p>
    </div>
  </component>
</template>
