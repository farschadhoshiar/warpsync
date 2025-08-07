import { RsyncConfig, RsyncOptions, DEFAULT_RSYNC_OPTIONS } from './types';
import { escapeShellArg, validatePath } from '../ssh/utils';

export class RsyncCommandBuilder {
  /**
   * Build complete rsync command with SSH configuration
   */
  static buildCommand(config: RsyncConfig): string {
    const options = { ...DEFAULT_RSYNC_OPTIONS, ...config.options };
    const args: string[] = ['rsync'];

    // Add basic options
    this.addBasicOptions(args, options);
    
    // Add filter options
    this.addFilterOptions(args, options);
    
    // Add performance options
    this.addPerformanceOptions(args, options);
    
    // Add SSH configuration if remote transfer
    if (config.sshConfig) {
      this.addSSHOptions(args, config.sshConfig, options.sshOptions);
    }

    // Add source and destination
    const { source, destination } = this.formatPaths(config);
    args.push(source, destination);

    return args.join(' ');
  }

  /**
   * Validate rsync configuration
   */
  static validateConfig(config: RsyncConfig): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Validate paths
    const sourceValidation = validatePath(config.source, !!config.sshConfig);
    if (!sourceValidation.valid) {
      errors.push(`Invalid source path: ${sourceValidation.error}`);
    }

    const destValidation = validatePath(config.destination, false);
    if (!destValidation.valid) {
      errors.push(`Invalid destination path: ${destValidation.error}`);
    }

    // Validate SSH config if present
    if (config.sshConfig) {
      if (!config.sshConfig.host) {
        errors.push('SSH host is required');
      }
      if (!config.sshConfig.username) {
        errors.push('SSH username is required');
      }
      if (config.sshConfig.port && (config.sshConfig.port < 1 || config.sshConfig.port > 65535)) {
        errors.push('SSH port must be between 1 and 65535');
      }
      
      // Validate authentication method
      if (!config.sshConfig.privateKey && !config.sshConfig.password) {
        errors.push('SSH authentication requires either privateKey or password');
      }
      
      // Note: sshpass is required for password authentication
      if (config.sshConfig.password && !config.sshConfig.privateKey) {
        // We'll rely on runtime checking for sshpass availability
        // Could add a check here if needed: errors.push('sshpass utility is required for password authentication');
      }
    }

    // Validate options
    if (config.options.bandwidth && config.options.bandwidth < 0) {
      errors.push('Bandwidth limit must be positive');
    }

