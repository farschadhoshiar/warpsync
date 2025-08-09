"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
  useCallback,
  useRef,
} from "react";
import { io, Socket } from "socket.io-client";
import { toast } from "sonner";
import { isValidJobId, isValidServerId } from "@/lib/utils/validation";
import {
  JobEventHandlers,
  ServerEventHandlers,
  ClientCallback,
  JobProgressData,
  JobStatusData,
  JobErrorData,
  JobCompleteData,
  ServerStatusData,
  ServerMetricsData,
  ServerAlertData,
} from "@/lib/websocket/types";

interface WebSocketContextType {
  socket: Socket | null;
  isConnected: boolean;
  connectionError: string | null;
  currentRooms: Set<string>;
  reconnectCount: number;
  // Event handlers
  subscribe: (event: string, handler: ClientCallback) => void;
  unsubscribe: (event: string, handler: ClientCallback) => void;
  emit: (event: string, data?: unknown) => void;
  // Connection management
  reconnect: () => void;
  disconnect: () => void;
}

const WebSocketContext = createContext<WebSocketContextType | undefined>(
  undefined,
);

interface WebSocketProviderProps {
  children: ReactNode;
  jobId?: string;
  serverId?: string;
  autoConnect?: boolean;
}

export function WebSocketProvider({
  children,
  jobId,
  serverId,
  autoConnect = true,
}: WebSocketProviderProps) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [currentRooms, setCurrentRooms] = useState<Set<string>>(new Set());
  const [reconnectCount, setReconnectCount] = useState(0);

  // ✅ Connection setup with jobId/serverId in handshake
  useEffect(() => {
    if (!autoConnect) return;

    // Build connection query parameters
    const query: Record<string, string> = {};

    if (jobId && isValidJobId(jobId)) {
      query.jobId = jobId;
    } else if (jobId) {
      console.warn("Invalid jobId provided to WebSocketProvider:", jobId);
    }

    if (serverId && isValidServerId(serverId)) {
      query.serverId = serverId;
    } else if (serverId) {
      console.warn("Invalid serverId provided to WebSocketProvider:", serverId);
    }

    const socketInstance = io(
      process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:3000",
      {
        autoConnect: true,
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        query, // ✅ Server handles room assignment based on this
      },
    );

    // ✅ Connection event handlers
    socketInstance.on("connect", () => {
      setIsConnected(true);
      setConnectionError(null);
      setReconnectCount(0);

      console.log("WebSocket connected", {
        socketId: socketInstance.id,
        jobId,
        serverId,
        query,
      });

      toast.success("Connected to WarpSync server");
    });

    socketInstance.on("disconnect", (reason) => {
      setIsConnected(false);
      setCurrentRooms(new Set()); // Clear rooms on disconnect

      console.log("WebSocket disconnected", {
        reason,
        jobId,
        serverId,
      });

      toast.error("Disconnected from WarpSync server");
    });

    socketInstance.on("reconnect", (attemptNumber) => {
      setIsConnected(true);
      setConnectionError(null);
      setReconnectCount(attemptNumber);

      console.log("WebSocket reconnected", {
        attemptNumber,
        jobId,
        serverId,
      });

      toast.success(
        `Reconnected to WarpSync server (attempt ${attemptNumber})`,
      );
    });

    socketInstance.on("reconnect_error", (error) => {
      setConnectionError(error.message || "Reconnection failed");
      console.error("WebSocket reconnection error:", error);
    });

    socketInstance.on("connect_error", (error) => {
      setConnectionError(error.message || "Connection failed");
      console.error("WebSocket connection error:", error);
      toast.error(`Connection error: ${error.message || "Unknown error"}`);
    });

    // ✅ Server-side room management events
    socketInstance.on(
      "room:joined",
      (data: {
        roomName: string;
        jobId?: string;
        serverId?: string;
        type: string;
      }) => {
        setCurrentRooms((prev) => new Set([...prev, data.roomName]));

        console.log("Joined room", data);

        if (data.type === "all-jobs") {
          toast.success("Connected to all jobs view");
        } else if (data.type === "job" && data.jobId) {
          toast.success(`Connected to job ${data.jobId}`);
        } else if (data.type === "server" && data.serverId) {
          toast.success(`Connected to server ${data.serverId}`);
        }
      },
    );

    socketInstance.on(
      "room:error",
      (data: { message: string; jobId?: string; type: string }) => {
        console.error("Room assignment error:", data);

        if (data.type === "validation_error") {
          toast.error(`Invalid job ID: ${data.jobId}`);
        } else {
          toast.error(`Room error: ${data.message}`);
        }
      },
    );

    // ✅ Legacy subscription confirmations (for backward compatibility)
    socketInstance.on(
      "subscribed:job",
      (data: { jobId: string; roomName: string }) => {
        setCurrentRooms((prev) => new Set([...prev, data.roomName]));
        console.log("Legacy job subscription confirmed:", data);
      },
    );

    socketInstance.on(
      "unsubscribed:job",
      (data: { jobId: string; roomName: string }) => {
        setCurrentRooms((prev) => {
          const newSet = new Set(prev);
          newSet.delete(data.roomName);
          return newSet;
        });
        console.log("Legacy job unsubscription confirmed:", data);
      },
    );

    socketInstance.on(
      "subscribed:server",
      (data: { serverId: string; roomName: string }) => {
        setCurrentRooms((prev) => new Set([...prev, data.roomName]));
        console.log("Legacy server subscription confirmed:", data);
      },
    );

    socketInstance.on(
      "unsubscribed:server",
      (data: { serverId: string; roomName: string }) => {
        setCurrentRooms((prev) => {
          const newSet = new Set(prev);
          newSet.delete(data.roomName);
          return newSet;
        });
        console.log("Legacy server unsubscription confirmed:", data);
      },
    );

    // ✅ General error handling
    socketInstance.on("error", (error: { message: string; type?: string }) => {
      console.error("WebSocket error:", error);
      toast.error(`WebSocket error: ${error.message}`);
    });

    setSocket(socketInstance);

    return () => {
      console.log("Cleaning up WebSocket connection", { jobId, serverId });
      socketInstance.disconnect();
      setSocket(null);
      setIsConnected(false);
      setCurrentRooms(new Set());
    };
  }, [jobId, serverId, autoConnect]);

  // ✅ Event subscription helpers
  const subscribe = useCallback<
    (event: string, handler: ClientCallback) => void
  >(
    (event: string, handler: ClientCallback) => {
      if (!socket) {
        console.warn("Cannot subscribe to event: socket not connected", {
          event,
        });
        return;
      }
      socket.on(event, handler);
    },
    [socket],
  );

  const unsubscribe = useCallback<
    (event: string, handler: ClientCallback) => void
  >(
    (event: string, handler: ClientCallback) => {
      if (!socket) {
        console.warn("Cannot unsubscribe from event: socket not connected", {
          event,
        });
        return;
      }
      socket.off(event, handler);
    },
    [socket],
  );

  const emit = useCallback<(event: string, data?: unknown) => void>(
    (event: string, data?: unknown) => {
      if (!socket || !isConnected) {
        console.warn("Cannot emit event: socket not connected", {
          event,
          data,
        });
        return;
      }
      socket.emit(event, data);
    },
    [socket, isConnected],
  );

  // ✅ Connection management
  const reconnect = useCallback<() => void>(() => {
    if (socket && !isConnected) {
      socket.connect();
    }
  }, [socket, isConnected]);

  const disconnect = useCallback<() => void>(() => {
    if (socket && isConnected) {
      socket.disconnect();
    }
  }, [socket, isConnected]);

  const contextValue: WebSocketContextType = {
    socket,
    isConnected,
    connectionError,
    currentRooms,
    reconnectCount,
    subscribe,
    unsubscribe,
    emit,
    reconnect,
    disconnect,
  };

  return (
    <WebSocketContext.Provider value={contextValue}>
      {children}
    </WebSocketContext.Provider>
  );
}

