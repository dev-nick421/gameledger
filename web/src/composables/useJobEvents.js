import { ref, onMounted, onUnmounted } from 'vue';

// Subscribes to the global job-progress WebSocket. Every client receives every
// event (Phase 1 is single-admin). Reconnects with a small backoff.
export function useJobEvents(onEvent) {
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
