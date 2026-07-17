<script setup>
import { ref, onMounted, onUnmounted, computed, watch } from 'vue';
import client from '../api/client.js';
import { useJobsStore } from '../stores/jobs.js';
import { useLayoutStore } from '../stores/layout.js';
import { useAuthStore } from '../stores/auth.js';
import GameCard from '../components/GameCard.vue';
import ScrollRail from '../components/ScrollRail.vue';
import MetadataCorrectionModal from '../components/MetadataCorrectionModal.vue';
import GameFormModal from '../components/GameFormModal.vue';

const jobsStore = useJobsStore();
const layout = useLayoutStore();
const auth = useAuthStore();

const items = ref([]);
const total = ref(0);
const loading = ref(true);
const error = ref(null);
const view = ref(localStorage.getItem('gs_view') || 'grid');
const correcting = ref(null);
const editing = ref(null);

// Front-page sort (issue #12): each option maps to a sortBy/sortDir pair sent
// straight through to GET /games, which sorts before pagination.
const SORT_OPTIONS = [
  { value: 'default', label: 'Recently updated', sortBy: null, sortDir: null },
  { value: 'date-desc', label: 'Release date (newest)', sortBy: 'releaseYear', sortDir: 'desc' },
  { value: 'date-asc', label: 'Release date (oldest)', sortBy: 'releaseYear', sortDir: 'asc' },
  { value: 'name-asc', label: 'Name (A-Z)', sortBy: 'title', sortDir: 'asc' },
  { value: 'name-desc', label: 'Name (Z-A)', sortBy: 'title', sortDir: 'desc' },
  { value: 'platform-asc', label: 'Platform (A-Z)', sortBy: 'platform', sortDir: 'asc' },
  { value: 'platform-desc', label: 'Platform (Z-A)', sortBy: 'platform', sortDir: 'desc' },
  { value: 'genre-asc', label: 'Genre (A-Z)', sortBy: 'genre', sortDir: 'asc' },
  { value: 'genre-desc', label: 'Genre (Z-A)', sortBy: 'genre', sortDir: 'desc' },
];
const sortOption = ref(localStorage.getItem('gs_sort') || 'default');
function setSort(v) {
  sortOption.value = v;
  localStorage.setItem('gs_sort', v);
  load();
}

// Section config (ordered { id, visible }), hydrated from public settings
const sections = ref([]);

// Static metadata for each rail: label, icon and how to pick its items from the
// loaded games. Adding a rail here + on the backend list makes it available.
const completed = computed(() => items.value.filter((i) => i.type === 'game' && i.status === 'Completed'));
const SECTION_META = {
  'recently-added': {
    label: 'Recently added',
    icon: 'clock',
    pick: (games) => games.slice(0, 12),
  },
  'most-downloaded': {
    label: 'Most downloaded',
    icon: 'download',
    pick: (games) => games.filter((g) => (g.downloadCount ?? 0) > 0).sort((a, b) => (b.downloadCount ?? 0) - (a.downloadCount ?? 0)).slice(0, 12),
  },
  'newest-releases': {
    label: 'Newest releases',
    icon: 'sparkles',
    pick: (games) => [...games].sort((a, b) => (b.releaseYear ?? 0) - (a.releaseYear ?? 0)).slice(0, 12),
  },
};

function railItems(id) {
  const meta = SECTION_META[id];
  return meta ? meta.pick(completed.value) : [];
}

// In normal mode only show visible rails that actually have items; in arrange
// mode show every known section so the user can toggle/reorder them all.
const shownSections = computed(() => {
  if (layout.arranging) return sections.value.filter((s) => SECTION_META[s.id]);
  return sections.value.filter((s) => s.visible && SECTION_META[s.id] && railItems(s.id).length);
});

function onCorrected() {
  correcting.value = null;
  load();
}

function onEditManually() {
  editing.value = correcting.value;
  correcting.value = null;
}

async function load() {
  loading.value = true;
  try {
    const chosen = SORT_OPTIONS.find((o) => o.value === sortOption.value);
    const params = { limit: 100 };
    if (chosen?.sortBy) {
      params.sortBy = chosen.sortBy;
      params.sortDir = chosen.sortDir;
    }
    const { data } = await client.get('/games', { params });
    items.value = data.items;
    total.value = data.total;
    error.value = null;
  } catch {
    error.value = 'Failed to load library.';
  } finally {
    loading.value = false;
  }
}

async function loadPrefs() {
  try {
    const { data } = await client.get('/settings/public');
    sections.value = data.librarySections ?? [];
  } catch {
    sections.value = [];
  }
}

// Persist the current section order/visibility (admin only the arrange button
// is gated on auth, but guard here too).
async function persistSections() {
  if (!auth.isAuthenticated) return;
  try {
    await client.put('/settings', { librarySections: sections.value });
  } catch {
    /* non-fatal: local state still reflects the user's intent this session */
  }
}

