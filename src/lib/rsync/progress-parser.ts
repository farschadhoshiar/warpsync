import { RsyncProgress, RsyncStats } from './types';
import { logger } from '@/lib/logger';

export class RsyncProgressParser {
  private currentProgress: Partial<RsyncProgress> = {};
  private stats: Partial<RsyncStats> = {};

  /**
   * Parse rsync progress output line
   */
  parseProgressLine(line: string): RsyncProgress | null {
    try {
      // Parse different types of rsync output
      if (this.isProgressLine(line)) {
        return this.parseProgressUpdate(line);
      } else if (this.isFileTransferLine(line)) {
        return this.parseFileTransfer(line);
      } else if (this.isStatsLine(line)) {
        this.parseStatsLine(line);
        return null;
      }
      
      return null;
    } catch (error) {
      logger.warn('Failed to parse rsync progress line', {
        line,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return null;
    }
  }

  /**
   * Parse rsync final statistics
   */
  parseStats(output: string): RsyncStats | null {
    try {
      const lines = output.split('\n');
      const stats: Partial<RsyncStats> = {};

      for (const line of lines) {
        this.parseStatsLine(line, stats);
      }

      if (Object.keys(stats).length > 0) {
        return this.buildCompleteStats(stats);
      }

      return null;
    } catch (error) {
      logger.error('Failed to parse rsync stats', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return null;
    }
  }

  /**
   * Reset parser state
   */
  reset(): void {
    this.currentProgress = {};
    this.stats = {};
  }

  private isProgressLine(line: string): boolean {
    // Match rsync progress format: "     1,234,567  78%   12.34MB/s    0:00:05"
    return /^\s*[\d,]+\s+\d+%.*\d+:\d+:\d+/.test(line) ||
           line.includes('to-check=') ||
           line.includes('to-chk=');
  }

  private isFileTransferLine(line: string): boolean {
    // Match file transfer lines with > or < indicators
    return /^[><]/.test(line.trim()) || 
           line.startsWith('receiving file list') ||
           line.includes('files to consider');
  }

  private isStatsLine(line: string): boolean {
    return line.includes('Number of files:') ||
           line.includes('Total file size:') ||
           line.includes('Total transferred file size:') ||
           line.includes('Literal data:') ||
           line.includes('Matched data:') ||
           line.includes('File list size:') ||
           line.includes('Total bytes sent:') ||
           line.includes('Total bytes received:') ||
           line.includes('sent ') && line.includes('bytes') ||
           line.includes('received ') && line.includes('bytes');
  }

  private parseProgressUpdate(line: string): RsyncProgress | null {
    // Parse various rsync progress formats
    
    // Format: "     1,234,567  78%   12.34MB/s    0:00:05 (xfr#123, to-chk=456/789)"
    const progressMatch = line.match(/^\s*([\d,]+)\s+(\d+)%\s+([\d.]+\w+\/s)\s+(\d+:\d+:\d+)/);
    if (progressMatch) {
      const [, bytes, percentage, speed, timeStr] = progressMatch;
      
      this.currentProgress.bytesTransferred = this.parseBytes(bytes);
      this.currentProgress.percentage = parseInt(percentage, 10);
      this.currentProgress.speed = speed;
      this.currentProgress.eta = timeStr;
      
      // Extract file transfer info if present
      const xfrMatch = line.match(/xfr#(\d+)/);
      if (xfrMatch) {
        this.currentProgress.fileNumber = parseInt(xfrMatch[1], 10);
      }
      
      const checkMatch = line.match(/to-chk=(\d+)\/(\d+)/);
      if (checkMatch) {
        const remaining = parseInt(checkMatch[1], 10);
        const total = parseInt(checkMatch[2], 10);
        this.currentProgress.totalFiles = total;
        this.currentProgress.fileNumber = total - remaining;
      }
    }

    // Format: "receiving file list ... 123 files to consider"
    const fileListMatch = line.match(/(\d+) files to consider/);
    if (fileListMatch) {
      this.currentProgress.totalFiles = parseInt(fileListMatch[1], 10);
      this.currentProgress.fileNumber = 0;
      this.currentProgress.percentage = 0;
    }

    // Build current progress if we have enough data
    if (this.currentProgress.percentage !== undefined) {
      return this.buildProgress();
    }

    return null;
  }

  private parseFileTransfer(line: string): RsyncProgress | null {
    // Parse individual file transfer lines
    const trimmed = line.trim();
    
    // Format: ">f+++++++++ path/to/file"
    const fileMatch = trimmed.match(/^[><][\w+.]+\s+(.+)$/);
    if (fileMatch) {
      this.currentProgress.filename = fileMatch[1];
      return this.buildProgress();
    }

    return null;
  }

  private parseStatsLine(line: string, statsObj?: Partial<RsyncStats>): void {
    const stats = statsObj || this.stats;
    
    const patterns = {
      totalFiles: /Number of files:\s*([\d,]+)/,
      regularFiles: /Number of regular files transferred:\s*([\d,]+)/,
      totalSize: /Total file size:\s*([\d,]+)/,
      totalTransferred: /Total transferred file size:\s*([\d,]+)/,
      literalData: /Literal data:\s*([\d,]+)/,
      matchedData: /Matched data:\s*([\d,]+)/,
      listSize: /File list size:\s*([\d,]+)/,
      listGeneration: /File list generation time:\s*([\d.]+)/,
      listTransfer: /File list transfer time:\s*([\d.]+)/
    };

    for (const [key, pattern] of Object.entries(patterns)) {
      const match = line.match(pattern);
      if (match) {
        const value = this.parseNumber(match[1]);
        (stats as Record<string, number>)[key] = value;
      }
    }

    // Parse sent/received bytes
    const sentMatch = line.match(/sent ([\d,]+) bytes/);
    if (sentMatch) {
      stats.totalTransferred = this.parseNumber(sentMatch[1]);
    }

    const receivedMatch = line.match(/received ([\d,]+) bytes/);
    if (receivedMatch) {
      stats.totalTransferred = this.parseNumber(receivedMatch[1]);
    }

    // Parse transfer rate
    const rateMatch = line.match(/([\d.]+) bytes\/sec/);
    if (rateMatch) {
      stats.transferRate = parseFloat(rateMatch[1]);
    }
  }

  private buildProgress(): RsyncProgress {
    return {
      filename: this.currentProgress.filename || '',
      fileNumber: this.currentProgress.fileNumber || 0,
      totalFiles: this.currentProgress.totalFiles || 0,
      percentage: this.currentProgress.percentage || 0,
      speed: this.currentProgress.speed || '0 bytes/s',
      eta: this.currentProgress.eta || '0:00:00',
      bytesTransferred: this.currentProgress.bytesTransferred || 0,
      totalBytes: this.currentProgress.totalBytes || 0,
      elapsedTime: this.currentProgress.elapsedTime || 0
    };
  }

  private buildCompleteStats(partial: Partial<RsyncStats>): RsyncStats {
    return {
      totalFiles: partial.totalFiles || 0,
      regularFiles: partial.regularFiles || 0,
      directories: partial.directories || 0,
      symlinks: partial.symlinks || 0,
      devices: partial.devices || 0,
      specials: partial.specials || 0,
      deletedFiles: partial.deletedFiles || 0,
      deletedDirs: partial.deletedDirs || 0,
      totalSize: partial.totalSize || 0,
      totalTransferred: partial.totalTransferred || 0,
      literalData: partial.literalData || 0,
      matchedData: partial.matchedData || 0,
      listSize: partial.listSize || 0,
      listGeneration: partial.listGeneration || 0,
      listTransfer: partial.listTransfer || 0,
      compressionRatio: this.calculateCompressionRatio(partial),
      checksummedFiles: partial.checksummedFiles || 0,
      unchangedFiles: partial.unchangedFiles || 0,
      elapsedTime: partial.elapsedTime || 0,
      transferRate: partial.transferRate || 0
    };
  }

  private parseBytes(bytesStr: string): number {
    return parseInt(bytesStr.replace(/,/g, ''), 10) || 0;
  }

  private parseNumber(numStr: string): number {
    return parseInt(numStr.replace(/,/g, ''), 10) || 0;
  }

  private calculateCompressionRatio(stats: Partial<RsyncStats>): number {
    if (stats.literalData && stats.totalTransferred && stats.totalTransferred > 0) {
      return ((stats.totalTransferred - stats.literalData) / stats.totalTransferred) * 100;
    }
    return 0;
  }
}
