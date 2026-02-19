import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

/**
 * Returns a debounced version of the provided value.
 * The debounced value only updates after the specified delay
 * has elapsed since the last change.
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

/**
 * Returns a debounced version of the provided callback.
 * The callback will only be invoked after `delay` ms have elapsed
 * since the last invocation. Calling `.cancel()` aborts a pending call.
 */
export function useDebouncedCallback<T extends (...args: unknown[]) => unknown>(
  callback: T,
  delay: number,
): T & { cancel: () => void } {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => cancel, [cancel]);

  const debounced = useMemo(() => {
    const fn = (...args: Parameters<T>) => {
      cancel();
      timerRef.current = setTimeout(() => {
        callbackRef.current(...args);
      }, delay);
    };
    (fn as typeof fn & { cancel: () => void }).cancel = cancel;
    return fn as unknown as T & { cancel: () => void };
  }, [delay, cancel]);

  return debounced;
}