function toggleVisible(id) {
  sections.value = sections.value.map((s) => (s.id === id ? { ...s, visible: !s.visible } : s));
  persistSections();
}

// --- Drag to reorder (arrange mode) ---
const dragId = ref(null);
function onDragStart(id) {
  dragId.value = id;
}
function onDrop(targetId) {
  const from = sections.value.findIndex((s) => s.id === dragId.value);
  const to = sections.value.findIndex((s) => s.id === targetId);
  if (from === -1 || to === -1 || from === to) return;
  const next = [...sections.value];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  sections.value = next;
  dragId.value = null;
  persistSections();
}

function setView(v) {
  view.value = v;
  localStorage.setItem('gs_view', v);
}

const VIEWS = [
  { id: 'grid', label: 'Grid view' },
  { id: 'list', label: 'List view' },
  { id: 'plain', label: 'Plain view' },
];

// Refresh when job events arrive via the app-level WebSocket store.
let refreshTimer = null;
watch(
  () => jobsStore.live,
  () => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(load, 400);
  },
  { deep: true },
);

onMounted(() => {
  load();
  loadPrefs();
});
// Leaving the page exits arrange mode so the header toggle never lingers on.
onUnmounted(() => layout.stopArranging());

const isEmpty = computed(() => !loading.value && items.value.length === 0);
</script>

