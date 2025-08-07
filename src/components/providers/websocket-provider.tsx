"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { io, Socket } from 'socket.io-client';
import { toast } from 'sonner';

interface WebSocketContextType {
  socket: Socket | null;
  isConnected: boolean;
  subscribe: (event: string, handler: (data: unknown) => void) => void;
  unsubscribe: (event: string, handler: (data: unknown) => void) => void;
  emit: (event: string, data?: unknown) => void;
}

const WebSocketContext = createContext<WebSocketContextType | undefined>(undefined);

interface WebSocketProviderProps {
  children: ReactNode;
}

export function WebSocketProvider({ children }: WebSocketProviderProps) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const socketInstance = io(process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3000', {
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    socketInstance.on('connect', () => {
      setIsConnected(true);
      toast.success('Connected to WarpSync server');
    });

    socketInstance.on('disconnect', () => {
      setIsConnected(false);
      toast.error('Disconnected from WarpSync server');
    });

    socketInstance.on('reconnect', () => {
      setIsConnected(true);
      toast.success('Reconnected to WarpSync server');
    });

    socketInstance.on('error', (error) => {
      toast.error(`WebSocket error: ${error.message || 'Unknown error'}`);
    });

    setSocket(socketInstance);

    return () => {
      socketInstance.disconnect();
    };
  }, []);

  const subscribe = (event: string, handler: (data: unknown) => void) => {
    socket?.on(event, handler);
  };

  const unsubscribe = (event: string, handler: (data: unknown) => void) => {
    socket?.off(event, handler);
  };

  const emit = (event: string, data?: unknown) => {
    socket?.emit(event, data);
  };

  return (
    <WebSocketContext.Provider value={{ socket, isConnected, subscribe, unsubscribe, emit }}>
      {children}
    </WebSocketContext.Provider>
  );
}

export function useWebSocket() {
  const context = useContext(WebSocketContext);
  if (context === undefined) {
    throw new Error('useWebSocket must be used within a WebSocketProvider');
  }
  return context;
}
