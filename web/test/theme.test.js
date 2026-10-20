import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useThemeStore } from '../src/stores/theme.js';

describe('theme store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    document.documentElement.classList.remove('dark');
  });

  it('defaults to dark mode', () => {
    const theme = useThemeStore();
    expect(theme.mode).toBe('dark');
  });

  it('toggles to light and persists the choice', () => {
    const theme = useThemeStore();
    theme.toggle();
    expect(theme.mode).toBe('light');
    expect(localStorage.getItem('gs_theme')).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});
