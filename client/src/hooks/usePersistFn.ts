import { useRef } from "react";

export function usePersistFn<T extends Function>(fn: T): T {
  const fnRef = useRef<T>(fn);
  fnRef.current = fn;

  const persistFn = useRef<T | null>(null);
  if (!persistFn.current) {
    persistFn.current = function (this: unknown, ...args: unknown[]) {
      return fnRef.current!.apply(this, args);
    } as unknown as T;
  }

  return persistFn.current!;
}