<template>
  <div>
    <!-- Arrange-mode banner -->
    <div
      v-if="layout.arranging"
      class="mb-4 flex items-center justify-between gap-3 rounded-lg border border-shelf-accent/40 bg-shelf-accent/10 px-4 py-2.5 text-sm"
    >
      <span class="flex items-center gap-2 font-medium text-shelf-accent">
        <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="5 9 2 12 5 15" /><polyline points="9 5 12 2 15 5" /><polyline points="15 19 12 22 9 19" /><polyline points="19 9 22 12 19 15" /><line x1="2" y1="12" x2="22" y2="12" /><line x1="12" y1="2" x2="12" y2="22" />
        </svg>
        Arranging sections drag to reorder, toggle the eye to show/hide.
      </span>
      <button class="btn-primary !px-3 !py-1.5 text-xs" @click="layout.stopArranging()">Done</button>
    </div>

    <!-- Configurable library rails -->
    <TransitionGroup name="section" tag="div">
      <section
        v-for="s in shownSections"
        :key="s.id"
        class="mb-8"
        :draggable="layout.arranging"
        :class="{ 'cursor-grab rounded-xl border-2 border-dashed border-gray-200 p-3 dark:border-shelf-border': layout.arranging, 'opacity-50': layout.arranging && !s.visible }"
        @dragstart="onDragStart(s.id)"
        @dragover.prevent
        @drop="onDrop(s.id)"
      >
        <div class="mb-3 flex items-center justify-between">
          <h2 class="flex items-center gap-2 text-lg font-semibold">
            <svg v-if="layout.arranging" class="h-4 w-4 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="9" cy="6" r="1" /><circle cx="9" cy="12" r="1" /><circle cx="9" cy="18" r="1" /><circle cx="15" cy="6" r="1" /><circle cx="15" cy="12" r="1" /><circle cx="15" cy="18" r="1" />
            </svg>
            <svg class="h-5 w-5 text-shelf-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <template v-if="SECTION_META[s.id].icon === 'clock'"><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 14" /></template>
              <template v-else-if="SECTION_META[s.id].icon === 'download'"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></template>
              <template v-else><path d="M12 3l1.9 5.8L20 10l-6.1 1.2L12 17l-1.9-5.8L4 10l6.1-1.2z" /></template>
            </svg>
            {{ SECTION_META[s.id].label }}
          </h2>
          <!-- Visibility toggle (arrange mode) -->
          <button
            v-if="layout.arranging"
            class="rounded-lg p-1.5 text-gray-500 transition hover:bg-gray-100 dark:hover:bg-shelf-elevated"
            :title="s.visible ? 'Hide section' : 'Show section'"
            @click="toggleVisible(s.id)"
          >
            <svg v-if="s.visible" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
            <svg v-else class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
          </button>
        </div>

        <p v-if="layout.arranging && !railItems(s.id).length" class="px-1 text-sm text-gray-400">
          No games qualify for this rail yet.
        </p>
        <ScrollRail v-else :item-key="railItems(s.id).length">
          <div v-for="item in railItems(s.id)" :key="`${s.id}-${item.igdbId}`" class="w-32 shrink-0 sm:w-36">
            <GameCard :item="item" @correct="correcting = $event" />
          </div>
        </ScrollRail>
      </section>
    </TransitionGroup>

    <div class="mb-5 flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold">Library</h1>
        <p class="text-sm text-gray-500">{{ total }} title{{ total === 1 ? '' : 's' }}</p>
      </div>
      <div class="flex items-center gap-3">
        <!-- Sort dropdown (issue #12) -->
        <select
          class="input !w-auto py-1.5 text-sm"
          aria-label="Sort library"
          :value="sortOption"
          @change="setSort($event.target.value)"
        >
          <option v-for="o in SORT_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
        <!-- View switcher: icons only (issue #18) -->
        <div class="flex gap-1 rounded-lg bg-gray-100 p-1 dark:bg-shelf-elevated">
          <button
            v-for="v in VIEWS"
            :key="v.id"
            class="rounded-md p-1.5 transition"
            :class="view === v.id ? 'bg-white text-shelf-accent shadow dark:bg-shelf-surface' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'"
            :title="v.label"
            :aria-label="v.label"
            @click="setView(v.id)"
          >
            <!-- grid -->
            <svg v-if="v.id === 'grid'" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
            <!-- list -->
            <svg v-else-if="v.id === 'list'" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="4" width="5" height="5" rx="1" />
              <rect x="3" y="15" width="5" height="5" rx="1" />
              <line x1="11" y1="6.5" x2="21" y2="6.5" />
              <line x1="11" y1="17.5" x2="21" y2="17.5" />
            </svg>
            <!-- plain -->
            <svg v-else class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
        </div>
      </div>
    </div>

    <p v-if="error" class="rounded-lg bg-red-100 p-3 text-red-700">{{ error }}</p>

    <div v-if="loading" class="py-20 text-center text-gray-400">Loading…</div>

    <div v-else-if="isEmpty" class="card p-10 text-center">
      <svg class="mx-auto mb-3 h-10 w-10 text-gray-300 dark:text-shelf-border" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <rect x="2" y="7" width="20" height="14" rx="2" />
        <path d="M16 3l-4 4-4-4" />
      </svg>
      <p class="text-lg font-medium">Your shelf is empty</p>
      <p class="mt-1 text-sm text-gray-500">
        Configure a library path in
        <RouterLink :to="{ name: 'settings-paths' }" class="text-shelf-accent underline">Settings</RouterLink>
        and run a scan.
      </p>
    </div>

    <!-- Grid -->
    <div
      v-else-if="view === 'grid'"
      class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6"
    >
      <GameCard
        v-for="item in items"
        :key="item.igdbId ?? `job-${item.jobId}`"
        :item="item"
        @correct="correcting = $event"
      />
    </div>

    <!-- List -->
    <div v-else-if="view === 'list'" class="card divide-y divide-gray-100 dark:divide-shelf-border">
      <component
        :is="item.status === 'Completed' ? 'RouterLink' : 'div'"
        v-for="item in items"
        :key="item.igdbId ?? `job-${item.jobId}`"
        :to="item.status === 'Completed' ? { name: 'game', params: { igdbId: item.igdbId } } : undefined"
        class="flex items-center gap-3 p-3 hover:bg-gray-50 dark:hover:bg-shelf-elevated"
      >
        <img v-if="item.coverUrl" :src="item.coverUrl" class="h-14 w-10 rounded object-cover" />
        <div v-else class="h-14 w-10 rounded bg-gray-200 dark:bg-shelf-elevated"></div>
        <div class="min-w-0 flex-1">
          <p class="truncate font-medium">{{ item.title }}</p>
          <p class="text-xs text-gray-500">{{ item.releaseYear || '—' }}</p>
        </div>
        <!-- Only show status text for non-completed items -->
        <span v-if="item.status !== 'Completed'" class="text-xs text-gray-500">{{ item.status }}</span>
      </component>
    </div>

    <!-- Plain -->
    <ul v-else class="card divide-y divide-gray-100 dark:divide-shelf-border">
      <li v-for="item in items" :key="item.igdbId ?? `job-${item.jobId}`" class="flex justify-between px-4 py-2 text-sm">
        <RouterLink
          v-if="item.status === 'Completed'"
          :to="{ name: 'game', params: { igdbId: item.igdbId } }"
          class="hover:text-shelf-accent"
        >
          {{ item.displayName || item.title }}
        </RouterLink>
        <span v-else>{{ item.title }}</span>
        <!-- Only show status for non-completed items -->
        <span v-if="item.status !== 'Completed'" class="text-gray-400">{{ item.status }}</span>
      </li>
    </ul>

    <MetadataCorrectionModal
      v-if="correcting"
      :game="correcting"
      @close="correcting = null"
      @corrected="onCorrected"
      @edit-manually="onEditManually"
    />
    <GameFormModal
      v-if="editing"
      :game="editing"
      @close="editing = null"
      @saved="editing = null; load()"
    />
  </div>
</template>

<style scoped>
/* Animate rail reordering in arrange mode*/
.section-move {
  transition: transform 0.3s ease;
}
.section-enter-active,
.section-leave-active {
  transition: all 0.25s ease;
}
.section-enter-from,
.section-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
</style>
