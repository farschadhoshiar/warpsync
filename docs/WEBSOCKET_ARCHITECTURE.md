# WebSocket Architecture Documentation

## Overview

This document describes the refactored WebSocket architecture that fixes the "Invalid job ID format" errors and subscription loops while implementing proper Socket.IO room management patterns.

## Problem Analysis

### Issues Fixed

1. **WebSocket validation errors**: Manager rejected `jobId="all"` with regex validation
2. **Subscription loops**: Multiple tree-node components trying to join the same room
3. **Incorrect room architecture**: No proper handling of "All Jobs" view
4. **Client-side room management**: Components trying to manage room subscriptions

## New Architecture

### Core Principle: Server-Side Room Management

The new architecture follows Socket.IO best practices where **the server manages room membership**, not the client.

```typescript
// ❌ OLD PATTERN - Client manages rooms
socket.emit('subscribe:job', jobId);

// ✅ NEW PATTERN - Server assigns rooms based on connection parameters
const socket = io({ query: { jobId } });
```

## Implementation Details

### 1. Server-Side Room Assignment

**File**: `src/lib/websocket/manager.ts`

```typescript
// Room assignment happens during connection handshake
function handleRoomAssignment(socket, jobId, serverId) {
  if (jobId === 'all') {
    socket.join('all-jobs');  // Special room for "All Jobs" view
  } else if (isValidObjectId(jobId)) {
    socket.join(`job:${jobId}`);  // Individual job room
  }
}
```

### 2. Room Types

| Room Type | Pattern | Purpose |
|-----------|---------|---------|
| `all-jobs` | Single room | Receives events from all jobs |
| `job:${jobId}` | Per-job rooms | Job-specific events |
| `server:${serverId}` | Per-server rooms | Server-specific events |

### 3. Broadcasting Pattern

**File**: `src/lib/websocket/manager.ts`

```typescript
export function broadcastJobProgress(io, jobId, progress) {
  // Send to specific job room
  io.to(`job:${jobId}`).emit('job:progress', progress);

  // ALSO send to all-jobs room (for "All Jobs" view)
  io.to('all-jobs').emit('job:progress', progress);
}
```

### 4. Client-Side Connection

**File**: `src/components/providers/websocket-provider.tsx`

```typescript
// Connection established with jobId in handshake
const socket = io(url, {
  query: { jobId }  // Server uses this for room assignment
});
```

### 5. Component Usage

**File**: `src/app/files/page.tsx`

```typescript
// Wrap components with job-specific WebSocketProvider
<WebSocketProvider jobId={selectedJobId} key={selectedJobId}>
  <FileBrowser jobId={selectedJobId} ... />
</WebSocketProvider>
```

## Migration Guide

### Before (Broken Pattern)

```typescript
// Tree nodes manually joining rooms
useEffect(() => {
  joinJobRoom(jobId);
  return () => leaveJobRoom(jobId);
}, [jobId]);
```

### After (Fixed Pattern)

```typescript
// Single WebSocketProvider at component level
<WebSocketProvider jobId={jobId}>
  <TreeNode />  {/* No room management needed */}
</WebSocketProvider>

// Components just listen for events
useJobEvents({
  onProgress: (data) => handleProgress(data)
});
```

## Event Flow

### "All Jobs" View (`jobId="all"`)

1. Client connects with `{ query: { jobId: "all" } }`
2. Server puts socket in `all-jobs` room
3. When any job has progress: `broadcastJobProgress(io, realJobId, data)`
4. Event sent to both `job:${realJobId}` AND `all-jobs` rooms
5. "All Jobs" view receives all job events

### Specific Job View (`jobId="507f1f77bcf86cd799439011"`)

1. Client connects with `{ query: { jobId: "507f1f77bcf86cd799439011" } }`
2. Server puts socket in `job:507f1f77bcf86cd799439011` room
3. Only receives events for that specific job

## File Structure

