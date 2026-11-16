/* Event bus: the only place engine events are published.
   Content packs and console scripts subscribe here instead of reading engine state.

   GSA.bus.on(name, fn)       subscribe
   GSA.bus.off(name, fn)      unsubscribe
   GSA.bus.emit(name, ...a)   publish (a throwing subscriber is logged, not rethrown)
*/
const subs = new Map();

const bus = {
  on(name, fn) {
    if (!subs.has(name)) subs.set(name, new Set());
    subs.get(name).add(fn);
    return fn;
  },
  off(name, fn) {
    const s = subs.get(name);
    if (s && s.delete(fn) && !s.size) subs.delete(name);
  },
  offAll() { subs.clear(); },
  emit(name, ...args) {
    for (const fn of subs.get(name) || []) {
      try { fn(...args); } catch (err) { console.error('bus subscriber threw for', name, err); }
    }
  }
};

(window.GSA = window.GSA || {}).bus = bus;