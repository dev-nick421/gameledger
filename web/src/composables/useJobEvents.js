import { ref, onMounted, onUnmounted } from 'vue';

// Subscribes to the global job-progress WebSocket. Every client receives every
// event (Phase 1 is single-admin). Reconnects with a small backoff.
// onEvent receives per-job progress ('job'); onScanEvent receives the one
// summary event broadcast when a whole scan run finishes; onMetadataEvent
// receives both the per-game progress and completion events from a bulk
// metadata refresh ('metadataRefreshProgress' / 'metadataRefresh').
export function useJobEvents(onEvent, onScanEvent, onMetadataEvent) {
  const connected = ref(false);
  let socket = null;
  let retry = null;

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    socket = new WebSocket(`${proto}://${location.host}/ws`);
    socket.onopen = () => {
      connected.value = true;
    };
    socket.onclose = () => {
      connected.value = false;
      retry = setTimeout(connect, 2000);
    };
    socket.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data);
        if (data.type === 'job' && onEvent) onEvent(data);
        else if (data.type === 'scan' && onScanEvent) onScanEvent(data);
        else if (
          (data.type === 'metadataRefreshProgress' || data.type === 'metadataRefresh') &&
          onMetadataEvent
        ) {
          onMetadataEvent(data);
        }
      } catch {
        /* ignore malformed frames */
      }
    };
  }

  onMounted(connect);
  onUnmounted(() => {
    if (retry) clearTimeout(retry);
    if (socket) {
      socket.onclose = null;
      socket.close();
    }
  });

  return { connected };
}