```
src/lib/websocket/
├── manager.ts           # ✅ Server-side room management & broadcasting
├── emitter.ts          # ✅ Updated to use new broadcasting functions
└── events.ts           # Event schemas

src/components/providers/
└── websocket-provider.tsx  # ✅ Connection-based provider

src/lib/utils/
└── validation.ts       # ✅ ObjectId validation utilities
```

## API Reference

### Server-Side Functions

```typescript
// Room management
function setupSocketHandlers(io: SocketIOServer)
function handleRoomAssignment(socket, jobId, serverId)

// Broadcasting
function broadcastJobProgress(io, jobId, progress)
function broadcastServerStatus(io, serverId, status)
function broadcastGlobalMessage(io, event, data)

// Utilities
function getConnectionStats(io)
```

### Client-Side Hooks

```typescript
// WebSocket connection
function useWebSocket(): WebSocketContextType

// Event handling
function useJobEvents(handlers: {
  onProgress?: (data) => void;
  onStatusChange?: (data) => void;
  onError?: (data) => void;
})

function useServerEvents(handlers: {
  onStatusChange?: (data) => void;
  onMetricsUpdate?: (data) => void;
})
```

## Validation

### ObjectId Validation

```typescript
// Valid ObjectId (24 hex characters)
isValidObjectId("507f1f77bcf86cd799439011") // ✅ true

// Special cases
isValidJobId("all") // ✅ true (special case)
isValidJobId("507f1f77bcf86cd799439011") // ✅ true (valid ObjectId)
isValidJobId("invalid") // ❌ false
```

## Error Handling

### Graceful Invalid JobId Handling

```typescript
// Server logs warning instead of throwing error
if (!isValidObjectId(jobId) && jobId !== 'all') {
  logger.warn("Invalid jobId in handshake", { jobId });
  socket.emit('room:error', { message: "Invalid job ID format" });
  // ✅ Connection continues, just no room assignment
}
```

### Client Error Handling

```typescript
socket.on('room:error', (data) => {
  console.error('Room assignment error:', data.message);
  toast.error(`Invalid job ID: ${data.jobId}`);
});
```

## Testing

Run the integration test:

```bash
node test-websocket-integration.js
```

Expected output:
- Client 1 (specific job): Receives only its job's events
- Client 2 (different job): Receives only its job's events
- Client 3 ("all" jobs): Receives events from all jobs
- Client 4 (invalid jobId): Receives error event

## Performance Optimizations

### Event Throttling

```typescript
// Progress events throttled to 200ms
const lastEmit = this.progressThrottleMap.get(key) || 0;
if (now - lastEmit < 200) return;
```

### Connection Efficiency

- Single WebSocket connection per jobId (not per component)
- Server-side room management (no client-side subscription logic)
- Automatic room cleanup on disconnect

## Monitoring

### Connection Stats

```typescript
const stats = getConnectionStats(io);
// Returns:
// {
//   totalConnections: 5,
//   rooms: {
//     "all-jobs": 2,
//     "job:507f1f77bcf86cd799439011": 1,
//     "job:507f1f77bcf86cd799439012": 2
//   }
// }
```

### Event Debugging

```typescript
// Enable debug logging
localStorage.debug = 'socket.io*';  // Client-side
DEBUG=socket.io* node server.js     // Server-side
```

## Backwards Compatibility

Legacy subscription events are still supported for gradual migration:

```typescript
// Legacy pattern (deprecated but still works)
socket.emit('subscribe:job', jobId);

// New pattern (recommended)
const socket = io({ query: { jobId } });
```

## Security Considerations

- JobId validation prevents room injection attacks
- Server-side room management prevents unauthorized room access
- Rate limiting on legacy subscription events
- Graceful handling of malformed connection parameters

## Known Limitations

1. Room membership is determined at connection time
2. Changing jobId requires reconnection (handled automatically)
3. Legacy file room subscriptions removed (events sent via job rooms)

## Future Improvements

1. Dynamic room switching without reconnection
2. Room-based access control
3. Event replay for connection recovery
4. Metrics collection for room usage

---

*This architecture ensures reliable, performant, and maintainable WebSocket communication while following Socket.IO best practices.*
