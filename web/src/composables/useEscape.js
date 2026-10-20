import { onMounted, onUnmounted } from 'vue';

// Close-on-Escape for modals and overlays.
export function useEscape(handler) {
  const onKey = (e) => {
    if (e.key === 'Escape') handler(e);
  };
  onMounted(() => window.addEventListener('keydown', onKey));
  onUnmounted(() => window.removeEventListener('keydown', onKey));
}

export default useEscape;
