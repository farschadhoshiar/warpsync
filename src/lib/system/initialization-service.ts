import { logger } from '@/lib/logger';
import { DatabaseSyncedTransferQueue } from '@/lib/queue/database-synced-transfer-queue';
import { TransferStateManager } from '@/lib/queue/transfer-state-manager';
import { JobConcurrencyController } from '@/lib/queue/job-concurrency-controller';
import { StateRecoveryService } from '@/lib/queue/state-recovery-service';
import { EventEmitter } from '@/lib/websocket/emitter';
import { DEFAULT_QUEUE_CONFIG, DEFAULT_RETRY_POLICY } from '@/lib/queue/types';

export interface SystemHealthCheck {
  name: string;
  healthy: boolean;
  message: string;
  lastCheck: Date;
  duration: number;
}

export interface SystemStats {
  uptime: number;
  transferQueue: any;
  concurrency: any;
  database: {
    connected: boolean;
    collections: {
      fileStates: number;
      syncJobs: number;
      serverProfiles: number;
    };
  };
  memory: {
    used: number;
    total: number;
    percentage: number;
  };
  lastHealthCheck: Date;
  healthChecks: SystemHealthCheck[];
}

export class SystemInitializationService {
  private transferQueue?: DatabaseSyncedTransferQueue;
  private stateManager?: TransferStateManager;
  private concurrencyController?: JobConcurrencyController;
  private recoveryService?: StateRecoveryService;
  private eventEmitter?: EventEmitter;

  private healthCheckInterval?: NodeJS.Timeout;
  private monitoringInterval?: NodeJS.Timeout;
  private cleanupInterval?: NodeJS.Timeout;

  private isInitialized = false;
  private startTime = Date.now();
  private healthChecks: SystemHealthCheck[] = [];

  private readonly HEALTH_CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes
  private readonly MONITORING_INTERVAL = 2 * 60 * 1000; // 2 minutes
  private readonly CLEANUP_INTERVAL = 30 * 60 * 1000; // 30 minutes

