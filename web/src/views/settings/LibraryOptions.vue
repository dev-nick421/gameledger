<script setup>
import { ref, computed } from 'vue';
import { useSettingsStore } from '../../stores/settings.js';

const settings = useSettingsStore();
const message = ref(null);
const error = ref(null);

// Labels
const SECTION_LABELS = {
  'recently-added': 'Recently added',
  'most-downloaded': 'Most downloaded',
  'newest-releases': 'Newest releases',
};
const sectionLabel = (id) => SECTION_LABELS[id] ?? id;

const sections = computed(() => settings.librarySections);

function toggle(id) {
  settings.librarySections = settings.librarySections.map((s) =>
    s.id === id ? { ...s, visible: !s.visible } : s,
  );
}

function move(index, delta) {
  const next = [...settings.librarySections];
  const target = index + delta;
  if (target < 0 || target >= next.length) return;
  [next[index], next[target]] = [next[target], next[index]];
  settings.librarySections = next;
}

// Drag-to-reorder within the settings card.
const dragIndex = ref(null);
function onDrop(index) {
  if (dragIndex.value === null || dragIndex.value === index) return;
  const next = [...settings.librarySections];
  const [moved] = next.splice(dragIndex.value, 1);
  next.splice(index, 0, moved);
  settings.librarySections = next;
  dragIndex.value = null;
}

async function save() {
  message.value = null;
  error.value = null;
  try {
    await settings.save({
      namingScheme: settings.namingScheme,
      librarySections: settings.librarySections,
    });
    message.value = 'Settings saved.';
  } catch (err) {
    error.value = err.response?.data?.error || 'Failed to save settings.';
  }
}
</script>

<template>
  <section class="card p-5">
    <h2 class="mb-4 text-lg font-semibold">Library options</h2>

    <label class="mb-1 block text-sm text-gray-500">Naming scheme</label>
    <input v-model="settings.namingScheme" class="input mb-2" placeholder="<Game Name> - <Release Year> [<IGDB_ID>]" />
    <div class="rounded-lg bg-gray-50 p-3 text-xs text-gray-500 dark:bg-shelf-elevated dark:text-gray-400">
      <p class="mb-1.5 font-medium text-gray-600 dark:text-gray-300">Available tokens</p>
      <ul class="space-y-1">
        <li><code class="text-shelf-accent">&lt;Game Name&gt;</code> full title of the game</li>
        <li><code class="text-shelf-accent">&lt;Release Year&gt;</code> the game's release year</li>
        <li><code class="text-shelf-accent">&lt;IGDB_ID&gt;</code> its ID on the Internet Game Database</li>
      </ul>
      <p class="mt-2">
        <code class="text-shelf-accent">&lt;IGDB_ID&gt;</code> is required it keeps every folder name unique.
      </p>
    </div>
  </section>

  <!-- Library sections -> show/hide and reorder the home-page rails. -->
  <section class="card mt-4 p-5">
    <h2 class="flex items-center gap-2 text-lg font-semibold">
      <svg class="h-5 w-5 text-shelf-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="4" width="18" height="5" rx="1" /><rect x="3" y="13" width="18" height="5" rx="1" />
      </svg>
      Library sections
    </h2>
    <p class="mb-3 mt-1 text-sm text-gray-500">
      Choose which rails appear on the library home page and in what order. Drag
      to reorder, or use the arrows. You can also rearrange these live from the
      library page using the arrange button in the top bar.
    </p>

    <ul class="space-y-2">
      <li
        v-for="(s, i) in sections"
        :key="s.id"
        class="flex items-center gap-3 rounded-lg border border-gray-200 px-3 py-2 dark:border-shelf-border"
        :class="{ 'opacity-50': !s.visible, 'ring-2 ring-shelf-accent/40': dragIndex === i }"
        draggable="true"
        @dragstart="dragIndex = i"
        @dragover.prevent
        @drop="onDrop(i)"
      >
        <svg class="h-4 w-4 cursor-grab text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="9" cy="6" r="1" /><circle cx="9" cy="12" r="1" /><circle cx="9" cy="18" r="1" /><circle cx="15" cy="6" r="1" /><circle cx="15" cy="12" r="1" /><circle cx="15" cy="18" r="1" />
        </svg>
        <span class="flex-1 text-sm font-medium">{{ sectionLabel(s.id) }}</span>

        <div class="flex items-center gap-1">
          <button
            class="rounded p-1 text-gray-400 transition hover:bg-gray-100 disabled:opacity-30 dark:hover:bg-shelf-elevated"
            :disabled="i === 0"
            title="Move up"
            @click="move(i, -1)"
          >
            <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15" /></svg>
          </button>
          <button
            class="rounded p-1 text-gray-400 transition hover:bg-gray-100 disabled:opacity-30 dark:hover:bg-shelf-elevated"
            :disabled="i === sections.length - 1"
            title="Move down"
            @click="move(i, 1)"
          >
            <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
          </button>
          <label class="ml-1 inline-flex cursor-pointer items-center gap-1.5 text-xs text-gray-500">
            <input type="checkbox" class="h-4 w-4 rounded" :checked="s.visible" @change="toggle(s.id)" />
            Show
          </label>
        </div>
      </li>
    </ul>

    <p
      v-if="message"
      class="mt-4 rounded-lg bg-emerald-100 p-2 text-sm text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-400"
    >
      {{ message }}
    </p>
    <p
      v-if="error"
      class="mt-4 rounded-lg bg-red-100 p-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-400"
    >
      {{ error }}
    </p>

    <button class="btn-primary mt-4" @click="save">Save settings</button>
  </section>
</template>
