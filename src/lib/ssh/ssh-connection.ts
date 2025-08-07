import { Client } from 'ssh2';
import { logger } from '@/lib/logger';
import { SSHConnectionPool } from './connection-pool';
import { 
  SSHConnectionConfig, 
  SSHFileInfo, 
  SSHDirectoryListing, 
  SSHCommandResult
} from './types';
import { 
  normalizeRemotePath, 
  buildSSHCommand, 
  escapeShellArg,
  parseCommandResult,
  createSSHError,
  validatePath,
  getTimeoutForOperation
} from './utils';

export class SSHConnectionManager {
  private pool: SSHConnectionPool;
  private static instance: SSHConnectionManager;

  constructor() {
    this.pool = new SSHConnectionPool();
  }

  static getInstance(): SSHConnectionManager {
    if (!SSHConnectionManager.instance) {
      SSHConnectionManager.instance = new SSHConnectionManager();
    }
    return SSHConnectionManager.instance;
  }

  /**
   * Test SSH connection with comprehensive diagnostics
   */
  async testConnection(config: SSHConnectionConfig): Promise<{
    success: boolean;
    message: string;
    details: {
      connectionTime: number;
      serverInfo?: string;
      homeDirectory?: string;
      permissions?: string;
    };
  }> {
    const startTime = Date.now();
    
    try {
      const connection = await this.pool.getConnection(config);
      const connectionTime = Date.now() - startTime;

      try {
        // Test basic command execution
        const whoamiResult = await this.executeCommand(connection.id, 'whoami');
        const pwdResult = await this.executeCommand(connection.id, 'pwd');
        const unameResult = await this.executeCommand(connection.id, 'uname -a');

        this.pool.releaseConnection(connection.id);

        return {
          success: true,
          message: 'SSH connection successful',
          details: {
            connectionTime,
            serverInfo: unameResult.stdout || 'Unknown',
            homeDirectory: pwdResult.stdout || 'Unknown',
            permissions: whoamiResult.stdout || 'Unknown'
          }
        };
      } catch (commandError) {
        this.pool.releaseConnection(connection.id);
        throw commandError;
      }
    } catch (error) {
      const connectionTime = Date.now() - startTime;
      
      logger.error('SSH connection test failed', {
        host: config.host,
        port: config.port,
        username: config.username,
        error: error instanceof Error ? error.message : 'Unknown error',
        connectionTime
      });

      return {
        success: false,
        message: error instanceof Error ? error.message : 'Connection failed',
        details: {
          connectionTime
        }
      };
    }
  }

  /**
   * Execute a command on the remote server
   */
  async executeCommand(connectionId: string, command: string): Promise<SSHCommandResult> {
    return new Promise((resolve, reject) => {
      const connection = this.getConnectionById(connectionId);
      if (!connection) {
        reject(createSSHError('Connection not found', 'CONNECTION_NOT_FOUND'));
        return;
      }

      const startTime = Date.now();
      let stdout = '';
      let stderr = '';

      const timeout = setTimeout(() => {
        reject(createSSHError('Command execution timeout', 'COMMAND_TIMEOUT', 'command', true));
      }, getTimeoutForOperation('command'));

      connection.exec(command, (err, stream) => {
        if (err) {
          clearTimeout(timeout);
          reject(createSSHError(
            `Failed to execute command: ${err.message}`,
            'COMMAND_EXEC_ERROR',
            'command',
            false
          ));
          return;
        }

        stream.on('close', (exitCode: number) => {
          clearTimeout(timeout);
          const executionTime = Date.now() - startTime;
          
          const result = parseCommandResult(stdout, stderr, exitCode, executionTime);
          
          if (exitCode === 0) {
            resolve(result);
          } else {
            reject(createSSHError(
              `Command failed with exit code ${exitCode}: ${stderr || stdout}`,
              'COMMAND_FAILED',
              'command',
              false
            ));
          }
        });

        stream.on('data', (data: Buffer) => {
          stdout += data.toString();
        });

        stream.stderr.on('data', (data: Buffer) => {
          stderr += data.toString();
        });
      });
    });
  }

