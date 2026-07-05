// ---------- global toast store ----------
// Failure toasts for user-initiated writes (favorites, settings sync, push prefs) whose inline
// error text lives deep inside whatever view happened to trigger them — easy to miss, and each
// view's hook instance is isolated, so a module-level store is the only spot every caller can
// reach. Same pub/sub shape as subscribeCacheKey in lib/cache.js; the <Toasts /> component in
// components/common.js is the single subscriber that renders the stack.
let nextToastId = 1;
let toasts = [];
const subscribers = new Set();

function emit() {
  subscribers.forEach((onChange) => onChange(toasts));
}

export function showToast({ title, message }) {
  toasts = [...toasts, { id: nextToastId++, title, message }];
  emit();
}

export function dismissToast(id) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function subscribeToasts(onChange) {
  subscribers.add(onChange);
  onChange(toasts);
  return () => { subscribers.delete(onChange); };
}
