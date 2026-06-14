/**
 * React hook over the PC connection monitor (lib/_core/connection.ts).
 * Returns the live { configured, online, checking } state and a manual refresh.
 */
import { useEffect, useState, useCallback } from "react";
import {
  subscribeConnection,
  checkConnection,
  getConnectionState,
  type ConnectionState,
} from "@/lib/_core/connection";

export function useConnection() {
  const [state, setState] = useState<ConnectionState>(getConnectionState());

  useEffect(() => subscribeConnection(setState), []);

  const refresh = useCallback(() => { void checkConnection(); }, []);

  return { ...state, refresh };
}
