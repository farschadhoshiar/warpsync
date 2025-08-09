import { RsyncProgress, RsyncStats } from "./types";
import { logger } from "@/lib/logger";

export class RsyncProgressParser {
  /**
   * Simple progress parsing - just extract percentage from rsync output
   */
  parseProgressLine(line: string): RsyncProgress | null {
    try {
      // Clean the line
      const cleanLine = line.replace(/\r/g, "").trim();

      // Look for percentage in the line
      const percentMatch = cleanLine.match(/(\d+)%/);
      if (!percentMatch) {
        return null;
      }

      const percentage = parseInt(percentMatch[1], 10);

      // Extract speed if present (like "16.21MB/s")
      const speedMatch = cleanLine.match(/([\d.]+[KMGT]*B\/s)/);
      const speed = speedMatch ? speedMatch[1] : "0 B/s";

      // Extract ETA if present (like "0:01:30")
      const etaMatch = cleanLine.match(/(\d+:\d+:\d+)/);
      const eta = etaMatch ? etaMatch[1] : "0:00:00";

      // Extract bytes if present (like "416.29M")
      const bytesMatch = cleanLine.match(/(\d+(?:\.\d+)?[KMGTB]*)/);
      const bytesTransferred = bytesMatch
        ? this.parseBytesWithUnits(bytesMatch[1])
        : 0;

      return {
        filename: "",
        fileNumber: 0,
        totalFiles: 0,
        percentage,
        speed,
        eta,
        bytesTransferred,
        totalBytes: 0,
        elapsedTime: 0,
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Parse rsync final statistics
   */
  parseStats(output: string): RsyncStats | null {
    try {
      const lines = output.split("\n");
      const stats: Partial<RsyncStats> = {};

      for (const line of lines) {
        this.parseStatsLine(line, stats);
      }

      if (Object.keys(stats).length > 0) {
        return this.buildCompleteStats(stats);
      }

      return null;
    } catch (error) {
      logger.error("Failed to parse rsync stats", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return null;
    }
  }

  /**
   * Reset parser state
   */
  private currentProgress: Partial<RsyncProgress> = {};
  private stats: Partial<RsyncStats> = {};

  reset(): void {
    this.currentProgress = {};
    this.stats = {};
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
      listTransfer: /File list transfer time:\s*([\d.]+)/,
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
      filename: this.currentProgress.filename || "",
      fileNumber: this.currentProgress.fileNumber || 0,
      totalFiles: this.currentProgress.totalFiles || 0,
      percentage: this.currentProgress.percentage || 0,
      speed: this.currentProgress.speed || "0 bytes/s",
      eta: this.currentProgress.eta || "0:00:00",
      bytesTransferred: this.currentProgress.bytesTransferred || 0,
      totalBytes: this.currentProgress.totalBytes || 0,
      elapsedTime: this.currentProgress.elapsedTime || 0,
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
      transferRate: partial.transferRate || 0,
    };
  }

  private parseBytes(bytesStr: string): number {
    return parseInt(bytesStr.replace(/,/g, ""), 10) || 0;
  }

  private parseBytesWithUnits(bytesStr: string): number {
    // Handle formats like "970.71M", "1.00G", "1,234,567"
    const cleanStr = bytesStr.replace(/,/g, "");

    // Check for unit suffix
    const unitMatch = cleanStr.match(/^([\d.]+)([KMGT]?)B?$/);
    if (unitMatch) {
      const [, numberStr, unit] = unitMatch;
      const number = parseFloat(numberStr);

      switch (unit.toUpperCase()) {
        case "K":
          return Math.round(number * 1024);
        case "M":
          return Math.round(number * 1024 * 1024);
        case "G":
          return Math.round(number * 1024 * 1024 * 1024);
        case "T":
          return Math.round(number * 1024 * 1024 * 1024 * 1024);
        default:
          return Math.round(number);
      }
    }

    // Fallback to plain number parsing
    return parseInt(cleanStr, 10) || 0;
  }

  private parseNumber(numStr: string): number {
    return parseInt(numStr.replace(/,/g, ""), 10) || 0;
  }

  private calculateCompressionRatio(stats: Partial<RsyncStats>): number {
    if (
      stats.literalData &&
      stats.totalTransferred &&
      stats.totalTransferred > 0
    ) {
      return (
        ((stats.totalTransferred - stats.literalData) /
          stats.totalTransferred) *
        100
      );
    }
    return 0;
  }
}
