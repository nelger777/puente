import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api } from "./api/client";

interface PendingState {
  count: number;
  refresh: () => void;
}

const PendingContext = createContext<PendingState>({ count: 0, refresh: () => undefined });

const REFRESH_MS = 60_000;
const BASE_TITLE = "Puente · Panel";

/** Pending-handoffs badge in the menu; pages call refresh() after changing a case. */
export function PendingProvider({ children }: { children: ReactNode }) {
  const [count, setCount] = useState(0);

  const refresh = useCallback(() => {
    api
      .handoffs({ status: "PENDING" })
      .then((r) => setCount(r.pendingCount))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  // The tab shows the count too, so a waiting case is visible from another tab.
  useEffect(() => {
    document.title = count ? `(${count}) ${BASE_TITLE}` : BASE_TITLE;
    return () => {
      document.title = BASE_TITLE;
    };
  }, [count]);

  const value = useMemo(() => ({ count, refresh }), [count, refresh]);
  return <PendingContext.Provider value={value}>{children}</PendingContext.Provider>;
}

export const usePending = () => useContext(PendingContext);
