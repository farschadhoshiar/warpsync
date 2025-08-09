#!/usr/bin/env node

/**
 * WebSocket Integration Test Script
 * Tests the new server-side room management and broadcasting patterns
 *
 * Usage:
 *   node test-websocket-integration.js
 *
 * This script will:
 * 1. Start a test Socket.IO server
 * 2. Create mock client connections with different jobIds
 * 3. Test room assignment and broadcasting
 * 4. Verify "All Jobs" functionality
 */

const { createServer } = require('http');
const { Server } = require('socket.io');
const { io: ClientIO } = require('socket.io-client');

// Mock the WebSocket manager functions
function isValidObjectId(id) {
  return /^[a-f\d]{24}$/i.test(id);
}

function setupTestSocketHandlers(io) {
  io.on('connection', (socket) => {
    const jobId = socket.handshake.query.jobId;
    const serverId = socket.handshake.query.serverId;

    console.log(`🔌 New connection: ${socket.id}`, { jobId, serverId });

    // Server-side room management
    if (jobId) {
      if (jobId === 'all') {
        socket.join('all-jobs');
        console.log(`   ✅ Joined all-jobs room`);
        socket.emit('room:joined', {
          roomName: 'all-jobs',
          jobId: 'all',
          type: 'all-jobs'
        });
      } else if (isValidObjectId(jobId)) {
        const roomName = `job:${jobId}`;
        socket.join(roomName);
        console.log(`   ✅ Joined ${roomName} room`);
        socket.emit('room:joined', {
          roomName,
          jobId,
          type: 'job'
        });
      } else {
        console.log(`   ❌ Invalid jobId: ${jobId}`);
        socket.emit('room:error', {
          message: 'Invalid job ID format',
          jobId,
          type: 'validation_error'
        });
      }
    }

    if (serverId && isValidObjectId(serverId)) {
      const roomName = `server:${serverId}`;
      socket.join(roomName);
      console.log(`   ✅ Joined ${roomName} room`);
      socket.emit('room:joined', {
        roomName,
        serverId,
        type: 'server'
      });
    }

    socket.on('disconnect', (reason) => {
      console.log(`🔌 Disconnected: ${socket.id} (${reason})`);
    });

    socket.on('ping', (callback) => {
      if (typeof callback === 'function') {
        callback({ timestamp: new Date().toISOString(), socketId: socket.id });
      }
    });
  });
}

// Broadcasting functions
function broadcastJobProgress(io, jobId, progress) {
  if (!isValidObjectId(jobId)) {
    console.warn(`❌ Invalid jobId for broadcast: ${jobId}`);
    return;
  }

  const jobRoomName = `job:${jobId}`;

  // Send to specific job room
  io.to(jobRoomName).emit('job:progress', {
    jobId,
    ...progress,
    timestamp: new Date().toISOString(),
  });

  // Also send to all-jobs room
  io.to('all-jobs').emit('job:progress', {
    jobId,
    ...progress,
    timestamp: new Date().toISOString(),
  });

  console.log(`📡 Broadcasted job progress for ${jobId} to ${jobRoomName} and all-jobs`);
}

function getRoomStats(io) {
  const sockets = io.sockets.sockets;
  const roomCounts = {};

  for (const [, socket] of sockets) {
    for (const room of socket.rooms) {
      if (room !== socket.id) {
        roomCounts[room] = (roomCounts[room] || 0) + 1;
      }
    }
  }

  return {
    totalConnections: sockets.size,
    rooms: roomCounts,
    timestamp: new Date().toISOString(),
  };
}

