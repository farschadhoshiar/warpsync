import { spawn, ChildProcess } from "child_process";
import { logger, devLogger } from "@/lib/logger";
import { EventEmitter } from "../websocket/emitter";
import { RsyncCommandBuilder } from "./command-builder";
import { RsyncProgressParser } from "./progress-parser";
import { SSHKeyManager } from "../ssh/key-manager";
import { SystemValidator } from "./system-validator";
import {
  RsyncConfig,
  RsyncProcess,
  ProcessStatus,
  RsyncManagerConfig,
  DEFAULT_RSYNC_CONFIG,
} from "./types";

export class RsyncManager {
  private processes = new Map<string, RsyncProcess>();
  private config: RsyncManagerConfig;
  private eventEmitter?: EventEmitter;
  private static instance: RsyncManager;

  constructor(
    config: Partial<RsyncManagerConfig> = {},
    eventEmitter?: EventEmitter,
  ) {
    this.config = { ...DEFAULT_RSYNC_CONFIG, ...config };
    this.eventEmitter = eventEmitter;
  }

  static getInstance(
    config?: Partial<RsyncManagerConfig>,
    eventEmitter?: EventEmitter,
  ): RsyncManager {
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
    config: RsyncConfig,
  ): Promise<string> {
    // Validate configuration
    const validation = RsyncCommandBuilder.validateConfig(config);
    if (!validation.valid) {
      throw new Error(
        `Invalid rsync configuration: ${validation.errors.join(", ")}`,
      );
    }

    // Pre-flight system validation
    const systemValidation = await SystemValidator.validateSystem(
      config.source,
      config.destination,
      config.sshConfig?.host,
      {
        checkRsync: true,
        checkSSH: !!config.sshConfig,
        checkPaths: true,
        checkNetwork: !!config.sshConfig?.host,
        timeoutMs: 10000,
      },
    );

    if (!systemValidation.valid) {
      const errorMessage = `System validation failed: ${systemValidation.errors.join(", ")}`;

      // Emit validation error via Socket.IO
      this.eventEmitter?.emitError({
        jobId,
        type: "validation",
        message: errorMessage,
        details: {
          validationErrors: systemValidation.errors,
          validationWarnings: systemValidation.warnings,
          rsyncVersion: systemValidation.rsyncVersion,
          sshVersion: systemValidation.sshVersion,
        },
        timestamp: new Date().toISOString(),
      });

      throw new Error(errorMessage);
    }

    // Log validation warnings if any
    if (systemValidation.warnings.length > 0) {
      logger.warn("System validation completed with warnings", {
        warnings: systemValidation.warnings,
        rsyncVersion: systemValidation.rsyncVersion,
        sshVersion: systemValidation.sshVersion,
      });
    }

    // Check concurrent process limit
    const activeProcesses = this.getActiveProcessCount();
    if (activeProcesses >= this.config.maxConcurrentProcesses) {
      throw new Error("Maximum concurrent transfers reached");
    }

    const processId = `rsync_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const process: RsyncProcess = {
      id: processId,
      config,
      startTime: new Date(),
      status: ProcessStatus.PENDING,
      logs: [],
      errors: [],
    };

    this.processes.set(processId, process);

    try {
      // Build rsync command with temporary SSH key file
      const { args, tempKeyFilePath } =
        await RsyncCommandBuilder.buildCommandWithKeyFile(config);

      // Store temporary key file path for cleanup
      process.tempKeyFilePath = tempKeyFilePath;

      logger.info("Starting rsync transfer", {
        processId,
        jobId,
        fileId,
        args: this.sanitizeArgs(args),
        source: config.source,
        destination: config.destination,
        sshHost: config.sshConfig?.host,
        sshUsername: config.sshConfig?.username,
        sshPort: config.sshConfig?.port,
        hasTempKeyFile: !!tempKeyFilePath,
      });

      // Start the process
      await this.executeRsync(processId, args, jobId, fileId);

      return processId;
    } catch (error) {
      process.status = ProcessStatus.FAILED;
      process.endTime = new Date();
      process.result = {
        success: false,
        exitCode: -1,
        stdout: "",
        stderr: error instanceof Error ? error.message : "Unknown error",
        duration: Date.now() - process.startTime.getTime(),
        error: error instanceof Error ? error.message : "Unknown error",
      };

      // Cleanup temporary SSH key file on error
      if (process.tempKeyFilePath) {
        await SSHKeyManager.cleanupKeyFile(process.tempKeyFilePath);
      }

      logger.error("Failed to start rsync transfer", {
        processId,
        error: error instanceof Error ? error.message : "Unknown error",
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
        // Kill the child process if it exists
        const processWithChild = process as RsyncProcess & {
          childProcess?: ChildProcess;
        };
        if (processWithChild.childProcess) {
          processWithChild.childProcess.kill("SIGTERM");
        }

        process.status = ProcessStatus.CANCELLED;
        process.endTime = new Date();

        logger.info("Cancelled rsync transfer", { processId });
        return true;
      } catch (error) {
        logger.error("Failed to cancel rsync transfer", {
          processId,
          error: error instanceof Error ? error.message : "Unknown error",
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
    return Array.from(this.processes.values()).filter(
      (p) =>
        p.status === ProcessStatus.RUNNING ||
        p.status === ProcessStatus.STARTING,
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
      active: processes.filter((p) => p.status === ProcessStatus.RUNNING)
        .length,
      completed: processes.filter((p) => p.status === ProcessStatus.COMPLETED)
        .length,
      failed: processes.filter((p) => p.status === ProcessStatus.FAILED).length,
      cancelled: processes.filter((p) => p.status === ProcessStatus.CANCELLED)
        .length,
    };
  }

  /**
   * Cleanup completed processes
   */
  cleanup(olderThanMs = 3600000): void {
    // Default: 1 hour
    const cutoff = Date.now() - olderThanMs;

    for (const [id, process] of this.processes) {
      if (process.endTime && process.endTime.getTime() < cutoff) {
        if (
          process.status === ProcessStatus.COMPLETED ||
          process.status === ProcessStatus.FAILED ||
          process.status === ProcessStatus.CANCELLED
        ) {
          this.processes.delete(id);
        }
      }
    }
  }

  private async executeRsync(
    processId: string,
    args: string[],
    jobId: string,
    fileId: string,
  ): Promise<void> {
    const rsyncProcess = this.processes.get(processId)!;
    const parser = new RsyncProgressParser();

    return new Promise((resolve, reject) => {
      rsyncProcess.status = ProcessStatus.STARTING;

      // Extract program and arguments directly from args array
      const [program, ...programArgs] = args;

      // Enhanced execution logging
      const isDevelopment = process.env.NODE_ENV === "development";

      if (isDevelopment) {
        // Find source and destination arguments (typically the last two args)
        const sourceArg = programArgs[programArgs.length - 2];
        const destArg = programArgs[programArgs.length - 1];

        devLogger.info("🚀 EXECUTING RSYNC (DEV)", {
          command: this.sanitizeArgs(args).join(" "),
          hasSpaces: sourceArg?.includes(" ") || destArg?.includes(" "),
          host: rsyncProcess.config.sshConfig?.host,
        });
      } else {
        logger.info("🚀 EXECUTING RSYNC", {
          command: this.sanitizeArgs(args).join(" "),
          args: this.sanitizeArgs(args),
          program,
          argCount: programArgs.length,
        });
      }

      const childProcess = spawn(program, programArgs, {
        stdio: ["ignore", "pipe", "pipe"],
      });

      // Store child process reference for cancellation
      (
        rsyncProcess as RsyncProcess & { childProcess?: ChildProcess }
      ).childProcess = childProcess;

      // Handle spawn errors immediately
      childProcess.on("error", (error) => {
        clearTimeout(timeout);
        rsyncProcess.status = ProcessStatus.FAILED;
        rsyncProcess.endTime = new Date();

        logger.error("🚨 RSYNC SPAWN ERROR", {
          error: error.message,
          args: this.sanitizeArgs(args),
          program,
          processId,
        });

        // Emit real-time error notification
        this.eventEmitter?.emitError({
          jobId,
          type: "transfer",
          message: `Failed to start rsync process: ${error.message}`,
          details: {
            processId,
            errorType: "spawn_error",
            program,
            errorCode: (error as any).code,
            errno: (error as any).errno,
            syscall: (error as any).syscall,
          },
          timestamp: new Date().toISOString(),
        });

        // Cleanup temporary SSH key file on spawn error
        if (rsyncProcess.tempKeyFilePath) {
          SSHKeyManager.cleanupKeyFile(rsyncProcess.tempKeyFilePath).catch(
            (cleanupError) => {
              logger.warn(
                "Failed to cleanup temporary SSH key file on spawn error",
                {
                  processId,
                  keyFilePath: rsyncProcess.tempKeyFilePath,
                  cleanupError:
                    cleanupError instanceof Error
                      ? cleanupError.message
                      : "Unknown error",
                },
              );
            },
          );
        }

        reject(error);
      });

      let stdout = "";
      let stderr = "";

      rsyncProcess.status = ProcessStatus.RUNNING;

      // Set up timeout
      const timeout = setTimeout(() => {
        childProcess.kill("SIGTERM");
        rsyncProcess.status = ProcessStatus.TIMEOUT;
        reject(new Error("Transfer timeout"));
      }, this.config.defaultTimeout);

      // Handle stdout (progress updates)
      childProcess.stdout?.on("data", (data: Buffer) => {
        const lines = data.toString().split("\n");
        stdout += data.toString();

        // Only log stdout for progress or significant events
        if (
          isDevelopment &&
          lines.some(
            (line) => line.includes("receiving") || line.includes("sending"),
          )
        ) {
          devLogger.info("📤 RSYNC PROGRESS (DEV)", {
            processId,
            status: lines.filter((line) => line.trim())[0],
          });
        }

        for (const line of lines) {
          if (line.trim()) {
            rsyncProcess.logs.push(line);

            // Simple progress extraction - just look for percentage
            const percentMatch = line.match(/(\d+)%/);
            if (percentMatch) {
              const percentage = parseInt(percentMatch[1], 10);

              // Extract additional info if available
              const speedMatch = line.match(/([\d.]+[KMGT]*B\/s)/);
              const speed = speedMatch ? speedMatch[1] : "0 B/s";

              const etaMatch = line.match(/(\d+:\d+:\d+)/);
              const eta = etaMatch ? etaMatch[1] : "0:00:00";

              // Update process progress
              rsyncProcess.progress = {
                filename: "",
                fileNumber: 0,
                totalFiles: 0,
                percentage,
                speed,
                eta,
                bytesTransferred: 0,
                totalBytes: 0,
                elapsedTime: 0,
              };

              // Debug logging
              if (isDevelopment) {
                devLogger.info("📊 RSYNC PROGRESS (DEV)", {
                  processId,
                  percentage,
                  speed,
                  eta,
                });
              }

              // Emit real-time progress with unified event system
              this.eventEmitter?.emitUnifiedTransferProgress({
                transferId: processId, // Use processId as transferId for now
                fileId,
                jobId,
                filename: `Transfer in progress`,
                progress: percentage,
                bytesTransferred: 0,
                totalBytes: 0,
                speed,
                speedBps: 0, // TODO: Parse actual speed in bytes per second
                eta,
                etaSeconds: 0, // TODO: Parse actual ETA in seconds
                status: 'transferring',
                elapsedTime: Date.now() - rsyncProcess.startTime.getTime(),
                timestamp: new Date().toISOString(),
              });
            }

            // Emit log message
            this.eventEmitter?.emitLogMessage({
              jobId,
              level: "debug",
              message: line,
              source: "rsync",
              timestamp: new Date().toISOString(),
            });
          }
        }
      });

      // Handle stderr (errors)
      childProcess.stderr?.on("data", (data: Buffer) => {
        const errorLine = data.toString().trim();
        stderr += errorLine + "\n";
        rsyncProcess.errors.push(errorLine);

        // Simplified stderr logging
        if (isDevelopment) {
          devLogger.error("⚠️ RSYNC ERROR (DEV)", {
            processId,
            error: errorLine,
            errorType: this.categorizeError(errorLine),
          });
        } else {
          logger.error("⚠️ RSYNC STDERR", {
            processId,
            error: errorLine,
          });
        }

        // Emit real-time error notification for critical errors
        const errorType = this.categorizeError(errorLine);
        if (this.isCriticalError(errorType)) {
          this.eventEmitter?.emitError({
            jobId,
            type: "transfer",
            message: `Rsync error: ${errorLine}`,
            details: {
              processId,
              errorType,
              errorCategory: this.categorizeError(errorLine),
              isCritical: true,
            },
            timestamp: new Date().toISOString(),
          });
        }

        this.eventEmitter?.emitLogMessage({
          jobId,
          level: "error",
          message: errorLine,
          source: "rsync",
          timestamp: new Date().toISOString(),
        });
      });

      // Handle process completion
      childProcess.on("close", (exitCode) => {
        clearTimeout(timeout);
        rsyncProcess.endTime = new Date();

        const duration =
          rsyncProcess.endTime.getTime() - rsyncProcess.startTime.getTime();
        const success = exitCode === 0;

        logger.info(`🏁 RSYNC ${success ? "SUCCESS" : "FAILED"}`, {
          processId,
          exitCode,
          duration: `${duration}ms`,
          stdout: stdout.length > 0 ? stdout : "(no output)",
          stderr: stderr.length > 0 ? stderr : "(no errors)",
          command: isDevelopment
            ? args.join(" ")
            : this.sanitizeArgs(args).join(" "),
          success,
        });

        rsyncProcess.status = success
          ? ProcessStatus.COMPLETED
          : ProcessStatus.FAILED;
        rsyncProcess.result = {
          success,
          exitCode: exitCode || 0,
          stdout,
          stderr,
          stats: parser.parseStats(stdout) || undefined,
          duration,
          error: success ? undefined : stderr || "Unknown error",
        };

        logger.info("Rsync transfer completed", {
          processId,
          jobId,
          fileId,
          success,
          exitCode,
          duration,
          bytesTransferred: rsyncProcess.progress?.bytesTransferred || 0,
          stdout: stdout.substring(0, 500), // First 500 chars of stdout
          stderr: stderr.substring(0, 500), // First 500 chars of stderr
        });

        // Cleanup temporary SSH key file
        if (rsyncProcess.tempKeyFilePath) {
          SSHKeyManager.cleanupKeyFile(rsyncProcess.tempKeyFilePath).catch(
            (error) => {
              logger.warn("Failed to cleanup temporary SSH key file", {
                processId,
                keyFilePath: rsyncProcess.tempKeyFilePath,
                error: error instanceof Error ? error.message : "Unknown error",
              });
            },
          );
        }

        if (success) {
          resolve();
        } else {
          logger.error("❌ RSYNC COMMAND FAILED", {
            processId,
            command: isDevelopment
              ? args.join(" ")
              : this.sanitizeArgs(args).join(" "),
            args: this.sanitizeArgs(args),
            fullArgs: isDevelopment ? args : "[HIDDEN IN PRODUCTION]",
            exitCode,
            stderr: stderr || "No error details",
            errorLines: rsyncProcess.errors.length,
            duration: `${duration}ms`,
            allErrors: rsyncProcess.errors,
            failureDetails: {
              hasStderr: stderr.length > 0,
              stderrLength: stderr.length,
              lastError:
                rsyncProcess.errors[rsyncProcess.errors.length - 1] ||
                "No specific error",
              firstError: rsyncProcess.errors[0] || "No specific error",
            },
          });

          // Emit comprehensive failure notification
          this.eventEmitter?.emitError({
            jobId,
            type: "transfer",
            message: `Transfer failed with exit code ${exitCode}`,
            details: {
              processId,
              exitCode,
              stderr: stderr || "No error details",
              duration,
              errorCount: rsyncProcess.errors.length,
              lastError: rsyncProcess.errors[rsyncProcess.errors.length - 1],
              firstError: rsyncProcess.errors[0],
              args: this.sanitizeArgs(args),
            },
            timestamp: new Date().toISOString(),
          });

          reject(
            new Error(`Rsync failed with exit code ${exitCode}: ${stderr}`),
          );
        }
      });

      // Handle process errors
      childProcess.on("error", (error) => {
        clearTimeout(timeout);
        rsyncProcess.status = ProcessStatus.FAILED;
        rsyncProcess.endTime = new Date();

        // Enhanced process error logging
        logger.error("💥 RSYNC PROCESS ERROR", {
          processId,
          errorType: error.name,
          errorMessage: error.message,
          args: this.sanitizeArgs(args),
          fullArgs: isDevelopment ? args : "[HIDDEN IN PRODUCTION]",
          errorDetails: {
            code: (error as any).code,
            errno: (error as any).errno,
            syscall: (error as any).syscall,
            path: (error as any).path,
          },
        });

        // Cleanup temporary SSH key file on error
        if (rsyncProcess.tempKeyFilePath) {
          SSHKeyManager.cleanupKeyFile(rsyncProcess.tempKeyFilePath).catch(
            (cleanupError) => {
              logger.warn("Failed to cleanup temporary SSH key file on error", {
                processId,
                keyFilePath: rsyncProcess.tempKeyFilePath,
                cleanupError:
                  cleanupError instanceof Error
                    ? cleanupError.message
                    : "Unknown error",
              });
            },
          );
        }

        reject(error);
      });
    });
  }

  private getActiveProcessCount(): number {
    return Array.from(this.processes.values()).filter(
      (p) =>
        p.status === ProcessStatus.RUNNING ||
        p.status === ProcessStatus.STARTING,
    ).length;
  }

  private sanitizeArgs(args: string[]): string[] {
    // Remove sensitive information from args for logging
    return args.map((arg) => {
      // Replace private key file paths with placeholder
      if (arg.match(/^\/.*\.key$|^\/tmp\/.*$/)) {
        return "[PRIVATE_KEY_FILE]";
      }
      return arg;
    });
  }

  private sanitizeCommand(command: string): string {
    // Remove sensitive information from command for logging
    return command.replace(/(-i\s+)[^\s]+/g, "$1[PRIVATE_KEY_FILE]");
  }

  private categorizeError(errorMessage: string): string {
    const lowerError = errorMessage.toLowerCase();

    if (
      lowerError.includes("no such file") ||
      lowerError.includes("not found")
    ) {
      return "FILE_NOT_FOUND";
    }
    if (lowerError.includes("permission denied")) {
      return "PERMISSION_DENIED";
    }
    if (
      lowerError.includes("connection refused") ||
      lowerError.includes("unreachable")
    ) {
      return "CONNECTION_ERROR";
    }
    if (
      lowerError.includes("invalid argument") ||
      lowerError.includes("bad argument")
    ) {
      return "INVALID_ARGUMENT";
    }
    if (lowerError.includes("ssh")) {
      return "SSH_ERROR";
    }
    if (lowerError.includes("rsync")) {
      return "RSYNC_ERROR";
    }
    if (lowerError.includes("timeout")) {
      return "TIMEOUT_ERROR";
    }

    return "UNKNOWN_ERROR";
  }

  private isCriticalError(errorType: string): boolean {
    const criticalErrors = [
      "CONNECTION_ERROR",
      "PERMISSION_DENIED",
      "SSH_ERROR",
      "RSYNC_ERROR",
    ];
    return criticalErrors.includes(errorType);
  }
}
