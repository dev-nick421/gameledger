import { defineStore } from 'pinia';
import client from '../api/client.js';

// Shared admin settings, loaded once by the Settings layout and read/written by
// each settings sub-page. PUT /settings only touches the fields it's given, so
// each page can save just its own subset.
export const useSettingsStore = defineStore('settings', {
  state: () => ({
    loaded: false,
    igdbConfigured: false,
    namingScheme: '',
    scanSchedule: 'off',
    refreshSchedule: 'off',
    syncSchedules: false,
    showRecentlyAdded: true,
    librarySections: [],
    compressionLevel: 1,
  }),
  actions: {
    applyFromResponse(data) {
      this.igdbConfigured = data.igdbConfigured;
      this.namingScheme = data.namingScheme;
      this.scanSchedule = data.scanSchedule;
      this.refreshSchedule = data.refreshSchedule;
      this.syncSchedules = data.syncSchedules;
      this.showRecentlyAdded = data.showRecentlyAdded;
      if (data.librarySections) this.librarySections = data.librarySections;
      if (data.compressionLevel != null) this.compressionLevel = data.compressionLevel;
    },
    async load() {
      const { data } = await client.get('/settings');
      this.applyFromResponse(data);
      this.loaded = true;
    },
    async save(payload) {
      const { data } = await client.put('/settings', payload);
      this.applyFromResponse(data);
      return data;
    },
  },
});