/**
 * Helper function for event handler registration and cleanup
 * @param subscribe Function to subscribe to events
 * @param unsubscribe Function to unsubscribe from events
 * @param eventHandlers Array of event handler tuples
 * @returns Cleanup function
 */
function registerEventHandlers(
  subscribe: (event: string, handler: ClientCallback) => void,
  unsubscribe: (event: string, handler: ClientCallback) => void,
  eventHandlers: Array<[string, ClientCallback]>,
): () => void {
  // Subscribe to all events
  eventHandlers.forEach(([event, handler]) => {
    subscribe(event, handler);
  });

  // Return cleanup function
  return () => {
    eventHandlers.forEach(([event, handler]) => {
      unsubscribe(event, handler);
    });
  };
}

/**
 * ✅ Hook for accessing WebSocket context
 */
export function useWebSocket(): WebSocketContextType {
  const context = useContext(WebSocketContext);
  if (context === undefined) {
    throw new Error("useWebSocket must be used within a WebSocketProvider");
  }
  return context;
}

/**
 * ✅ Hook for job-specific events (simplified)
 *
 * @param handlers Object containing client-side Socket.IO event callbacks
 * @param handlers.onProgress Client-side callback for job progress updates - NOT a Server Action
 * @param handlers.onStatusChange Client-side callback for job status changes - NOT a Server Action
 * @param handlers.onError Client-side callback for job errors - NOT a Server Action
 * @param handlers.onComplete Client-side callback for job completion - NOT a Server Action
 *
 * @client-side All callbacks execute in the browser, not on the server
 */