  /**
   * List directory contents on remote server
   */
  async listDirectory(config: SSHConnectionConfig, remotePath: string): Promise<SSHDirectoryListing> {
    const pathValidation = validatePath(remotePath, true);
    if (!pathValidation.valid) {
      throw createSSHError(
        `Invalid remote path: ${pathValidation.error}`,
        'INVALID_PATH'
      );
    }

    const normalizedPath = normalizeRemotePath(remotePath);
    const connection = await this.pool.getConnection(config);

    try {
      // Use ls with detailed format for comprehensive file information
      const command = buildSSHCommand('ls', ['-la', '--time-style=full-iso', escapeShellArg(normalizedPath)]);
      const result = await this.executeCommand(connection.id, command);

      const files = this.parseLsOutput(result.stdout, normalizedPath);
      
      this.pool.releaseConnection(connection.id);

      return {
        path: normalizedPath,
        files,
        scannedAt: new Date(),
        totalFiles: files.length,
        totalSize: files.reduce((sum, file) => sum + file.size, 0)
      };
    } catch (error) {
      this.pool.releaseConnection(connection.id);
      throw error;
    }
  }

  /**
   * Get file information for a specific remote file
   */
  async getFileInfo(config: SSHConnectionConfig, remotePath: string): Promise<SSHFileInfo> {
    const pathValidation = validatePath(remotePath, true);
    if (!pathValidation.valid) {
      throw createSSHError(
        `Invalid remote path: ${pathValidation.error}`,
        'INVALID_PATH'
      );
    }

    const normalizedPath = normalizeRemotePath(remotePath);
    const connection = await this.pool.getConnection(config);

    try {
      const command = buildSSHCommand('stat', ['-c', '%n|%s|%Y|%A|%F', escapeShellArg(normalizedPath)]);
      const result = await this.executeCommand(connection.id, command);

      const fileInfo = this.parseStatOutput(result.stdout, normalizedPath);
      
      this.pool.releaseConnection(connection.id);
      return fileInfo;
    } catch (error) {
      this.pool.releaseConnection(connection.id);
      throw error;
    }
  }

  /**
   * Check if a remote path exists
   */
  async pathExists(config: SSHConnectionConfig, remotePath: string): Promise<boolean> {
    try {
      await this.getFileInfo(config, remotePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get connection statistics
   */
  getPoolStats() {
    return this.pool.getConnectionStats();
  }

  /**
   * Close all connections
   */
  async cleanup(): Promise<void> {
    await this.pool.closeAllConnections();
  }

  private getConnectionById(connectionId: string): Client | null {
    // This is a simplified version - in the real implementation,
    // we'd need to track active connections by ID
    void connectionId; // TODO: Implement connection tracking
    return null;
  }

  private parseLsOutput(lsOutput: string, basePath: string): SSHFileInfo[] {
    const lines = lsOutput.split('\n').filter(line => line.trim() && !line.startsWith('total'));
    const files: SSHFileInfo[] = [];

    for (const line of lines) {
      try {
        const file = this.parseLsLine(line, basePath);
        if (file && file.name !== '.' && file.name !== '..') {
          files.push(file);
        }
      } catch (error) {
        logger.warn('Failed to parse ls line', { line, error });
      }
    }

    return files;
  }

  private parseLsLine(line: string, basePath: string): SSHFileInfo | null {
    // Parse ls -la output format:
    // drwxr-xr-x 2 user group 4096 2023-01-01 12:00:00.000000000 +0000 filename
    const parts = line.trim().split(/\s+/);
    if (parts.length < 9) return null;

    const permissions = parts[0];
    const size = parseInt(parts[4], 10);
    const isDirectory = permissions.startsWith('d');
    
    // Join date and time parts (parts 5-8 typically)
    const dateTimeStr = parts.slice(5, 8).join(' ');
    const modTime = new Date(dateTimeStr);
    
    // Filename is everything after the timestamp
    const name = parts.slice(8).join(' ');
    
    return {
      path: normalizeRemotePath(`${basePath}/${name}`),
      name,
      size: isDirectory ? 0 : size,
      modTime: isNaN(modTime.getTime()) ? new Date() : modTime,
      isDirectory,
      permissions: permissions.substring(1) // Remove file type indicator
    };
  }

  private parseStatOutput(statOutput: string, path: string): SSHFileInfo {
    // Parse stat output format: name|size|mtime|permissions|type
    const parts = statOutput.trim().split('|');
    if (parts.length < 5) {
      throw createSSHError('Invalid stat output format', 'STAT_PARSE_ERROR');
    }

    const [name, sizeStr, mtimeStr, permissions, fileType] = parts;
    const size = parseInt(sizeStr, 10);
    const modTime = new Date(parseInt(mtimeStr, 10) * 1000);
    const isDirectory = fileType.includes('directory');

    return {
      path,
      name: name.split('/').pop() || name,
      size: isDirectory ? 0 : size,
      modTime,
      isDirectory,
      permissions
    };
  }
}