async function runTest() {
  console.log('🧪 Starting WebSocket Integration Test\n');

  // Create test server
  const httpServer = createServer();
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  setupTestSocketHandlers(io);

  // Start server
  const PORT = 3001;
  await new Promise((resolve) => {
    httpServer.listen(PORT, resolve);
  });
  console.log(`🚀 Test server started on port ${PORT}\n`);

  try {
    // Test valid job IDs (24-character hex)
    const validJobId1 = '507f1f77bcf86cd799439011';
    const validJobId2 = '507f1f77bcf86cd799439012';

    console.log('📝 Test 1: Creating clients with specific job IDs...');

    // Client 1: Specific job
    const client1 = ClientIO(`http://localhost:${PORT}`, {
      query: { jobId: validJobId1 }
    });

    // Client 2: Different specific job
    const client2 = ClientIO(`http://localhost:${PORT}`, {
      query: { jobId: validJobId2 }
    });

    // Client 3: All jobs view
    const client3 = ClientIO(`http://localhost:${PORT}`, {
      query: { jobId: 'all' }
    });

    // Client 4: Invalid job ID
    const client4 = ClientIO(`http://localhost:${PORT}`, {
      query: { jobId: 'invalid-job-id' }
    });

    // Wait for connections
    await new Promise(resolve => setTimeout(resolve, 500));

    console.log('\n📊 Room Statistics:');
    const stats = getRoomStats(io);
    console.log(JSON.stringify(stats, null, 2));

    console.log('\n📝 Test 2: Testing event listeners...');

    // Set up event listeners
    let receivedEvents = {
      client1: [],
      client2: [],
      client3: [],
      client4: []
    };

    client1.on('job:progress', (data) => {
      receivedEvents.client1.push(data);
      console.log(`   🎯 Client 1 received job:progress:`, data.jobId, data.type);
    });

    client2.on('job:progress', (data) => {
      receivedEvents.client2.push(data);
      console.log(`   🎯 Client 2 received job:progress:`, data.jobId, data.type);
    });

    client3.on('job:progress', (data) => {
      receivedEvents.client3.push(data);
      console.log(`   🎯 Client 3 (all-jobs) received job:progress:`, data.jobId, data.type);
    });

    client4.on('room:error', (data) => {
      receivedEvents.client4.push(data);
      console.log(`   ⚠️  Client 4 received room:error:`, data.message);
    });

    // Wait for event setup
    await new Promise(resolve => setTimeout(resolve, 200));

    console.log('\n📝 Test 3: Broadcasting job progress events...');

    // Broadcast to job 1
    broadcastJobProgress(io, validJobId1, {
      type: 'transfer:progress',
      fileId: 'test-file-1',
      progress: 50,
      filename: 'test-file.txt'
    });

    await new Promise(resolve => setTimeout(resolve, 100));

    // Broadcast to job 2
    broadcastJobProgress(io, validJobId2, {
      type: 'transfer:status',
      fileId: 'test-file-2',
      status: 'completed',
      filename: 'another-file.txt'
    });

    await new Promise(resolve => setTimeout(resolve, 100));

    console.log('\n📝 Test 4: Testing ping functionality...');

    client1.emit('ping', (response) => {
      console.log(`   🏓 Ping response from client 1:`, response);
    });

    await new Promise(resolve => setTimeout(resolve, 200));

    console.log('\n📊 Final Results:');
    console.log('Events received by each client:');
    console.log(`   Client 1 (job:${validJobId1}): ${receivedEvents.client1.length} events`);
    console.log(`   Client 2 (job:${validJobId2}): ${receivedEvents.client2.length} events`);
    console.log(`   Client 3 (all-jobs): ${receivedEvents.client3.length} events`);
    console.log(`   Client 4 (invalid): ${receivedEvents.client4.length} error events`);

    console.log('\n✅ Expected Results:');
    console.log('   - Client 1 should receive 1 event (job 1 progress)');
    console.log('   - Client 2 should receive 1 event (job 2 status)');
    console.log('   - Client 3 should receive 2 events (both job 1 and job 2)');
    console.log('   - Client 4 should receive 1 error event');

    // Verify results
    let testsPassed = 0;
    let totalTests = 4;

    if (receivedEvents.client1.length === 1) {
      console.log('   ✅ Client 1 test passed');
      testsPassed++;
    } else {
      console.log('   ❌ Client 1 test failed');
    }

    if (receivedEvents.client2.length === 1) {
      console.log('   ✅ Client 2 test passed');
      testsPassed++;
    } else {
      console.log('   ❌ Client 2 test failed');
    }

    if (receivedEvents.client3.length === 2) {
      console.log('   ✅ Client 3 (all-jobs) test passed');
      testsPassed++;
    } else {
      console.log('   ❌ Client 3 (all-jobs) test failed');
    }

    if (receivedEvents.client4.length >= 1) {
      console.log('   ✅ Client 4 (invalid jobId) test passed');
      testsPassed++;
    } else {
      console.log('   ❌ Client 4 (invalid jobId) test failed');
    }

    console.log(`\n🎯 Test Summary: ${testsPassed}/${totalTests} tests passed`);

    if (testsPassed === totalTests) {
      console.log('🎉 All tests passed! WebSocket integration is working correctly.');
    } else {
      console.log('⚠️  Some tests failed. Check the implementation.');
    }

    // Cleanup
    client1.disconnect();
    client2.disconnect();
    client3.disconnect();
    client4.disconnect();

  } catch (error) {
    console.error('❌ Test failed with error:', error);
  } finally {
    // Close server
    httpServer.close();
    console.log('\n🛑 Test server closed');
  }
}

// Run the test
if (require.main === module) {
  runTest().catch(console.error);
}

module.exports = { runTest };
