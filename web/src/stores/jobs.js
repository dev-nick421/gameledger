import { defineStore } from 'pinia';

// Persists live job state across page navigation. The WebSocket connection is
// held at the App level, and each event is piped here via onJobEvent().
export const useJobsStore = defineStore('jobs', {
  state: () => ({
    live: {},  // jobId (string) -> last received event
  }),
  getters: {
    liveList: (s) => Object.values(s.live),
    hasActive: (s) =>
      Object.values(s.live).some(
        (j) => j.status !== 'completed' && j.stage !== 'Completed' && j.stage !== 'Unmatched',
      ),
  },
  actions: {
    onJobEvent(event) {
      this.live[String(event.jobId)] = event;
    },
    clear() {
      this.live = {};
    },
  },
});
