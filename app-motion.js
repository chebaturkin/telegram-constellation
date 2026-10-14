// Motion never owns application state: final attributes are set before playback.
export function createMotion() {
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  const channels = new Map();
  const tokens = getComputedStyle(document.documentElement);
  const timing = (name) => parseFloat(tokens.getPropertyValue(`--motion-${name}`)) || 180;
  const easing = (name) => tokens.getPropertyValue(`--motion-${name}`).trim() || 'ease-out';

  function cancel(channel) {
    const entries = channels.get(channel);
    if (!entries) return;
    // Cancellation can remove decorative SVG elements through their cleanup.
    for (const finish of [...entries.values()]) finish();
    channels.delete(channel);
  }
  function cancelAll() { for (const channel of [...channels.keys()]) cancel(channel); }
  function play(element, frames, { channel = 'scene', duration = 'state', curve = 'settle', delay = 0, cleanup } = {}) {
    channels.get(channel)?.get(element)?.();
    if (!element || preference.matches || typeof element.animate !== 'function') { cleanup?.(); return; }
    const animation = element.animate(frames, { duration: timing(duration), easing: easing(curve), delay });
    let entries = channels.get(channel);
    if (!entries) { entries = new Map(); channels.set(channel, entries); }
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      animation.onfinish = animation.oncancel = null;
      animation.cancel();
      entries.delete(element);
      if (!entries.size) channels.delete(channel);
      cleanup?.();
    };
    entries.set(element, finish);
    animation.onfinish = animation.oncancel = finish;
  }
  preference.addEventListener('change', cancelAll);
  return {
    play, cancel, cancelAll,
    reduced: () => preference.matches,
    dispose() { cancelAll(); preference.removeEventListener('change', cancelAll); },
  };
}
