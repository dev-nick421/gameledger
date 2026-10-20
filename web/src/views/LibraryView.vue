<script setup>
import { ref, onMounted, onUnmounted, computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import client from '../api/client.js';
import { useJobsStore } from '../stores/jobs.js';
import { useLayoutStore } from '../stores/layout.js';
import { useAuthStore } from '../stores/auth.js';
import GameCard from '../components/GameCard.vue';
import ScrollRail from '../components/ScrollRail.vue';
import FilterSelect from '../components/FilterSelect.vue';
import MetadataCorrectionModal from '../components/MetadataCorrectionModal.vue';
import GameFormModal from '../components/GameFormModal.vue';
import { SORTS, DEFAULT_SORT, applyFilters, buildFacets, isFiltering } from '../lib/libraryFilters.js';

const jobsStore = useJobsStore();
const layout = useLayoutStore();
const auth = useAuthStore();
const route = useRoute();
const router = useRouter();

const items = ref([]);
const loading = ref(true);
const error = ref(null);
const view = ref(localStorage.getItem('gs_view') || 'grid');
const correcting = ref(null);
const editing = ref(null);
const searchInput = ref(null);

// Section config (ordered { id, visible }), hydrated from public settings
const sections = ref([]);

// Static metadata for each rail: label, icon and how to pick its items from the
// loaded games. Adding a rail here + on the backend list makes it available.
const completed = computed(() => items.value.filter((i) => i.type === 'game' && i.status === 'Completed'));
const SECTION_META = {
  'recently-added': {
    label: 'Recently added',
    icon: 'clock',
    pick: (games) => applyFilters(games, { sort: 'added' }).slice(0, 12),
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

// ---- Search / filter / sort, mirrored in the URL so it survives a reload,
// the back button, and can be shared as a link.
// Search text lives in a local ref (instant, no cursor jumps while typing) and
// is mirrored into the URL alongside the rest.
const search = ref(String(route.query.q ?? ''));
const filters = computed(() => ({
  q: search.value,
  sort: String(route.query.sort ?? DEFAULT_SORT),
  genre: String(route.query.genre ?? ''),
  platform: String(route.query.platform ?? ''),
}));

function setFilter(key, value) {
  const query = { ...route.query, [key]: value || undefined };
  if (key === 'sort' && value === DEFAULT_SORT) query.sort = undefined;
  router.replace({ query });
}

function clearFilters() {
  search.value = '';
  router.replace({ query: filters.value.sort === DEFAULT_SORT ? {} : { sort: filters.value.sort } });
}

watch(search, (q) => setFilter('q', q));
watch(
  () => route.query.q,
  (q) => {
    if (String(q ?? '') !== search.value) search.value = String(q ?? '');
  },
);

const filtering = computed(() => isFiltering(filters.value));
const visible = computed(() => applyFilters(items.value, filters.value));
const gameCount = computed(() => items.value.filter((i) => i.type === 'game').length);

const facets = computed(() => buildFacets(items.value.filter((i) => i.type === 'game')));
const genreOptions = computed(() => [
  { value: '', label: 'All' },
  ...facets.value.genres.map((g) => ({ value: g.value, label: `${g.value} (${g.count})` })),
]);
const platformOptions = computed(() => [
  { value: '', label: 'All' },
  ...facets.value.platforms.map((p) => ({ value: p.value, label: `${p.value} (${p.count})` })),
]);

// In normal mode only show visible rails that actually have items; in arrange
// mode show every known section so the user can toggle/reorder them all.
// Rails step aside while searching/filtering so results sit right under the bar.
const shownSections = computed(() => {
  if (layout.arranging) return sections.value.filter((s) => SECTION_META[s.id]);
  if (filtering.value) return [];
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

// The feed is paginated server-side; the grid (and client-side filtering)
// needs all of it.
async function load() {
  try {
    const all = [];
    let page = 1;
    let total = 0;
    do {
      // eslint-disable-next-line no-await-in-loop
      const { data } = await client.get('/games', { params: { page, limit: 100 } });
      all.push(...data.items);
      total = data.total;
      page += 1;
    } while (all.length < total && page <= 100);
    items.value = all;
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

// "/" jumps to search, like most media libraries and docs sites.
function onKeydown(e) {
  if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement?.isContentEditable) return;
  e.preventDefault();
  searchInput.value?.focus();
}

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
  window.addEventListener('keydown', onKeydown);
});
// Leaving the page exits arrange mode so the header toggle never lingers on.
onUnmounted(() => {
  layout.stopArranging();
  window.removeEventListener('keydown', onKeydown);
  clearTimeout(refreshTimer);
});

const isEmpty = computed(() => !loading.value && items.value.length === 0);
</script>

<template>
  <div>
    <!-- Page header + toolbar -->
    <div class="mb-6 space-y-4">
      <div class="flex items-end justify-between gap-4">
        <div>
          <h1 class="text-2xl font-bold tracking-tight sm:text-3xl">Library</h1>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            <template v-if="loading">Loading your collection…</template>
            <template v-else-if="filtering">{{ visible.length }} of {{ gameCount }} game{{ gameCount === 1 ? '' : 's' }}</template>
            <template v-else>{{ gameCount }} game{{ gameCount === 1 ? '' : 's' }}</template>
          </p>
        </div>
        <!-- View switcher -->
        <div class="flex gap-0.5 rounded-lg border border-gray-200 bg-white p-0.5 dark:border-shelf-border dark:bg-shelf-surface" role="group" aria-label="Layout">
          <button
            v-for="v in VIEWS"
            :key="v.id"
            v-tooltip="v.label"
            class="rounded-md p-1.5 transition"
            :class="view === v.id ? 'bg-shelf-accent/10 text-shelf-accent' : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'"
            :aria-label="v.label"
            :aria-pressed="view === v.id"
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

      <div v-if="!isEmpty" class="flex flex-wrap items-center gap-2">
        <div class="relative w-full sm:w-72">
          <svg class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
          <input
            ref="searchInput"
            v-model="search"
            type="search"
            class="input !rounded-full !py-1.5 pl-9 pr-9"
            placeholder="Search games"
            aria-label="Search games"
            @keydown.esc="search = ''; $event.target.blur()"
          />
          <kbd v-if="!search" class="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-gray-200 px-1.5 text-[10px] font-medium text-gray-400 sm:block dark:border-shelf-border">/</kbd>
        </div>
        <FilterSelect label="Sort" :model-value="filters.sort" :options="SORTS" :default-value="DEFAULT_SORT" @update:model-value="setFilter('sort', $event)" />
        <FilterSelect v-if="facets.genres.length" label="Genre" :model-value="filters.genre" :options="genreOptions" @update:model-value="setFilter('genre', $event)" />
        <FilterSelect v-if="facets.platforms.length" label="Platform" :model-value="filters.platform" :options="platformOptions" @update:model-value="setFilter('platform', $event)" />
        <button v-if="filtering" class="inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-sm font-medium text-gray-500 transition hover:text-gray-900 dark:hover:text-gray-100" @click="clearFilters">
          <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          Clear
        </button>
      </div>
    </div>

    <!-- Arrange-mode banner -->
    <div
      v-if="layout.arranging"
      class="mb-4 flex items-center justify-between gap-3 rounded-xl border border-shelf-accent/40 bg-shelf-accent/10 px-4 py-2.5 text-sm"
    >
      <span class="flex items-center gap-2 font-medium text-shelf-accent">
        <svg class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="5 9 2 12 5 15" /><polyline points="9 5 12 2 15 5" /><polyline points="15 19 12 22 9 19" /><polyline points="19 9 22 12 19 15" /><line x1="2" y1="12" x2="22" y2="12" /><line x1="12" y1="2" x2="12" y2="22" />
        </svg>
        Arranging sections: drag to reorder, toggle the eye to show or hide.
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
          <h2 class="section-title">
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
            v-tooltip="s.visible ? 'Hide section' : 'Show section'"
            class="icon-btn !h-8 !w-8"
            :aria-label="s.visible ? 'Hide section' : 'Show section'"
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

    <h2 v-if="shownSections.length && !isEmpty" class="section-title mb-3">All games</h2>

    <p v-if="error" class="alert-error mb-4">{{ error }}</p>

    <!-- Loading skeleton -->
    <div v-if="loading" class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6" aria-hidden="true">
      <div v-for="n in 12" :key="n">
        <div class="skeleton aspect-[3/4] w-full !rounded-xl"></div>
        <div class="skeleton mt-2.5 h-3.5 w-3/4"></div>
        <div class="skeleton mt-1.5 h-3 w-1/3"></div>
      </div>
    </div>

    <!-- Empty library -->
    <div v-else-if="isEmpty" class="card flex flex-col items-center px-6 py-14 text-center">
      <div class="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-shelf-accent/10 text-shelf-accent">
        <svg class="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <rect x="2" y="7" width="20" height="14" rx="2" />
          <path d="M16 3l-4 4-4-4" />
        </svg>
      </div>
      <p class="text-lg font-semibold">Your shelf is empty</p>
      <p class="mt-1 max-w-sm text-sm text-gray-500 dark:text-gray-400">
        Point GameLedger at the folder that holds your games, then run a scan. Matched games show up here with art and details.
      </p>
      <div class="mt-5 flex flex-wrap justify-center gap-2">
        <template v-if="auth.isAuthenticated">
          <RouterLink :to="{ name: 'settings-paths' }" class="btn-ghost">Add a library path</RouterLink>
          <RouterLink :to="{ name: 'settings-scanning' }" class="btn-primary">Scan library</RouterLink>
        </template>
        <RouterLink v-else :to="{ name: 'login', query: { redirect: '/admin/paths' } }" class="btn-primary">Log in to set up</RouterLink>
      </div>
    </div>

    <!-- No results for the current filters -->
    <div v-else-if="!visible.length" class="flex flex-col items-center py-16 text-center">
      <svg class="mb-3 h-10 w-10 text-gray-300 dark:text-shelf-border" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
      <p class="font-medium">No games match</p>
      <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">Try a different search or remove a filter.</p>
      <button class="btn-ghost mt-4" @click="clearFilters">Clear filters</button>
    </div>

    <!-- Grid -->
    <div
      v-else-if="view === 'grid'"
      class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6"
    >
      <GameCard
        v-for="item in visible"
        :key="item.igdbId ?? `job-${item.jobId}`"
        :item="item"
        @correct="correcting = $event"
      />
    </div>

    <!-- List -->
    <div v-else-if="view === 'list'" class="card divide-y divide-gray-100 overflow-hidden dark:divide-shelf-border/70">
      <component
        :is="item.status === 'Completed' ? 'RouterLink' : 'div'"
        v-for="item in visible"
        :key="item.igdbId ?? `job-${item.jobId}`"
        :to="item.status === 'Completed' ? { name: 'game', params: { igdbId: item.igdbId } } : undefined"
        class="flex items-center gap-3 p-3 transition hover:bg-gray-50 dark:hover:bg-shelf-elevated"
        :class="{ 'cursor-pointer': item.status === 'Unmatched' }"
        @click="item.status === 'Unmatched' && (correcting = item)"
      >
        <img v-if="item.coverUrl" :src="item.coverUrl" :alt="item.title" class="h-14 w-10 rounded-md object-cover" loading="lazy" />
        <div v-else class="h-14 w-10 rounded-md bg-gray-200 dark:bg-shelf-elevated"></div>
        <div class="min-w-0 flex-1">
          <p class="truncate font-medium">{{ item.title }}</p>
          <p class="truncate text-xs text-gray-500 dark:text-gray-400">
            {{ [item.releaseYear, ...(item.genres ?? []).slice(0, 3)].filter(Boolean).join(' · ') || '—' }}
          </p>
        </div>
        <p v-if="item.platforms?.length" class="hidden max-w-xs truncate text-xs text-gray-500 md:block dark:text-gray-400">{{ item.platforms.join(', ') }}</p>
        <!-- Only show status text for non-completed items -->
        <span v-if="item.status !== 'Completed'" class="text-xs text-gray-500">{{ item.status }}</span>
      </component>
    </div>

    <!-- Plain -->
    <ul v-else class="card divide-y divide-gray-100 dark:divide-shelf-border/70">
      <li v-for="item in visible" :key="item.igdbId ?? `job-${item.jobId}`" class="flex justify-between gap-3 px-4 py-2 text-sm">
        <RouterLink
          v-if="item.status === 'Completed'"
          :to="{ name: 'game', params: { igdbId: item.igdbId } }"
          class="min-w-0 truncate hover:text-shelf-accent"
        >
          {{ item.displayName || item.title }}
        </RouterLink>
        <span v-else class="min-w-0 truncate">{{ item.title }}</span>
        <!-- Only show status for non-completed items -->
        <span v-if="item.status !== 'Completed'" class="shrink-0 text-gray-400">{{ item.status }}</span>
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