export function useJobEvents(handlers: JobEventHandlers): void {
  const { subscribe, unsubscribe, isConnected } = useWebSocket();

  // Use refs to store stable callback references
  const handlersRef = useRef<JobEventHandlers>(handlers);

  // Update ref when handlers change
  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  // Create stable callback wrappers
  const stableProgressCallback = useCallback<ClientCallback<JobProgressData>>(
    (data) => {
      handlersRef.current.onProgress?.(data);
    },
    [],
  );

  const stableStatusCallback = useCallback<ClientCallback<JobStatusData>>(
    (data) => {
      handlersRef.current.onStatusChange?.(data);
    },
    [],
  );

  const stableErrorCallback = useCallback<ClientCallback<JobErrorData>>(
    (data) => {
      handlersRef.current.onError?.(data);
    },
    [],
  );

  const stableCompleteCallback = useCallback<ClientCallback<JobCompleteData>>(
    (data) => {
      handlersRef.current.onComplete?.(data);
    },
    [],
  );

  useEffect(() => {
    if (!isConnected) return;

    const eventHandlers: Array<[string, ClientCallback]> = [];

    if (handlers.onProgress) {
      eventHandlers.push(["job:progress", stableProgressCallback]);
    }
    if (handlers.onStatusChange) {
      eventHandlers.push(["job:status", stableStatusCallback]);
    }
    if (handlers.onError) {
      eventHandlers.push(["job:error", stableErrorCallback]);
    }
    if (handlers.onComplete) {
      eventHandlers.push(["job:complete", stableCompleteCallback]);
    }

    // Subscribe to all events
    eventHandlers.forEach(([event, handler]) => {
      subscribe(event, handler);
    });

    // Cleanup subscriptions
    return () => {
      eventHandlers.forEach(([event, handler]) => {
        unsubscribe(event, handler);
      });
    };
  }, [
    subscribe,
    unsubscribe,
    isConnected,
    handlers.onProgress,
    handlers.onStatusChange,
    handlers.onError,
    handlers.onComplete,
    stableProgressCallback,
    stableStatusCallback,
    stableErrorCallback,
    stableCompleteCallback,
  ]);
}

/**
 * ✅ Hook for server-specific events (simplified)
 *
 * @param handlers Object containing client-side Socket.IO event callbacks
 * @param handlers.onStatusChange Client-side callback for server status changes - NOT a Server Action
 * @param handlers.onMetricsUpdate Client-side callback for server metrics updates - NOT a Server Action
 * @param handlers.onAlert Client-side callback for server alerts - NOT a Server Action
 *
 * @client-side All callbacks execute in the browser, not on the server
 */
export function useServerEvents(handlers: ServerEventHandlers): void {
  const { subscribe, unsubscribe, isConnected } = useWebSocket();

  // Use refs to store stable callback references
  const handlersRef = useRef<ServerEventHandlers>(handlers);

  // Update ref when handlers change
  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  // Create stable callback wrappers
  const stableStatusCallback = useCallback<ClientCallback<ServerStatusData>>(
    (data) => {
      handlersRef.current.onStatusChange?.(data);
    },
    [],
  );

  const stableMetricsCallback = useCallback<ClientCallback<ServerMetricsData>>(
    (data) => {
      handlersRef.current.onMetricsUpdate?.(data);
    },
    [],
  );

  const stableAlertCallback = useCallback<ClientCallback<ServerAlertData>>(
    (data) => {
      handlersRef.current.onAlert?.(data);
    },
    [],
  );

  useEffect(() => {
    if (!isConnected) return;

    const eventHandlers: Array<[string, ClientCallback]> = [];

    if (handlers.onStatusChange) {
      eventHandlers.push(["server:status", stableStatusCallback]);
    }
    if (handlers.onMetricsUpdate) {
      eventHandlers.push(["server:metrics", stableMetricsCallback]);
    }
    if (handlers.onAlert) {
      eventHandlers.push(["server:alert", stableAlertCallback]);
    }

    // Subscribe to all events
    eventHandlers.forEach(([event, handler]) => {
      subscribe(event, handler);
    });

    // Cleanup subscriptions
    return () => {
      eventHandlers.forEach(([event, handler]) => {
        unsubscribe(event, handler);
      });
    };
  }, [
    subscribe,
    unsubscribe,
    isConnected,
    handlers.onStatusChange,
    handlers.onMetricsUpdate,
    handlers.onAlert,
    stableStatusCallback,
    stableMetricsCallback,
    stableAlertCallback,
  ]);
}

/**
 * Re-export types for consuming components
 */
export type {
  JobEventHandlers,
  ServerEventHandlers,
  ClientCallback,
  JobProgressData,
  JobStatusData,
  JobErrorData,
  JobCompleteData,
  ServerStatusData,
  ServerMetricsData,
  ServerAlertData,
  WebSocketContextType,
} from "@/lib/websocket/types";

export type {
  JobProgressPayload,
  JobStatusPayload,
  JobErrorPayload,
  JobCompletePayload,
  ServerStatusPayload,
  ServerMetricsPayload,
  ServerAlertPayload,
} from "@/lib/websocket/event-schemas";
