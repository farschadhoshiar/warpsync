/**
 * Scheduler Configuration
 * Configuration management for the job scheduler
 */

import { SchedulerConfig, DEFAULT_SCHEDULER_CONFIG } from './types';

export class SchedulerConfigManager {
  private static instance: SchedulerConfigManager;
  private config: SchedulerConfig;

  constructor(customConfig: Partial<SchedulerConfig> = {}) {
    this.config = { ...DEFAULT_SCHEDULER_CONFIG, ...customConfig };
    this.validateConfig();
  }

  getConfig(): SchedulerConfig {
    return { ...this.config };
  }

  async updateConfig(updates: Partial<SchedulerConfig>): Promise<SchedulerConfig> {
    this.config = { ...this.config, ...updates };
    this.validateConfig();
    return this.getConfig();
  }

  static getInstance(): SchedulerConfigManager {
    if (!SchedulerConfigManager.instance) {
      SchedulerConfigManager.instance = SchedulerConfigManager.fromEnvironment();
    }
    return SchedulerConfigManager.instance;
  }

  private validateConfig(): void {
    const { config } = this;

    if (config.checkInterval < 5000) {
      throw new Error('Check interval must be at least 5 seconds');
    }

    if (config.maxConcurrentScans < 1 || config.maxConcurrentScans > 10) {
      throw new Error('Max concurrent scans must be between 1 and 10');
    }

    if (config.scanTimeout < 60000) {
      throw new Error('Scan timeout must be at least 1 minute');
    }

    if (config.errorRetryDelay < 30000) {
      throw new Error('Error retry delay must be at least 30 seconds');
    }

    if (config.maxErrorCount < 1 || config.maxErrorCount > 20) {
      throw new Error('Max error count must be between 1 and 20');
    }

    if (config.healthCheckInterval < 30000) {
      throw new Error('Health check interval must be at least 30 seconds');
    }
  }

  // Environment-based configuration
  static fromEnvironment(): SchedulerConfigManager {
    const config: Partial<SchedulerConfig> = {};

    if (process.env.SCHEDULER_CHECK_INTERVAL) {
      config.checkInterval = parseInt(process.env.SCHEDULER_CHECK_INTERVAL);
    }

    if (process.env.SCHEDULER_MAX_CONCURRENT_SCANS) {
      config.maxConcurrentScans = parseInt(process.env.SCHEDULER_MAX_CONCURRENT_SCANS);
    }

    if (process.env.SCHEDULER_SCAN_TIMEOUT) {
      config.scanTimeout = parseInt(process.env.SCHEDULER_SCAN_TIMEOUT);
    }

    if (process.env.SCHEDULER_ERROR_RETRY_DELAY) {
      config.errorRetryDelay = parseInt(process.env.SCHEDULER_ERROR_RETRY_DELAY);
    }

    if (process.env.SCHEDULER_MAX_ERROR_COUNT) {
      config.maxErrorCount = parseInt(process.env.SCHEDULER_MAX_ERROR_COUNT);
    }

    if (process.env.SCHEDULER_HEALTH_CHECK_INTERVAL) {
      config.healthCheckInterval = parseInt(process.env.SCHEDULER_HEALTH_CHECK_INTERVAL);
    }

    return new SchedulerConfigManager(config);
  }
}
