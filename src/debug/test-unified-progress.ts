#!/usr/bin/env node
/**
 * Test script for the Unified Progress Event System
 * Run with: npx tsx src/debug/test-unified-progress.ts
 */

import { EventEmitter } from '../lib/websocket/emitter';
import { Server as SocketIOServer } from 'socket.io';

// Mock Socket.IO server for testing
const mockIO = {
  to: (room: string) => ({
    emit: (event: string, data: any) => {
      console.log(`📡 Emitted to room "${room}":`, {
        event,
        data: {
          ...data,
          timestamp: new Date(data.timestamp).toLocaleTimeString()
        }
      });
    }
  })
} as any as SocketIOServer;

async function testUnifiedProgressSystem() {
  console.log('🧪 Testing Unified Progress Event System...\n');

  const emitter = new EventEmitter(mockIO);

  // Test: Unified transfer progress event
  console.log('1. Testing unified transfer progress event...');
  emitter.emitUnifiedTransferProgress({
    transferId: 'transfer-789',
    fileId: 'file-456',
    jobId: 'job-123',
    filename: 'test-file.txt',
    progress: 65,
    bytesTransferred: 6500000,
    totalBytes: 10000000,
    speed: '3.2 MB/s',
    speedBps: 3355443,
    eta: '0:01:05',
    etaSeconds: 65,
    status: 'transferring',
    elapsedTime: 45000,
    compressionRatio: 15.5,
    timestamp: new Date().toISOString()
  });

  // Test 2: Transfer status change event
  console.log('\n2. Testing transfer status change event...');
  emitter.emitTransferStatus({
    transferId: 'transfer-789',
    fileId: 'file-456',
    jobId: 'job-123',
    filename: 'test-file.txt',
    oldStatus: 'starting',
    newStatus: 'transferring',
    timestamp: new Date().toISOString(),
    metadata: {
      source: '/remote/path/test-file.txt',
      destination: '/local/path/test-file.txt',
      size: 10000000,
      type: 'download'
    }
  });

  // Test 3: File state update event
  console.log('\n3. Testing file state update event...');
  emitter.emitFileStateUpdate({
    jobId: 'job-123',
    fileId: 'file-456',
    filename: 'test-file.txt',
    relativePath: 'folder/test-file.txt',
    oldState: 'queued',
    newState: 'transferring',
    timestamp: new Date().toISOString()
  });

  console.log('\n✅ All unified progress system tests completed!');
  console.log('\nThe system now supports:');
  console.log('• Dual-channel progress emission (legacy + unified)');
  console.log('• Real-time transfer status updates');
  console.log('• Rich progress metadata (speed, ETA, compression ratio)');
  console.log('• Enhanced file state synchronization');
  console.log('• Backward compatibility with existing events');
  console.log('• WebSocket room-based event broadcasting');
  
  console.log('\n🔧 Room-based Event System:');
  console.log('📡 Events are broadcast to specific rooms:');
  console.log('   • job:job-123 - Job-level events');
  console.log('   • file:file-456 - File-specific events');
  console.log('💡 Frontend connects with job/server parameters for automatic room assignment');
  console.log('🔌 Rooms are assigned automatically based on connection parameters');
}

if (require.main === module) {
  testUnifiedProgressSystem();
}
