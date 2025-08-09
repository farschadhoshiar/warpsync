import { spawn } from 'child_process';
import { access, constants } from 'fs/promises';
import { dirname } from 'path';
import { logger } from '@/lib/logger';

export interface SystemValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  rsyncVersion?: string;
  sshVersion?: string;
}

export interface ValidationOptions {
  checkRsync?: boolean;
  checkSSH?: boolean;
  checkPaths?: boolean;
  checkNetwork?: boolean;
  timeoutMs?: number;
}

export class SystemValidator {
  private static readonly DEFAULT_TIMEOUT = 10000; // 10 seconds

  /**
   * Comprehensive system validation for rsync transfers
   */
  static async validateSystem(
    sourcePath?: string,
    destinationPath?: string,
    sshHost?: string,
    options: ValidationOptions = {}
  ): Promise<SystemValidationResult> {
    const {
      checkRsync = true,
      checkSSH = true,
      checkPaths = true,
      checkNetwork = true,
      timeoutMs = SystemValidator.DEFAULT_TIMEOUT
    } = options;

    const result: SystemValidationResult = {
      valid: true,
      errors: [],
      warnings: []
    };

    const validationPromises: Promise<void>[] = [];

    // Validate rsync binary
    if (checkRsync) {
      validationPromises.push(
        SystemValidator.validateRsyncBinary(result, timeoutMs)
      );
    }

    // Validate SSH client
    if (checkSSH) {
      validationPromises.push(
        SystemValidator.validateSSHClient(result, timeoutMs)
      );
    }

    // Validate paths
    if (checkPaths && destinationPath) {
      validationPromises.push(
        SystemValidator.validatePaths(result, destinationPath)
      );
    }

    // Validate network connectivity
    if (checkNetwork && sshHost) {
      validationPromises.push(
        SystemValidator.validateNetworkConnectivity(result, sshHost, timeoutMs)
      );
    }

    // Execute all validations in parallel
    await Promise.allSettled(validationPromises);

    // Final validation result
    result.valid = result.errors.length === 0;

    logger.info('System validation completed', {
      valid: result.valid,
      errorCount: result.errors.length,
      warningCount: result.warnings.length,
      rsyncVersion: result.rsyncVersion,
      sshVersion: result.sshVersion
    });

    return result;
  }

  /**
   * Validate rsync binary availability and version
   */
  private static async validateRsyncBinary(
    result: SystemValidationResult,
    timeoutMs: number
  ): Promise<void> {
    try {
      const version = await SystemValidator.executeCommand('rsync', ['--version'], timeoutMs);
      
      if (!version) {
        result.errors.push('rsync binary not found in PATH');
        return;
      }

      // Extract version from output
      const versionMatch = version.match(/rsync\s+version\s+(\d+\.\d+\.\d+)/i);
      if (versionMatch) {
        result.rsyncVersion = versionMatch[1];
        
        // Check minimum version (rsync 3.0+ recommended)
        const [major, minor] = result.rsyncVersion.split('.').map(Number);
        if (major < 3) {
          result.warnings.push(`rsync version ${result.rsyncVersion} is outdated. Version 3.0+ recommended.`);
        }
      } else {
        result.warnings.push('Could not determine rsync version');
      }

      logger.debug('rsync binary validation successful', {
        version: result.rsyncVersion
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      result.errors.push(`rsync validation failed: ${errorMessage}`);
      logger.error('rsync binary validation failed', { error: errorMessage });
    }
  }

  /**
   * Validate SSH client availability and version
   */
  private static async validateSSHClient(
    result: SystemValidationResult,
    timeoutMs: number
  ): Promise<void> {
    try {
      const version = await SystemValidator.executeCommand('ssh', ['-V'], timeoutMs);
      
      if (!version) {
        result.errors.push('ssh client not found in PATH');
        return;
      }

      // Extract SSH version
      const versionMatch = version.match(/OpenSSH[_\s](\d+\.\d+)/i);
      if (versionMatch) {
        result.sshVersion = versionMatch[1];
      } else {
        result.warnings.push('Could not determine SSH version');
      }

      logger.debug('SSH client validation successful', {
        version: result.sshVersion
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      result.errors.push(`SSH client validation failed: ${errorMessage}`);
      logger.error('SSH client validation failed', { error: errorMessage });
    }
  }

  /**
   * Validate file system paths and permissions
   */
  private static async validatePaths(
    result: SystemValidationResult,
    destinationPath: string
  ): Promise<void> {
    try {
      // Check if destination directory exists or can be created
      const destDir = dirname(destinationPath);
      
      try {
        await access(destDir, constants.F_OK);
        // Directory exists, check write permissions
        await access(destDir, constants.W_OK);
      } catch (accessError) {
        // Try to access parent directories to provide helpful error messages
        const pathParts = destDir.split('/').filter(Boolean);
        let currentPath = '/';
        
        for (let i = 0; i < pathParts.length; i++) {
          currentPath += pathParts[i] + '/';
          try {
            await access(currentPath, constants.F_OK);
          } catch {
            result.errors.push(`Directory does not exist and cannot be created: ${currentPath}`);
            break;
          }
        }
        
        if (result.errors.length === 0) {
          result.errors.push(`No write permission for destination directory: ${destDir}`);
        }
      }

      logger.debug('Path validation completed', {
        destinationPath,
        destinationDir: destDir
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      result.warnings.push(`Path validation warning: ${errorMessage}`);
      logger.warn('Path validation failed', { error: errorMessage, destinationPath });
    }
  }

  /**
   * Validate network connectivity to target host
   */
  private static async validateNetworkConnectivity(
    result: SystemValidationResult,
    host: string,
    timeoutMs: number
  ): Promise<void> {
    try {
      // Use ping for basic connectivity test
      await SystemValidator.executeCommand('ping', ['-c', '1', '-W', '5', host], timeoutMs);
      
      logger.debug('Network connectivity validation successful', { host });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      result.warnings.push(`Network connectivity test failed for ${host}: ${errorMessage}`);
      logger.warn('Network connectivity validation failed', { error: errorMessage, host });
    }
  }

  /**
   * Execute command with timeout and return output
   */
  private static executeCommand(
    command: string,
    args: string[],
    timeoutMs: number
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`Command timeout after ${timeoutMs}ms: ${command} ${args.join(' ')}`));
      }, timeoutMs);

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        clearTimeout(timeout);
        
        if (code === 0) {
          resolve(stdout || stderr); // Some commands output to stderr (like ssh -V)
        } else {
          reject(new Error(`Command failed with exit code ${code}: ${stderr || 'No error details'}`));
        }
      });

      child.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  /**
   * Quick validation for critical dependencies only
   */
  static async validateCriticalDependencies(): Promise<SystemValidationResult> {
    return SystemValidator.validateSystem(undefined, undefined, undefined, {
      checkRsync: true,
      checkSSH: true,
      checkPaths: false,
      checkNetwork: false,
      timeoutMs: 5000 // Shorter timeout for critical checks
    });
  }
}