    if (config.options.timeout && config.options.timeout < 0) {
      errors.push('Timeout must be positive');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  private static addBasicOptions(args: string[], options: RsyncOptions): void {
    if (options.archive) args.push('-a');
    if (options.verbose) args.push('-v');
    if (options.compress) args.push('-z');
    if (options.partial) args.push('--partial');
    if (options.progress) args.push('--progress');
    if (options.delete) args.push('--delete');
    if (options.dryRun) args.push('--dry-run');
    if (options.checksum) args.push('-c');
    if (options.times) args.push('-t');
    if (options.perms) args.push('-p');
    if (options.owner) args.push('-o');
    if (options.group) args.push('-g');
    if (options.inPlace) args.push('--inplace');
    if (options.wholefile) args.push('-W');
    if (options.sparseFiles) args.push('-S');
    if (options.hardLinks) args.push('-H');
    if (options.numericIds) args.push('--numeric-ids');
    if (options.itemizeChanges) args.push('-i');
    if (options.stats) args.push('--stats');
    if (options.humanReadable) args.push('-h');
    if (options.createDirs) args.push('--dirs');
    if (options.preserveHierarchy) args.push('--mkpath');
    if (options.recursive) args.push('-r');
  }

  private static addFilterOptions(args: string[], options: RsyncOptions): void {
    if (options.excludeFrom) {
      args.push(`--exclude-from=${escapeShellArg(options.excludeFrom)}`);
    }
    if (options.includeFrom) {
      args.push(`--include-from=${escapeShellArg(options.includeFrom)}`);
    }
    if (options.exclude) {
      options.exclude.forEach(pattern => {
        args.push(`--exclude=${escapeShellArg(pattern)}`);
      });
    }
    if (options.include) {
      options.include.forEach(pattern => {
        args.push(`--include=${escapeShellArg(pattern)}`);
      });
    }
  }

  private static addPerformanceOptions(args: string[], options: RsyncOptions): void {
    if (options.bandwidth) {
      args.push(`--bwlimit=${options.bandwidth}`);
    }
    if (options.timeout) {
      args.push(`--timeout=${options.timeout}`);
    }
    if (options.maxSize) {
      args.push(`--max-size=${escapeShellArg(options.maxSize)}`);
    }
    if (options.minSize) {
      args.push(`--min-size=${escapeShellArg(options.minSize)}`);
    }
    if (options.logFile) {
      args.push(`--log-file=${escapeShellArg(options.logFile)}`);
    }
    if (options.tempDir) {
      args.push(`--temp-dir=${escapeShellArg(options.tempDir)}`);
    }
  }

  private static addSSHOptions(
    args: string[], 
    sshConfig: NonNullable<RsyncConfig['sshConfig']>,
    additionalOptions?: string[]
  ): void {
    const sshArgs: string[] = [];

    // Basic SSH options
    sshArgs.push('-o', 'BatchMode=yes');
    sshArgs.push('-o', 'StrictHostKeyChecking=no');
    sshArgs.push('-o', 'UserKnownHostsFile=/dev/null');
    sshArgs.push('-o', 'LogLevel=ERROR');

    // Port configuration
    if (sshConfig.port && sshConfig.port !== 22) {
      sshArgs.push('-p', sshConfig.port.toString());
    }

    // Authentication configuration
    if (sshConfig.privateKey) {
      sshArgs.push('-i', escapeShellArg(sshConfig.privateKey));
    }

    // Connection optimization
    sshArgs.push('-o', 'Compression=yes');
    sshArgs.push('-o', 'ConnectTimeout=30');
    sshArgs.push('-o', 'ServerAliveInterval=60');
    sshArgs.push('-o', 'ServerAliveCountMax=3');

    // Add additional SSH options
    if (additionalOptions) {
      sshArgs.push(...additionalOptions);
    }

    // Handle password authentication vs key authentication
    if (sshConfig.password && !sshConfig.privateKey) {
      // Use sshpass with environment variable for password authentication
      // Command will be executed with SSHPASS environment variable
      args.unshift('sshpass', '-e');
      args.push('-e', `ssh ${sshArgs.join(' ')}`);
    } else {
      // Use standard SSH (key-based authentication)
      args.push('-e', `ssh ${sshArgs.join(' ')}`);
    }
  }

  private static formatPaths(config: RsyncConfig): { source: string; destination: string } {
    let source = config.source;
    let destination = config.destination;

    // Format remote source path
    if (config.sshConfig) {
      const { host, username } = config.sshConfig;
      source = `${username}@${host}:${escapeShellArg(config.source)}`;
    } else {
      source = escapeShellArg(config.source);
    }

    // Format destination path (always local in our case)
    destination = escapeShellArg(config.destination);

    return { source, destination };
  }

  /**
   * Create rsync config for file transfer
   */
  static createTransferConfig(
    remotePath: string,
    localPath: string,
    sshConfig: {
      host: string;
      port: number;
      username: string;
      privateKey?: string;
      password?: string;
    },
    customOptions: Partial<RsyncOptions> = {}
  ): RsyncConfig {
    return {
      source: remotePath,
      destination: localPath,
      sshConfig,
      options: {
        ...DEFAULT_RSYNC_OPTIONS,
        ...customOptions
      }
    };
  }

  /**
   * Create rsync config for directory listing (dry run)
   */
  static createListingConfig(
    remotePath: string,
    sshConfig: {
      host: string;
      port: number;
      username: string;
      privateKey?: string;
      password?: string;
    }
  ): RsyncConfig {
    return {
      source: remotePath,
      destination: '/tmp/', // Dummy destination for dry run
      sshConfig,
      options: {
        dryRun: true,
        verbose: true,
        itemizeChanges: true,
        stats: false,
        progress: false
      }
    };
  }

  /**
   * Create rsync config for directory creation and structure preservation
   */
  static createDirectoryConfig(
    remotePath: string,
    localPath: string,
    sshConfig: {
      host: string;
      port: number;
      username: string;
      privateKey?: string;
      password?: string;
    },
    customOptions: Partial<RsyncOptions> = {}
  ): RsyncConfig {
    return {
      source: remotePath,
      destination: localPath,
      sshConfig,
      options: {
        ...DEFAULT_RSYNC_OPTIONS,
        createDirs: true,
        preserveHierarchy: true,
        recursive: true,
        times: true,
        perms: true,
        verbose: true,
        ...customOptions
      }
    };
  }
}
