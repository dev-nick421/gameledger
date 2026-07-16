import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import GameCard from '../src/components/GameCard.vue';

const stubs = { RouterLink: { template: '<a><slot /></a>' } };

describe('GameCard', () => {
  it('renders a completed game without a status badge', () => {
    const wrapper = mount(GameCard, {
      props: { item: { igdbId: 1, title: 'Halo', status: 'Completed', releaseYear: 2001 } },
      global: { stubs },
    });
    expect(wrapper.text()).toContain('Halo');
    // Completed games no longer show a status badge (issue #25).
    expect(wrapper.text()).not.toContain('Completed');
    expect(wrapper.text()).toContain('2001');
  });

  it('shows a spinner and stage for an in-progress game', () => {
    const wrapper = mount(GameCard, {
      props: { item: { igdbId: 2, title: 'Doom', status: 'Compressing', progress: 50 } },
      global: { stubs },
    });
    expect(wrapper.find('.animate-spin').exists()).toBe(true);
    expect(wrapper.text()).toContain('Compressing');
  });

  it('emits correct when an unmatched card is clicked', async () => {
    const item = { igdbId: -3, title: 'Mystery', status: 'Unmatched' };
    const wrapper = mount(GameCard, { props: { item }, global: { stubs } });
    await wrapper.trigger('click');
    expect(wrapper.emitted('correct')).toBeTruthy();
    expect(wrapper.emitted('correct')[0][0]).toEqual(item);
  });
});
