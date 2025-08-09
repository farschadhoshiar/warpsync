# WebSocket Hooks Documentation

## Overview

This document describes the WebSocket event handling hooks in WarpSync, specifically `useJobEvents` and `useServerEvents`. These hooks provide a type-safe, Next.js App Router compatible way to handle real-time Socket.IO events in React components.

## Problem Solved

Previously, TypeScript would throw serialization errors when using callback functions in client components:

```
Props must be serializable for components in the "use client" entry file. "onProgress" is a function that's not a Server Action. Rename "onProgress" either to "action" or have its name end with "Action" e.g. "onProgressAction" to indicate it is a Server Action. (ts 71007)
```

These hooks solve this issue by using callback refs and proper TypeScript annotations to indicate that these are client-side event handlers, not Next.js Server Actions.

## Hooks

### `useJobEvents(handlers: JobEventHandlers): void`

Handles job-specific Socket.IO events with type safety and proper cleanup.

#### Parameters

- `handlers`: Object containing client-side Socket.IO event callbacks
  - `onProgress?`: Callback for job progress updates
  - `onStatusChange?`: Callback for job status changes  
  - `onError?`: Callback for job errors
  - `onComplete?`: Callback for job completion

#### Example Usage

```tsx
import { useJobEvents } from '@/components/providers/websocket-provider';

function JobMonitor() {
  useJobEvents({
    onProgress: (data) => {
      console.log('Job progress:', data.progress);
      console.log('Current file:', data.currentFile);
      console.log('Speed:', data.speed);
    },
    onStatusChange: (data) => {
      console.log('Job status changed to:', data.status);
    },
    onError: (data) => {
      console.error('Job error:', data.message);
      toast.error(`Job failed: ${data.message}`);
    },
    onComplete: (data) => {
      console.log('Job completed successfully:', data.success);
      if (data.stats) {
        console.log('Total files:', data.stats.totalFiles);
        console.log('Duration:', data.stats.duration);
      }
    },
  });

  return <div>Job Monitor Component</div>;
}
```

### `useServerEvents(handlers: ServerEventHandlers): void`

Handles server-specific Socket.IO events with type safety and proper cleanup.

#### Parameters

- `handlers`: Object containing client-side Socket.IO event callbacks
  - `onStatusChange?`: Callback for server status changes
  - `onMetricsUpdate?`: Callback for server metrics updates
  - `onAlert?`: Callback for server alerts

#### Example Usage

```tsx
import { useServerEvents } from '@/components/providers/websocket-provider';

function ServerMonitor() {
  useServerEvents({
    onStatusChange: (data) => {
      console.log('Server status:', data.status);
      console.log('Uptime:', data.uptime);
    },
    onMetricsUpdate: (data) => {
      console.log('CPU usage:', data.metrics.cpu);
      console.log('Memory usage:', data.metrics.memory);
      console.log('Active connections:', data.metrics.activeConnections);
    },
    onAlert: (data) => {
      console.warn('Server alert:', data.message);
      if (data.level === 'critical') {
        toast.error(`Critical alert: ${data.message}`);
      }
    },
  });

  return <div>Server Monitor Component</div>;
}
```

## Implementation Details

### Callback Reference Stability

The hooks use `useCallback` and `useRef` to maintain stable callback references:

```tsx
// Internal implementation (simplified)
export function useJobEvents(handlers: JobEventHandlers): void {
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

  // Event subscription with stable references
  useEffect(() => {
    if (!isConnected) return;

    if (handlers.onProgress) {
      subscribe("job:progress", stableProgressCallback);
    }

    return () => {
      unsubscribe("job:progress", stableProgressCallback);
    };
  }, [subscribe, unsubscribe, isConnected, handlers.onProgress, stableProgressCallback]);
}
```

### Type Safety

All event data is properly typed using interfaces from `@/lib/websocket/types`:

```tsx
export interface JobProgressData {
  jobId: string;
  transferId?: string;
  fileId?: string;
  progress?: number;
  percentage?: number;
  speed?: string;
  eta?: string;
  bytesTransferred?: number;
  totalBytes?: number;
  currentFile?: string;
}

export interface ServerAlertData {
  serverId: string;
  level: 'info' | 'warning' | 'error' | 'critical';
  message: string;
  alertType: 'performance' | 'security' | 'system' | 'network';
  details?: Record<string, any>;
}
```

