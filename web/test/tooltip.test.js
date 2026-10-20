import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { tooltip } from '../src/directives/tooltip.js';

const Host = {
  directives: { tooltip },
  props: { text: { type: String, default: 'Processed and ready to download.' } },
  template: '<span v-tooltip="text" tabindex="0">Completed</span>',
};

describe('v-tooltip', () => {
  it('shows its text on hover and focus, and hides again', async () => {
    const wrapper = mount(Host, { attachTo: document.body });
    const tip = () => document.getElementById('gl-tooltip');

    await wrapper.trigger('mouseenter');
    expect(tip().textContent).toBe('Processed and ready to download.');
    expect(tip().dataset.show).toBe('true');
    expect(wrapper.attributes('aria-describedby')).toBe('gl-tooltip');

    await wrapper.trigger('mouseleave');
    expect(tip().dataset.show).toBe('false');

    await wrapper.trigger('focus');
    expect(tip().dataset.show).toBe('true');
    await wrapper.setProps({ text: 'Updated' });
    expect(tip().textContent).toBe('Updated');

    wrapper.unmount();
    expect(tip().dataset.show).toBe('false');
  });
});
