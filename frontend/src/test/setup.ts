import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// jsdom implements none of these; several components rely on them.
if (!window.matchMedia) {
  window.matchMedia = ((q: string) => ({
    matches: false, media: q, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  })) as never;
}
(globalThis as Record<string, unknown>).IntersectionObserver = class {
  observe() {} unobserve() {} disconnect() {} takeRecords() { return []; }
};
(globalThis as Record<string, unknown>).ResizeObserver = class {
  observe() {} unobserve() {} disconnect() {}
};