### Client-Side Annotations

All callbacks are annotated with `@client-side` JSDoc comments and `ClientCallback` types to indicate they execute in the browser:

```tsx
/**
 * @param handlers.onProgress Client-side callback for job progress updates - NOT a Server Action
 * @param handlers.onStatusChange Client-side callback for job status changes - NOT a Server Action
 * @client-side All callbacks execute in the browser, not on the server
 */
export function useJobEvents(handlers: JobEventHandlers): void {
  // ...
}
```

## Best Practices

### 1. Use Within WebSocketProvider

Always use these hooks within a `WebSocketProvider`:

```tsx
function App() {
  return (
    <WebSocketProvider jobId="job123">
      <JobMonitor />
    </WebSocketProvider>
  );
}
```

### 2. Handle Connection State

The hooks automatically handle connection state, but you can access it via `useWebSocket`:

```tsx
function JobMonitor() {
  const { isConnected } = useWebSocket();
  
  useJobEvents({
    onProgress: (data) => {
      // This will only be called when connected
      console.log('Progress:', data.progress);
    },
  });

  if (!isConnected) {
    return <div>Connecting to WebSocket...</div>;
  }

  return <div>Connected and monitoring jobs</div>;
}
```

### 3. Stable Callback References

For optimal performance, use `useCallback` for event handlers:

```tsx
function JobMonitor() {
  const [progress, setProgress] = useState(0);

  const handleProgress = useCallback((data: any) => {
    setProgress(data.progress || 0);
  }, []);

  useJobEvents({
    onProgress: handleProgress,
  });

  return <div>Progress: {progress}%</div>;
}
```

### 4. Error Handling

Always handle errors gracefully:

```tsx
useJobEvents({
  onError: (data) => {
    console.error('Job error:', data);
    
    // Show user-friendly error message
    toast.error(`Operation failed: ${data.message}`);
    
    // Reset UI state if needed
    setIsLoading(false);
    setProgress(0);
  },
});
```

## Event Types

### Job Events

- `job:progress` - Progress updates during file transfers
- `job:status` - Job status changes (pending, running, completed, failed, paused)
- `job:error` - Error notifications
- `job:complete` - Job completion notifications

### Server Events

- `server:status` - Server status changes (online, offline, maintenance, error)
- `server:metrics` - Server performance metrics updates
- `server:alert` - Server alert notifications

## Migration Guide

If you were previously using direct Socket.IO event handlers, migrate like this:

### Before (causing TypeScript errors)

```tsx
// ❌ This would cause serialization errors
function useJobEvents(handlers: {
  onProgress?: (data: any) => void;
  onStatusChange?: (data: any) => void;
  onError?: (data: any) => void;
  onComplete?: (data: any) => void;
}) {
  // Direct handler usage (problematic)
}
```

### After (fixed with callback refs)

```tsx
// ✅ This works without TypeScript errors
import { useJobEvents } from '@/components/providers/websocket-provider';

function JobComponent() {
  useJobEvents({
    onProgress: (data) => {
      // Properly typed and no serialization errors
      console.log('Progress:', data.progress);
    },
    onError: (data) => {
      // Type-safe error handling
      console.error('Error:', data.message);
    },
  });
}
```

## Troubleshooting

### TypeScript Serialization Errors

If you still see serialization errors, ensure:

1. You're importing from the correct path: `@/components/providers/websocket-provider`
2. Your component is properly marked with `"use client"`
3. You're using the hooks inside a `WebSocketProvider`

### Event Not Firing

If events aren't firing:

1. Check WebSocket connection status with `useWebSocket().isConnected`
2. Verify you're in the correct room (job-specific or server-specific)
3. Check browser console for WebSocket connection errors
4. Ensure the server is emitting events to the correct room

### Performance Issues

If you experience performance issues:

1. Use `useCallback` for event handlers to prevent unnecessary re-subscriptions
2. Limit the number of components using these hooks simultaneously
3. Consider debouncing high-frequency events like progress updates