import { useCallback, useEffect, useRef, useState } from "react";

export interface ApiState<T> {
  data: T | undefined;
  error: Error | undefined;
  loading: boolean;
  reload: () => void;
  setData: (data: T) => void;
}

/** Loads data on mount and whenever `deps` change; ignores responses from stale calls. */
export function useApi<T>(load: () => Promise<T>, deps: unknown[]): ApiState<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<Error>();
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const call = useRef(0);

  useEffect(() => {
    const id = ++call.current;
    setLoading(true);
    setError(undefined);
    load()
      .then((value) => {
        if (id === call.current) setData(value);
      })
      .catch((err: unknown) => {
        if (id === call.current) setError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        if (id === call.current) setLoading(false);
      });
    // `load` is recreated each render; `deps` lists what it actually depends on.
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload, setData };
}
