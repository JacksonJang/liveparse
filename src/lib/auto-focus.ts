/**
 * Returns true when the device has a physical keyboard and it is safe to
 * steal focus on mount. On touch-only devices, autofocus would pop the
 * virtual keyboard and hide the page content, which is a bad mobile UX.
 */
export function shouldAutoFocus(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}