  /**
   * Initialize all transfer-related services on startup
   */
  async initializeTransferSystem(eventEmitter?: EventEmitter): Promise<void> {
    if (this.isInitialized) {
      logger.warn('Transfer system already initialized');
      return;
    }

    const initStartTime = Date.now();
    logger.info('Starting transfer system initialization');

    try {
      // Store event emitter
      this.eventEmitter = eventEmitter;

      // Step 1: Initialize transfer state manager
      this.stateManager = new TransferStateManager(eventEmitter);
      logger.info('Transfer state manager initialized');

      // Step 2: Initialize concurrency controller
      this.concurrencyController = new JobConcurrencyController();
      await this.concurrencyController.initializeJobSlots();
      logger.info('Job concurrency controller initialized');

      // Step 3: Initialize recovery service
      this.recoveryService = new StateRecoveryService(
        this.stateManager,
        this.concurrencyController
      );
      logger.info('State recovery service initialized');

      // Step 4: Initialize database-synced transfer queue
      this.transferQueue = new DatabaseSyncedTransferQueue(
        DEFAULT_QUEUE_CONFIG,
        DEFAULT_RETRY_POLICY,
        eventEmitter
      );
      await this.transferQueue.initializeFromDatabase();
      logger.info('Database-synced transfer queue initialized');

      // Step 5: Run initial system recovery
      const recoveryResult = await this.recoveryService.recoverSystemState();
      logger.info('Initial system recovery completed', recoveryResult);

      // Step 6: Run initial health checks
      await this.runHealthChecks();

      // Step 7: Setup monitoring
      await this.setupMonitoring();

      this.isInitialized = true;
      const initDuration = Date.now() - initStartTime;

      logger.info('Transfer system initialization completed successfully', {
        duration: initDuration,
        recoveryResult,
        healthChecks: this.healthChecks.length
      });

    } catch (error) {
      const initDuration = Date.now() - initStartTime;
      logger.error('Transfer system initialization failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: initDuration
      });
      throw error;
    }
  }

  /**
   * Run comprehensive health checks
   */
  async runHealthChecks(): Promise<SystemHealthCheck[]> {
    const healthChecks: SystemHealthCheck[] = [];
    const checkStartTime = Date.now();

    logger.debug('Running system health checks');

    // Check 1: Database connectivity
    await this.checkDatabaseHealth(healthChecks);

    // Check 2: Transfer queue health
    await this.checkTransferQueueHealth(healthChecks);

    // Check 3: Concurrency controller health
    await this.checkConcurrencyHealth(healthChecks);

    // Check 4: State consistency
    await this.checkStateConsistency(healthChecks);

    // Check 5: System resources
    await this.checkSystemResources(healthChecks);

    // Check 6: WebSocket connectivity
    await this.checkWebSocketHealth(healthChecks);

    this.healthChecks = healthChecks;
    const totalDuration = Date.now() - checkStartTime;

    const healthyChecks = healthChecks.filter(c => c.healthy).length;
    const unhealthyChecks = healthChecks.length - healthyChecks;

    logger.info('Health checks completed', {
      total: healthChecks.length,
      healthy: healthyChecks,
      unhealthy: unhealthyChecks,
      duration: totalDuration
    });

    if (unhealthyChecks > 0) {
      logger.warn('Unhealthy system components detected', {
        unhealthyChecks: healthChecks.filter(c => !c.healthy)
      });
    }

    return healthChecks;
  }

  /**
   * Setup monitoring intervals
   */
  async setupMonitoring(): Promise<void> {
    logger.info('Setting up system monitoring');

    // Health check monitoring
    this.healthCheckInterval = setInterval(async () => {
      try {
        await this.runHealthChecks();
      } catch (error) {
        logger.error('Health check monitoring error', {
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }, this.HEALTH_CHECK_INTERVAL);

    // General monitoring
    this.monitoringInterval = setInterval(async () => {
      try {
        await this.performMonitoringTasks();
      } catch (error) {
        logger.error('Monitoring task error', {
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }, this.MONITORING_INTERVAL);

    // Cleanup monitoring
    this.cleanupInterval = setInterval(async () => {
      try {
        await this.performCleanupTasks();
      } catch (error) {
        logger.error('Cleanup task error', {
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }, this.CLEANUP_INTERVAL);

    logger.info('System monitoring setup completed');
  }

  /**
   * Get comprehensive system statistics
   */
  async getSystemStats(): Promise<SystemStats> {
    const uptime = Date.now() - this.startTime;

    // Memory usage
    const memUsage = process.memoryUsage();
    const memory = {
      used: memUsage.heapUsed,
      total: memUsage.heapTotal,
      percentage: (memUsage.heapUsed / memUsage.heapTotal) * 100
    };

    // Transfer queue stats
    const transferQueueStats = this.transferQueue ?
      await this.transferQueue.getEnhancedStats() : null;

    // Concurrency stats
    const concurrencyStats = this.concurrencyController ?
      this.concurrencyController.getStats() : null;

    // Database stats
    const databaseStats = await this.getDatabaseStats();

    return {
      uptime,
      transferQueue: transferQueueStats,
      concurrency: concurrencyStats,
      database: databaseStats,
      memory,
      lastHealthCheck: this.healthChecks.length > 0 ?
        this.healthChecks[0].lastCheck : new Date(),
      healthChecks: this.healthChecks
    };
  }

  /**
   * Graceful shutdown handling
   */
  async gracefulShutdown(): Promise<void> {
    logger.info('Starting graceful system shutdown');
    const shutdownStartTime = Date.now();

    try {
      // Clear monitoring intervals
      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval);
        this.healthCheckInterval = undefined;
      }

      if (this.monitoringInterval) {
        clearInterval(this.monitoringInterval);
        this.monitoringInterval = undefined;
      }

      if (this.cleanupInterval) {
        clearInterval(this.cleanupInterval);
        this.cleanupInterval = undefined;
      }

      // Shutdown transfer queue
      if (this.transferQueue) {
        await this.transferQueue.shutdown();
        logger.info('Transfer queue shutdown completed');
      }

      // Clear concurrency slots
      if (this.concurrencyController) {
        this.concurrencyController.clearAllSlots();
        logger.info('Concurrency controller cleared');
      }

      // Perform final cleanup
      await this.performCleanupTasks();

      this.isInitialized = false;
      const shutdownDuration = Date.now() - shutdownStartTime;

      logger.info('System shutdown completed successfully', {
        duration: shutdownDuration
      });

    } catch (error) {
      const shutdownDuration = Date.now() - shutdownStartTime;
      logger.error('Error during system shutdown', {
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: shutdownDuration
      });
      throw error;
    }
  }

  /**
   * Check database health
   */
  private async checkDatabaseHealth(healthChecks: SystemHealthCheck[]): Promise<void> {
    const checkStart = Date.now();

    try {
      const { FileState } = await import('@/models');
      await FileState.countDocuments({}).limit(1);

      healthChecks.push({
        name: 'Database Connectivity',
        healthy: true,
        message: 'Database connection successful',
        lastCheck: new Date(),
        duration: Date.now() - checkStart
      });

    } catch (error) {
      healthChecks.push({
        name: 'Database Connectivity',
        healthy: false,
        message: `Database connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        lastCheck: new Date(),
        duration: Date.now() - checkStart
      });
    }
  }

  /**
   * Check transfer queue health
   */
  private async checkTransferQueueHealth(healthChecks: SystemHealthCheck[]): Promise<void> {
    const checkStart = Date.now();

    try {
      if (!this.transferQueue) {
        throw new Error('Transfer queue not initialized');
      }

      const queueHealth = await this.transferQueue.healthCheck();

      healthChecks.push({
        name: 'Transfer Queue',
        healthy: queueHealth.healthy,
        message: queueHealth.healthy ? 'Transfer queue healthy' : 'Transfer queue issues detected',
        lastCheck: new Date(),
        duration: Date.now() - checkStart
      });

    } catch (error) {
      healthChecks.push({
        name: 'Transfer Queue',
        healthy: false,
        message: `Transfer queue error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        lastCheck: new Date(),
        duration: Date.now() - checkStart
      });
    }
  }

  /**
   * Check concurrency controller health
   */
  private async checkConcurrencyHealth(healthChecks: SystemHealthCheck[]): Promise<void> {
    const checkStart = Date.now();

    try {
      if (!this.concurrencyController) {
        throw new Error('Concurrency controller not initialized');
      }

      const stats = this.concurrencyController.getStats();
      const healthy = stats.totalActiveJobs >= 0 && stats.totalActiveTransfers >= 0;

      healthChecks.push({
        name: 'Concurrency Controller',
        healthy,
        message: healthy ?
          `${stats.totalActiveJobs} active jobs, ${stats.totalActiveTransfers} transfers` :
          'Concurrency controller in invalid state',
        lastCheck: new Date(),
        duration: Date.now() - checkStart
      });

    } catch (error) {
      healthChecks.push({
        name: 'Concurrency Controller',
        healthy: false,
        message: `Concurrency controller error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        lastCheck: new Date(),
        duration: Date.now() - checkStart
      });
    }
  }

  /**
   * Check state consistency
   */
  private async checkStateConsistency(healthChecks: SystemHealthCheck[]): Promise<void> {
    const checkStart = Date.now();

    try {
      if (!this.recoveryService) {
        throw new Error('Recovery service not initialized');
      }

      const validation = await this.recoveryService.validateStateConsistency(this.transferQueue);

      healthChecks.push({
        name: 'State Consistency',
        healthy: validation.isValid,
        message: validation.isValid ?
          'State consistency validated' :
          `${validation.issues.length} consistency issues found`,
        lastCheck: new Date(),
        duration: Date.now() - checkStart
      });

    } catch (error) {
      healthChecks.push({
        name: 'State Consistency',
        healthy: false,
        message: `State consistency check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        lastCheck: new Date(),
        duration: Date.now() - checkStart
      });
    }
  }

  /**
   * Check system resources
   */
  private async checkSystemResources(healthChecks: SystemHealthCheck[]): Promise<void> {
    const checkStart = Date.now();

    try {
      const memUsage = process.memoryUsage();
      const memoryPercentage = (memUsage.heapUsed / memUsage.heapTotal) * 100;
      const healthy = memoryPercentage < 90; // Alert if memory usage > 90%

      healthChecks.push({
        name: 'System Resources',
        healthy,
        message: `Memory usage: ${memoryPercentage.toFixed(1)}%`,
        lastCheck: new Date(),
        duration: Date.now() - checkStart
      });

    } catch (error) {
      healthChecks.push({
        name: 'System Resources',
        healthy: false,
        message: `Resource check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        lastCheck: new Date(),
        duration: Date.now() - checkStart
      });
    }
  }

  /**
   * Check WebSocket health
   */
  private async checkWebSocketHealth(healthChecks: SystemHealthCheck[]): Promise<void> {
    const checkStart = Date.now();

    try {
      const healthy = !!global.io && typeof global.io.emit === 'function';

      healthChecks.push({
        name: 'WebSocket Server',
        healthy,
        message: healthy ? 'WebSocket server available' : 'WebSocket server not available',
        lastCheck: new Date(),
        duration: Date.now() - checkStart
      });

    } catch (error) {
      healthChecks.push({
        name: 'WebSocket Server',
        healthy: false,
        message: `WebSocket check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        lastCheck: new Date(),
        duration: Date.now() - checkStart
      });
    }
  }

  /**
   * Perform routine monitoring tasks
   */
  private async performMonitoringTasks(): Promise<void> {
    logger.debug('Performing monitoring tasks');

    try {
      // Check for orphaned transfers
      if (this.recoveryService) {
        const orphanedCount = await this.recoveryService.handleOrphanedTransfers();
        if (orphanedCount > 0) {
          logger.warn('Orphaned transfers cleaned up during monitoring', { orphanedCount });
        }
      }

      // Log system statistics
      const stats = await this.getSystemStats();
      logger.debug('System monitoring stats', {
        uptime: Math.round(stats.uptime / 1000 / 60), // minutes
        memoryUsage: `${stats.memory.percentage.toFixed(1)}%`,
        activeTransfers: stats.concurrency?.totalActiveTransfers || 0,
        healthyChecks: stats.healthChecks.filter(c => c.healthy).length
      });

    } catch (error) {
      logger.error('Monitoring task failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Perform cleanup tasks
   */
  private async performCleanupTasks(): Promise<void> {
    logger.debug('Performing cleanup tasks');

    try {
      // Clean up old completed transfers
      if (this.recoveryService) {
        const cleanedCount = await this.recoveryService.cleanupOldTransfers(7 * 24 * 60 * 60 * 1000); // 7 days
        if (cleanedCount > 0) {
          logger.info('Old transfers cleaned up', { cleanedCount });
        }
      }

      // Clean up old state history
      if (this.stateManager) {
        const historyCleanedCount = await this.stateManager.cleanupOldStateHistory();
        if (historyCleanedCount > 0) {
          logger.info('Old state history cleaned up', { historyCleanedCount });
        }
      }

    } catch (error) {
      logger.error('Cleanup task failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Get database statistics
   */
  private async getDatabaseStats(): Promise<any> {
    try {
      const { FileState, SyncJob, ServerProfile } = await import('@/models');

      const [fileStateCount, syncJobCount, serverProfileCount] = await Promise.all([
        FileState.countDocuments({}),
        SyncJob.countDocuments({}),
        ServerProfile.countDocuments({})
      ]);

      return {
        connected: true,
        collections: {
          fileStates: fileStateCount,
          syncJobs: syncJobCount,
          serverProfiles: serverProfileCount
        }
      };

    } catch (error) {
      return {
        connected: false,
        collections: {
          fileStates: 0,
          syncJobs: 0,
          serverProfiles: 0
        },
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Get service instances (for external access)
   */
  getServices() {
    return {
      transferQueue: this.transferQueue,
      stateManager: this.stateManager,
      concurrencyController: this.concurrencyController,
      recoveryService: this.recoveryService,
      isInitialized: this.isInitialized
    };
  }
}
