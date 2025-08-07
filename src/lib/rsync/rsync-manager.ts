import { spawn } from 'child_process';
import { logger } from '@/lib/logger';
import { EventEmitter } from '../websocket/emitter';
import { RsyncCommandBuilder } from './command-builder';
import { RsyncProgressParser } from './progress-parser';
import { 
  RsyncConfig, 
  RsyncProcess, 
  ProcessStatus,
  RsyncManagerConfig,
  DEFAULT_RSYNC_CONFIG 
} from './types';

export class RsyncManager {
  private processes = new Map<string, RsyncProcess>();
  private config: RsyncManagerConfig;
  private eventEmitter?: EventEmitter;
  private static instance: RsyncManager;

  constructor(config: Partial<RsyncManagerConfig> = {}, eventEmitter?: EventEmitter) {
    this.config = { ...DEFAULT_RSYNC_CONFIG, ...config };
    this.eventEmitter = eventEmitter;
  }

  static getInstance(config?: Partial<RsyncManagerConfig>, eventEmitter?: EventEmitter): RsyncManager {
    if (!RsyncManager.instance) {
      RsyncManager.instance = new RsyncManager(config, eventEmitter);
    }
    return RsyncManager.instance;
  }

  /**
   * Start a new rsync transfer
   */
  async startTransfer(
    jobId: string,
    fileId: string,
    config: RsyncConfig
  ): Promise<string> {
    // Validate configuration
    const validation = RsyncCommandBuilder.validateConfig(config);
    if (!validation.valid) {
      throw new Error(`Invalid rsync configuration: ${validation.errors.join(', ')}`);
    }

    // Check concurrent process limit
    const activeProcesses = this.getActiveProcessCount();
    if (activeProcesses >= this.config.maxConcurrentProcesses) {
      throw new Error('Maximum concurrent transfers reached');
    }

    const processId = `rsync_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const process: RsyncProcess = {
      id: processId,
      config,
      startTime: new Date(),
      status: ProcessStatus.PENDING,
      logs: [],
      errors: []
    };

    this.processes.set(processId, process);

    try {
      // Build rsync command
      const command = RsyncCommandBuilder.buildCommand(config);
      
      logger.info('Starting rsync transfer', {
        processId,
        jobId,
        fileId,
        command: this.sanitizeCommand(command),
        source: config.source,
        destination: config.destination
      });

      // Start the process
      await this.executeRsync(processId, command, jobId, fileId);
      
      return processId;
    } catch (error) {
      process.status = ProcessStatus.FAILED;
      process.endTime = new Date();
      process.result = {
        success: false,
        exitCode: -1,
        stdout: '',
        stderr: error instanceof Error ? error.message : 'Unknown error',
        duration: Date.now() - process.startTime.getTime(),
        error: error instanceof Error ? error.message : 'Unknown error'
      };

      logger.error('Failed to start rsync transfer', {
        processId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      throw error;
    }
  }

  /**
   * Cancel a running transfer
   */
  async cancelTransfer(processId: string): Promise<boolean> {
    const process = this.processes.get(processId);
    if (!process) {
      return false;
    }

    if (process.status === ProcessStatus.RUNNING) {
      try {
        // Kill the process (implementation depends on how we store the child process)
        process.status = ProcessStatus.CANCELLED;
        process.endTime = new Date();
        
        logger.info('Cancelled rsync transfer', { processId });
        return true;
      } catch (error) {
        logger.error('Failed to cancel rsync transfer', {
          processId,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        return false;
      }
    }

    return false;
  }

  /**
   * Get transfer status
   */
  getTransferStatus(processId: string): RsyncProcess | null {
    return this.processes.get(processId) || null;
  }

  /**
   * Get all active transfers
   */
  getActiveTransfers(): RsyncProcess[] {
    return Array.from(this.processes.values()).filter(p => 
      p.status === ProcessStatus.RUNNING || p.status === ProcessStatus.STARTING
    );
  }

  /**
   * Get transfer statistics
   */
  getTransferStats(): {
    total: number;
    active: number;
    completed: number;
    failed: number;
    cancelled: number;
  } {
    const processes = Array.from(this.processes.values());
    return {
      total: processes.length,
      active: processes.filter(p => p.status === ProcessStatus.RUNNING).length,
      completed: processes.filter(p => p.status === ProcessStatus.COMPLETED).length,
      failed: processes.filter(p => p.status === ProcessStatus.FAILED).length,
      cancelled: processes.filter(p => p.status === ProcessStatus.CANCELLED).length
    };
  }

  /**
   * Cleanup completed processes
   */
  cleanup(olderThanMs = 3600000): void { // Default: 1 hour
    const cutoff = Date.now() - olderThanMs;
    
    for (const [id, process] of this.processes) {
      if (process.endTime && process.endTime.getTime() < cutoff) {
        if (process.status === ProcessStatus.COMPLETED || 
            process.status === ProcessStatus.FAILED ||
            process.status === ProcessStatus.CANCELLED) {
          this.processes.delete(id);
        }
      }
    }
  }

  private async executeRsync(
    processId: string,
    command: string,
    jobId: string,
    fileId: string
  ): Promise<void> {
    const process = this.processes.get(processId)!;
    const parser = new RsyncProgressParser();
    
    return new Promise((resolve, reject) => {
      process.status = ProcessStatus.STARTING;
      
      // Split command into program and arguments
      const parts = command.split(' ');
      const program = parts[0];
      const args = parts.slice(1);

      // Spawn the rsync process
      const childProcess = spawn(program, args, {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      process.status = ProcessStatus.RUNNING;

      // Set up timeout
      const timeout = setTimeout(() => {
        childProcess.kill('SIGTERM');
        process.status = ProcessStatus.TIMEOUT;
        reject(new Error('Transfer timeout'));
      }, this.config.defaultTimeout);

      // Handle stdout (progress updates)
      childProcess.stdout?.on('data', (data: Buffer) => {
        const lines = data.toString().split('\n');
        stdout += data.toString();
        
        for (const line of lines) {
          if (line.trim()) {
            process.logs.push(line);
            
            // Parse progress
            const progress = parser.parseProgressLine(line);
            if (progress) {
              process.progress = progress;
              
              // Emit real-time progress
              this.eventEmitter?.emitTransferProgress({
                jobId,
                fileId,
                filename: progress.filename,
                progress: progress.percentage,
                speed: progress.speed,
                eta: progress.eta,
                bytesTransferred: progress.bytesTransferred,
                totalBytes: progress.totalBytes
              });
            }

            // Emit log message
            this.eventEmitter?.emitLogMessage({
              jobId,
              level: 'debug',
              message: line,
              source: 'rsync',
              timestamp: new Date().toISOString()
            });
          }
        }
      });

      // Handle stderr (errors)
      childProcess.stderr?.on('data', (data: Buffer) => {
        const errorLine = data.toString();
        stderr += errorLine;
        process.errors.push(errorLine);
        
        this.eventEmitter?.emitLogMessage({
          jobId,
          level: 'error',
          message: errorLine,
          source: 'rsync',
          timestamp: new Date().toISOString()
        });
      });

      // Handle process completion
      childProcess.on('close', (exitCode) => {
        clearTimeout(timeout);
        process.endTime = new Date();
        
        const duration = process.endTime.getTime() - process.startTime.getTime();
        const success = exitCode === 0;
        
        process.status = success ? ProcessStatus.COMPLETED : ProcessStatus.FAILED;
        process.result = {
          success,
          exitCode: exitCode || 0,
          stdout,
          stderr,
          stats: parser.parseStats(stdout) || undefined,
          duration,
          error: success ? undefined : stderr || 'Unknown error'
        };

        logger.info('Rsync transfer completed', {
          processId,
          jobId,
          fileId,
          success,
          exitCode,
          duration,
          bytesTransferred: process.progress?.bytesTransferred || 0
        });

        if (success) {
          resolve();
        } else {
          reject(new Error(`Rsync failed with exit code ${exitCode}: ${stderr}`));
        }
      });

      // Handle process errors
      childProcess.on('error', (error) => {
        clearTimeout(timeout);
        process.status = ProcessStatus.FAILED;
        process.endTime = new Date();
        
        logger.error('Rsync process error', {
          processId,
          error: error.message
        });
        
        reject(error);
      });
    });
  }

  private getActiveProcessCount(): number {
    return Array.from(this.processes.values()).filter(p => 
      p.status === ProcessStatus.RUNNING || p.status === ProcessStatus.STARTING
    ).length;
  }

  private sanitizeCommand(command: string): string {
    // Remove sensitive information from command for logging
    return command
      .replace(/(-i\s+)[^\s]+/g, '$1[PRIVATE_KEY]')
      .replace(/password[^\s]*/gi, '[PASSWORD]');
  }
}
