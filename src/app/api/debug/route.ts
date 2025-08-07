/**
 * Debug and Testing Utilities API
 * Development tools for testing sync operations
 */

import { NextRequest } from 'next/server';
import { withErrorHandler, createSuccessResponse } from '@/lib/errors';
import { getRequestLogger, PerformanceTimer } from '@/lib/logger/request';
import { TransferQueue } from '@/lib/queue/transfer-queue';
import { RsyncManager } from '@/lib/rsync/rsync-manager';
import { SSHConnectionManager } from '@/lib/ssh/ssh-connection';
import { TransferType, TransferPriority } from '@/lib/queue/types';

/**
 * POST /api/debug/test-transfer
 * Create a test transfer for development/debugging
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  const logger = await getRequestLogger();
  const timer = new PerformanceTimer(logger, 'create_test_transfer');
  
  logger.info('Creating test transfer for debugging');
  
  try {
    const body = await req.json();
    const { 
      serverConfig, 
      testType = 'small-file',
      count = 1,
      priority = 'NORMAL'
    } = body;
    
    if (!serverConfig) {
      throw new Error('Server configuration required');
    }
    
    const transferQueue = TransferQueue.getInstance();
    const transferIds: string[] = [];
    
    // Generate test transfers based on type
    for (let i = 0; i < count; i++) {
      let testTransfer;
      
      switch (testType) {
        case 'small-file':
          testTransfer = {
            jobId: `test-job-${Date.now()}-${i}`,
            fileId: `test-file-${Date.now()}-${i}`,
            type: TransferType.DOWNLOAD,
            priority: TransferPriority[priority as keyof typeof TransferPriority],
            source: '/tmp/test-small.txt',
            destination: `/tmp/downloaded-test-${i}.txt`,
            filename: `test-small-${i}.txt`,
            relativePath: `test/small/${i}/test-small-${i}.txt`,
            size: 1024, // 1KB
            sshConfig: serverConfig,
            maxRetries: 2
          };
          break;
          
        case 'medium-file':
          testTransfer = {
            jobId: `test-job-${Date.now()}-${i}`,
            fileId: `test-file-${Date.now()}-${i}`,
            type: TransferType.DOWNLOAD,
            priority: TransferPriority[priority as keyof typeof TransferPriority],
            source: '/tmp/test-medium.txt',
            destination: `/tmp/downloaded-medium-${i}.txt`,
            filename: `test-medium-${i}.txt`,
            relativePath: `test/medium/${i}/test-medium-${i}.txt`,
            size: 1024 * 1024, // 1MB
            sshConfig: serverConfig,
            maxRetries: 3
          };
          break;
          
        case 'upload':
          testTransfer = {
            jobId: `test-job-${Date.now()}-${i}`,
            fileId: `test-file-${Date.now()}-${i}`,
            type: TransferType.UPLOAD,
            priority: TransferPriority[priority as keyof typeof TransferPriority],
            source: `/tmp/local-test-${i}.txt`,
            destination: `/tmp/uploaded-test-${i}.txt`,
            filename: `uploaded-test-${i}.txt`,
            relativePath: `test/upload/${i}/uploaded-test-${i}.txt`,
            size: 2048, // 2KB
            sshConfig: serverConfig,
            maxRetries: 2
          };
          break;
          
        default:
          throw new Error(`Unknown test type: ${testType}`);
      }
      
      const transferId = await transferQueue.addTransfer(testTransfer);
      transferIds.push(transferId);
    }
    
    logger.info('Test transfers created', {
      testType,
      count: transferIds.length,
      priority,
      duration: timer.end()
    });
    
    return createSuccessResponse({
      transferIds,
      testType,
      count: transferIds.length,
      message: `Created ${transferIds.length} test transfers of type '${testType}'`
    });
    
  } catch (error) {
    timer.endWithError(error);
    throw error;
  }
});

/**
 * GET /api/debug/system-info
 * Get system information and component status
 */
