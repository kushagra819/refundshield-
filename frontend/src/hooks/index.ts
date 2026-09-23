import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../services/api';
import { useApp } from '../state/AppContext';

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/** Runs an async loader, cancels stale responses, and exposes a retry. */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const alive = useRef(0);

  useEffect(() => {
    const token = ++alive.current;
    setLoading(true);
    setError(null);
    loader()
      .then((d) => { if (alive.current === token) { setData(d); setLoading(false); } })
      .catch((e: unknown) => {
        if (alive.current !== token) return;
        setError(e instanceof ApiError ? e.message : 'Something went wrong loading this view.');
        setLoading(false);
      });
    return () => { alive.current++; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, loading, error, reload };
}

/** Counts up to a target. Honours reduced motion by jumping straight there. */
export function useCountUp(target: number, duration = 900, decimals = 0): number {
  const { reduceMotion } = useApp();
  const [value, setValue] = useState(reduceMotion ? target : 0);
  const frame = useRef<number>();

  useEffect(() => {
    if (reduceMotion || typeof requestAnimationFrame === 'undefined') {
      setValue(target);
      return;
    }
    const start = performance.now();
    const from = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = from + (target - from) * eased;
      setValue(decimals ? Number(next.toFixed(decimals)) : Math.round(next));
      if (t < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    // Safety net: rAF can be throttled or suspended (background tab, headless
    // capture, reduced power mode) and simply stop firing mid-animation, which
    // would leave a WRONG number on screen. Always settle on the real value.
    const settle = setTimeout(() => setValue(target), duration + 120);
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
      clearTimeout(settle);
    };
  }, [target, duration, decimals, reduceMotion]);

  return value;
}

/** Fires once when the element first scrolls into view. */
export function useInView<T extends HTMLElement>(margin = '-12% 0px') {
  const ref = useRef<T | null>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    if (typeof IntersectionObserver === 'undefined') { setSeen(true); return; }
    const io = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect(); } },
      { rootMargin: margin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [seen, margin]);
  return { ref, seen } as const;
}

export function useDebounced<T>(value: T, ms = 220): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
