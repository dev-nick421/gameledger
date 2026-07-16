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
    class="group relative block overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm transition hover:shadow-lg dark:border-shelf-border dark:bg-shelf-surface"
    :class="{ 'opacity-60': inProgress, 'cursor-pointer': isUnmatched }"
    @click="handleClick"
  >
    <div class="aspect-[3/4] w-full overflow-hidden bg-gray-100 dark:bg-shelf-elevated">
      <img
        v-if="item.coverUrl"
        :src="item.coverUrl"
        :alt="item.title"
        class="h-full w-full object-cover transition group-hover:scale-105"
        loading="lazy"
      />
      <div v-else class="flex h-full items-center justify-center p-3 text-center text-sm text-gray-400">
        {{ item.title }}
      </div>
    </div>

    <div
      v-if="inProgress"
      class="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/40"
    >
      <span class="h-6 w-6 animate-spin rounded-full border-2 border-white border-t-transparent"></span>
      <span class="text-xs font-medium text-white">{{ item.status }}…</span>
      <div v-if="item.progress != null" class="h-1.5 w-24 overflow-hidden rounded-full bg-white/30">
        <div class="h-full bg-white" :style="{ width: `${item.progress}%` }"></div>
      </div>
    </div>

    <div
      v-if="isUnmatched"
      class="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition group-hover:bg-black/40 group-hover:opacity-100"
    >
      <span class="rounded-lg bg-white/90 px-3 py-1.5 text-xs font-semibold text-gray-900">Fix match</span>
    </div>

    <span v-if="!isCompleted" class="badge absolute left-2 top-2" :class="badgeClass">{{ item.status }}</span>

    <div class="p-2.5">
      <p class="truncate text-sm font-medium" :title="item.displayName || item.title">
        {{ item.title }}
      </p>
      <p v-if="item.releaseYear" class="text-xs text-gray-500">{{ item.releaseYear }}</p>
    </div>
  </component>
</template>