export const GET = withErrorHandler(async () => {
  const logger = await getRequestLogger();
  const timer = new PerformanceTimer(logger, 'get_system_info');
  
  logger.info('Fetching system information');
  
  try {
    const transferQueue = TransferQueue.getInstance();
    const rsyncManager = RsyncManager.getInstance();
    const sshManager = SSHConnectionManager.getInstance();
    
    // Get component status
    const queueStats = transferQueue.getStats();
    const activeRsyncProcesses = rsyncManager.getActiveTransfers();
    const sshStats = sshManager.getPoolStats();
    
    // System health checks
    const healthChecks = {
      transferQueue: {
        status: 'healthy',
        details: `${queueStats.total} total transfers, ${queueStats.active} active`
      },
      rsyncManager: {
        status: 'healthy',
        details: `${activeRsyncProcesses.length} active processes`
      },
      sshManager: {
        status: 'healthy',
        details: `${sshStats.total} total connections, ${sshStats.inUse} in use`
      }
    };
    
    // Memory usage estimation
    const processMemory = process.memoryUsage();
    
    const result = {
      timestamp: new Date().toISOString(),
      environment: {
        nodeVersion: process.version,
        platform: process.platform,
        architecture: process.arch,
        processId: process.pid
      },
      memory: {
        rss: Math.round(processMemory.rss / 1024 / 1024), // MB
        heapTotal: Math.round(processMemory.heapTotal / 1024 / 1024), // MB
        heapUsed: Math.round(processMemory.heapUsed / 1024 / 1024), // MB
        external: Math.round(processMemory.external / 1024 / 1024) // MB
      },
      components: {
        transferQueue: {
          status: 'active',
          stats: queueStats,
          health: healthChecks.transferQueue
        },
        rsyncManager: {
          status: 'active',
          activeProcesses: activeRsyncProcesses.length,
          processes: activeRsyncProcesses.map(p => ({
            id: p.id,
            startTime: p.startTime,
            status: p.status
          })),
          health: healthChecks.rsyncManager
        },
        sshManager: {
          status: 'active',
          connectionStats: sshStats,
          health: healthChecks.sshManager
        }
      },
      health: {
        overall: 'healthy',
        checks: healthChecks
      }
    };
    
    logger.info('System information retrieved', {
      componentsActive: Object.keys(result.components).length,
      memoryUsageMB: result.memory.heapUsed,
      duration: timer.end()
    });
    
    return createSuccessResponse(result);
    
  } catch (error) {
    timer.endWithError(error);
    throw error;
  }
});

/**
 * DELETE /api/debug/cleanup
 * Clean up test data and reset debug state
 */
export const DELETE = withErrorHandler(async () => {
  const logger = await getRequestLogger();
  const timer = new PerformanceTimer(logger, 'debug_cleanup');
  
  logger.info('Starting debug cleanup');
  
  try {
    const transferQueue = TransferQueue.getInstance();
    
    // Get all test transfers (those with jobId starting with 'test-job')
    const allTransfers = transferQueue.getTransfers();
    const testTransfers = allTransfers.filter(t => t.jobId.startsWith('test-job'));
    
    // Cancel all test transfers
    let cancelledCount = 0;
    for (const transfer of testTransfers) {
      const cancelled = await transferQueue.cancelTransfer(transfer.id);
      if (cancelled) {
        cancelledCount++;
      }
    }
    
    logger.info('Debug cleanup completed', {
      testTransfersFound: testTransfers.length,
      transfersCancelled: cancelledCount,
      duration: timer.end()
    });
    
    return createSuccessResponse({
      testTransfersFound: testTransfers.length,
      transfersCancelled: cancelledCount,
      message: `Cleaned up ${cancelledCount} test transfers`
    });
    
  } catch (error) {
    timer.endWithError(error);
    throw error;
  }
});
