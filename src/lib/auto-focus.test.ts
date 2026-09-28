import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { shouldAutoFocus } from './auto-focus';

describe('shouldAutoFocus', () => {
  const originalWindow = globalThis.window;

  afterEach(() => {
    Object.defineProperty(globalThis, 'window', { value: originalWindow, writable: true });
    vi.restoreAllMocks();
  });

  it('returns true on devices with hover and fine pointer (desktop)', () => {
    Object.defineProperty(globalThis, 'window', {
      value: {
        matchMedia: vi.fn().mockImplementation((query: string) => ({
          matches: query === '(hover: hover) and (pointer: fine)',
          media: query,
        })),
      },
      writable: true,
    });
    expect(shouldAutoFocus()).toBe(true);
  });

  it('returns false on touch-only devices', () => {
    Object.defineProperty(globalThis, 'window', {
      value: {
        matchMedia: vi.fn().mockImplementation((query: string) => ({
          matches: false,
          media: query,
        })),
      },
      writable: true,
    });
    expect(shouldAutoFocus()).toBe(false);
  });

  it('returns false when window is undefined', () => {
    Object.defineProperty(globalThis, 'window', { value: undefined, writable: true });
    expect(shouldAutoFocus()).toBe(false);
  });

  it('returns false when matchMedia is unavailable', () => {
    Object.defineProperty(globalThis, 'window', { value: { matchMedia: undefined }, writable: true });
    expect(shouldAutoFocus()).toBe(false);
  });
});
