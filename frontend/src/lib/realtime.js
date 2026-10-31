import { useEffect, useRef } from "react";
import { API } from "@/lib/api";

export function generateOriginId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `origin_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Hook to subscribe to SSE realtime events for CRM leads.
 * @param {string} eventName - e.g. "lead:updated"
 * @param {(data: { lead: object, origin_id: string, timestamp: string }) => void} handler
 */
export function useRealtimeEvent(eventName, handler) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const token = localStorage.getItem("crm_token");
    if (!token) return;

    let eventSource = null;
    let reconnectTimeout = null;
    let isDisposed = false;

    function connect() {
      if (isDisposed) return;
      try {
        const streamUrl = `${API}/realtime/stream?token=${encodeURIComponent(token)}`;
        eventSource = new EventSource(streamUrl);

        eventSource.addEventListener(eventName, (event) => {
          if (!event.data) return;
          try {
            const parsed = JSON.parse(event.data);
            handlerRef.current?.(parsed);
          } catch (e) {
            console.error("Failed to parse realtime event data:", e);
          }
        });

        eventSource.onerror = () => {
          if (eventSource) {
            eventSource.close();
            eventSource = null;
          }
          if (!isDisposed) {
            // Reconnect with 3s backoff
            reconnectTimeout = setTimeout(connect, 3000);
          }
        };
      } catch (err) {
        console.error("Realtime EventSource connection error:", err);
        if (!isDisposed) {
          reconnectTimeout = setTimeout(connect, 5000);
        }
      }
    }

    connect();

    return () => {
      isDisposed = true;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
    };
  }, [eventName]);
}
