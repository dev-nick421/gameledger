import { defineStore } from 'pinia';

// Live state for a bulk metadata refresh run (issue #6), fed from the
// WebSocket via App.vue so any page can show it's in progress and react once
// it completes (e.g. Manage Games reloading its table).
export const useMetadataRefreshStore = defineStore('metadataRefresh', {
  state: () => ({ running: false, total: 0, done: 0, lastSummary: null }),
  actions: {
    start() {
      this.running = true;
      this.total = 0;
      this.done = 0;
    },
    onProgress(event) {
      this.running = true;
      this.total = event.total;
      this.done += 1;
    },
    onComplete(event) {
      this.running = false;
      this.total = 0;
      this.done = 0;
      this.lastSummary = event;
    },
  },
});
