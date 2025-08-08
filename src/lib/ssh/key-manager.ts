import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { logger } from '@/lib/logger';

/**
 * SSH Key File Management
 * Handles creation and cleanup of temporary SSH private key files for rsync operations
 */

export class SSHKeyManager {
  private static tempKeyFiles = new Set<string>();

  /**
   * Write SSH private key content to a temporary file with secure permissions
   */
  static async writeTemporaryKeyFile(keyContent: string): Promise<string> {
    if (!keyContent || typeof keyContent !== 'string') {
      throw new Error('Invalid SSH key content provided');
    }

    // Validate SSH key format
    if (!keyContent.includes('-----BEGIN') || !keyContent.includes('-----END')) {
      throw new Error('Invalid SSH private key format');
    }

    try {
      // Generate unique temporary file name
      const randomSuffix = randomBytes(8).toString('hex');
      const tempFileName = `warpsync_ssh_key_${Date.now()}_${randomSuffix}`;
      const tempKeyPath = join(tmpdir(), tempFileName);

      // Write key content to temporary file
      await fs.writeFile(tempKeyPath, keyContent.trim() + '\n', { 
        mode: 0o600,  // rw------- (owner read/write only)
        flag: 'wx'     // Create new file, fail if exists
      });

      // Verify file was created with correct permissions
      const stats = await fs.stat(tempKeyPath);
      const permissions = (stats.mode & parseInt('777', 8)).toString(8);
      
      if (permissions !== '600') {
        await this.cleanupKeyFile(tempKeyPath);
        throw new Error(`Failed to set correct permissions on SSH key file. Expected 600, got ${permissions}`);
      }

      // Track the temporary file for cleanup
      this.tempKeyFiles.add(tempKeyPath);

      logger.info('📝 SSH Key File Created', {
        path: tempKeyPath,
        permissions,
        size: `${stats.size} bytes`
      });

      return tempKeyPath;
    } catch (error) {
      logger.error('Failed to create temporary SSH key file', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Safely remove a temporary SSH key file
   */
  static async cleanupKeyFile(keyFilePath: string): Promise<void> {
    if (!keyFilePath) {
      return;
    }

    try {
      // Check if file exists before attempting deletion
      await fs.access(keyFilePath);
      
      // Remove the file
      await fs.unlink(keyFilePath);
      
      // Remove from tracking set
      this.tempKeyFiles.delete(keyFilePath);

      logger.debug('Cleaned up temporary SSH key file', {
        keyFilePath
      });
    } catch (error) {
      // If file doesn't exist, that's ok - it's already cleaned up
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.tempKeyFiles.delete(keyFilePath);
        return;
      }

      logger.warn('Failed to cleanup temporary SSH key file', {
        keyFilePath,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      // Don't throw here - cleanup failures shouldn't break the main flow
    }
  }

  /**
   * Set secure permissions on SSH key file (600)
   */
  static async setKeyFilePermissions(keyFilePath: string): Promise<void> {
    try {
      await fs.chmod(keyFilePath, 0o600);
      
      logger.debug('Set SSH key file permissions', {
        keyFilePath,
        permissions: '600'
      });
    } catch (error) {
      logger.error('Failed to set SSH key file permissions', {
        keyFilePath,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Cleanup all tracked temporary key files
   * Should be called on application shutdown
   */
  static async cleanupAllKeyFiles(): Promise<void> {
    const cleanupPromises = Array.from(this.tempKeyFiles).map(keyFilePath => 
      this.cleanupKeyFile(keyFilePath)
    );

    await Promise.allSettled(cleanupPromises);
    
    logger.info('Cleaned up all temporary SSH key files', {
      count: cleanupPromises.length
    });
  }

  /**
   * Get count of tracked temporary key files
   */
  static getTrackedKeyFileCount(): number {
    return this.tempKeyFiles.size;
  }
}

// Setup cleanup on process termination
process.on('exit', () => {
  // Synchronous cleanup on exit
  const tempFiles = Array.from(SSHKeyManager['tempKeyFiles']);
  for (const filePath of tempFiles) {
    try {
      require('fs').unlinkSync(filePath);
    } catch (error) {
      // Ignore cleanup errors on exit
    }
  }
});

process.on('SIGINT', async () => {
  await SSHKeyManager.cleanupAllKeyFiles();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await SSHKeyManager.cleanupAllKeyFiles();
  process.exit(0);
});
