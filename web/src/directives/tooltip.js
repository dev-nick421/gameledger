// v-tooltip="'text'": a small hover/focus label. It renders into <body> with
// fixed positioning so it's never clipped by a scroll container (the
// responsive tables, the settings nav), and flips below the target when
// there's no room above. One shared element serves every tooltip.
let tip = null;
let owner = null;

function element() {
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'gl-tooltip';
    tip.id = 'gl-tooltip';
    tip.setAttribute('role', 'tooltip');
    document.body.appendChild(tip);
  }
  return tip;
}

function show(el) {
  const text = el.__tooltip;
  if (!text) return;
  const t = element();
  owner = el;
  t.textContent = text;
  const target = el.getBoundingClientRect();
  const box = t.getBoundingClientRect();
  const gap = 8;
  let top = target.top - box.height - gap;
  if (top < gap) top = target.bottom + gap;
  const left = Math.min(
    Math.max(gap, target.left + target.width / 2 - box.width / 2),
    window.innerWidth - box.width - gap,
  );
  t.style.top = `${top}px`;
  t.style.left = `${left}px`;
  t.dataset.show = 'true';
  el.setAttribute('aria-describedby', t.id);
}

function hide(el) {
  if (owner !== el || !tip) return;
  tip.dataset.show = 'false';
  el.removeAttribute('aria-describedby');
  owner = null;
}

export const tooltip = {
  mounted(el, binding) {
    el.__tooltip = binding.value;
    el.__tooltipShow = () => show(el);
    el.__tooltipHide = () => hide(el);
    el.addEventListener('mouseenter', el.__tooltipShow);
    el.addEventListener('focus', el.__tooltipShow);
    el.addEventListener('mouseleave', el.__tooltipHide);
    el.addEventListener('blur', el.__tooltipHide);
    el.addEventListener('click', el.__tooltipHide);
  },
  updated(el, binding) {
    el.__tooltip = binding.value;
    if (owner === el) show(el);
  },
  beforeUnmount(el) {
    hide(el);
    el.removeEventListener('mouseenter', el.__tooltipShow);
    el.removeEventListener('focus', el.__tooltipShow);
    el.removeEventListener('mouseleave', el.__tooltipHide);
    el.removeEventListener('blur', el.__tooltipHide);
    el.removeEventListener('click', el.__tooltipHide);
  },
};

export default tooltip;
