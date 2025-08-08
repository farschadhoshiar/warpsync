import { RsyncConfig, RsyncOptions, DEFAULT_RSYNC_OPTIONS } from "./types";
import { escapeShellArg, escapeRsyncSSHPath, validatePath } from "../ssh/utils";
import { SSHKeyManager } from "../ssh/key-manager";
import { logger } from "@/lib/logger";

export class RsyncCommandBuilder {
  /**
   * Build complete rsync command with SSH configuration
   * Returns command arguments array and temporary key file path for cleanup
   */
  static async buildCommandWithKeyFile(config: RsyncConfig): Promise<{
    args: string[];
    tempKeyFilePath?: string;
  }> {
    const options = { ...DEFAULT_RSYNC_OPTIONS, ...config.options };
    const args: string[] = ["rsync"];
    let tempKeyFilePath: string | undefined;

    // Add basic options
    this.addBasicOptions(args, options);

    // Add filter options
    this.addFilterOptions(args, options);

    // Add performance options
    this.addPerformanceOptions(args, options);

    // Add SSH configuration if remote transfer
    if (config.sshConfig) {
      // Create temporary key file for SSH authentication
      tempKeyFilePath = await SSHKeyManager.writeTemporaryKeyFile(
        config.sshConfig.privateKey,
      );

      // Add SSH options with temporary key file path
      this.addSSHOptions(
        args,
        {
          ...config.sshConfig,
          privateKey: tempKeyFilePath,
        },
        options.sshOptions,
      );
    }

    // Enhanced logging with environment-based detail level
    const isDevelopment = process.env.NODE_ENV === "development";

    // Add source and destination with path escaping details
    const { source, destination } = this.formatPaths(config);

    // Enhanced path logging for debugging
    if (isDevelopment) {
      logger.info("🔧 PATH CONSTRUCTION DETAILS (DEV)", {
        originalSource: config.source,
        originalDestination: config.destination,
        escapedSource: source,
        escapedDestination: destination,
        pathAnalysis: {
          sourceHasSpaces: config.source.includes(" "),
          destinationHasSpaces: config.destination.includes(" "),
          sourceHasSpecialChars: /[\\$`"\s';&|<>(){}[\]?*~]/.test(
            config.source,
          ),
          destinationHasSpecialChars: /[\\$`"\s';&|<>(){}[\]?*~]/.test(
            config.destination,
          ),
          isSSHTransfer: !!config.sshConfig,
          escapeMethod: config.sshConfig
            ? "escapeRsyncSSHPath"
            : "escapeShellArg",
        },
        characterBreakdown: {
          sourceLength: config.source.length,
          escapedSourceLength: source.length,
          destinationLength: config.destination.length,
          escapedDestinationLength: destination.length,
        },
      });

      // Character-by-character analysis for paths with spaces
      if (config.source.includes(" ") || config.destination.includes(" ")) {
        logger.info("🔍 CHARACTER ANALYSIS FOR SPACED PATHS (DEV)", {
          sourceCharacters: config.source.split("").map((char, i) => ({
            index: i,
            char: char,
            code: char.charCodeAt(0),
            isSpace: char === " ",
            isSpecial: /[\\$`"\s';&|<>(){}[\]?*~]/.test(char),
          })),
          escapedSourceCharacters: (config.sshConfig
            ? source.split(":")[1] || source
            : source
          )
            .split("")
            .map((char, i) => ({
              index: i,
              char: char,
              code: char.charCodeAt(0),
              isBackslash: char === "\\",
              isSpace: char === " ",
            })),
        });
      }
    }

    args.push(source, destination);

    if (isDevelopment) {
      // Development: Log full command for debugging including path transformations
      logger.info("🔧 RSYNC COMMAND BUILT (DEV)", {
        fullCommand: args.join(" "),
        fullArgs: args,
        sanitizedArgs: this.sanitizeArgs(args),
        sanitizedCommand: this.sanitizeArgs(args).join(" "),
        tempKeyFile: tempKeyFilePath,
        pathTransformations: {
          originalSource: config.source,
          originalDestination: config.destination,
          escapedSource: source,
          escapedDestination: destination,
          hasSpaces:
            config.source.includes(" ") || config.destination.includes(" "),
          isSSH: !!config.sshConfig,
        },
        commandBreakdown: {
          program: "rsync",
          totalArgs: args.length - 1,
          hasSSH: !!config.sshConfig,
          source: config.source,
          destination: config.destination,
          sshHost: config.sshConfig?.host,
          sshPort: config.sshConfig?.port,
          sshUser: config.sshConfig?.username,
          allArguments: args,
        },
      });
    } else {
      // Production: Log sanitized command only
      logger.info("🔧 RSYNC COMMAND BUILT", {
        command: this.sanitizeArgs(args).join(" "),
        args: this.sanitizeArgs(args),
        tempKeyFile: tempKeyFilePath,
      });
    }

    return {
      args,
      tempKeyFilePath,
    };
  }

  /**
   * Sanitize arguments array for logging (remove sensitive info)
   */
  private static sanitizeArgs(args: string[]): string[] {
    return args.map((arg) => {
      // Replace private key file paths with placeholder
      if (arg.match(/^\/.*\.key$|^\/tmp\/.*$/)) {
        return "[PRIVATE_KEY_FILE]";
      }
      return arg;
    });
  }

  /**
   * Sanitize command for logging (remove sensitive info)
   * @deprecated Use sanitizeArgs instead
   */
  private static sanitizeCommand(command: string): string {
    return command.replace(/(-i\s+)[^\s]+/g, "$1[PRIVATE_KEY_FILE]");
  }

  /**
   * Build complete rsync command with SSH configuration (legacy method)
   * @deprecated Use buildCommandWithKeyFile instead
   */
  static buildCommand(config: RsyncConfig): string {
    throw new Error(
      "buildCommand is deprecated. Use buildCommandWithKeyFile for SSH key support.",
    );
  }

  /**
   * Validate rsync configuration
   */
  static validateConfig(config: RsyncConfig): {
    valid: boolean;
    errors: string[];
  } {
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
        errors.push("SSH host is required");
      }
      if (!config.sshConfig.username) {
        errors.push("SSH username is required");
      }
      if (
        config.sshConfig.port &&
        (config.sshConfig.port < 1 || config.sshConfig.port > 65535)
      ) {
        errors.push("SSH port must be between 1 and 65535");
      }

      // Validate SSH private key is present (SSH key authentication only)
      if (!config.sshConfig.privateKey) {
        errors.push("SSH private key is required for authentication");
      }

      // Validate SSH key format
      if (
        config.sshConfig.privateKey &&
        (!config.sshConfig.privateKey.includes("-----BEGIN") ||
          !config.sshConfig.privateKey.includes("-----END"))
      ) {
        errors.push("Invalid SSH private key format");
      }
    }

    // Validate options
    if (config.options.bandwidth && config.options.bandwidth < 0) {
      errors.push("Bandwidth limit must be positive");
    }

    if (config.options.timeout && config.options.timeout < 0) {
      errors.push("Timeout must be positive");
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  private static addBasicOptions(args: string[], options: RsyncOptions): void {
    if (options.archive) args.push("-a");
    if (options.verbose) args.push("-v");
    if (options.compress) args.push("-z");
    if (options.partial) args.push("--partial");
    if (options.progress) args.push("--progress");
    if (options.delete) args.push("--delete");
    if (options.dryRun) args.push("--dry-run");
    if (options.checksum) args.push("-c");
    if (options.times) args.push("-t");
    if (options.perms) args.push("-p");
    if (options.owner) args.push("-o");
    if (options.group) args.push("-g");
    if (options.inPlace) args.push("--inplace");
    if (options.wholefile) args.push("-W");
    if (options.sparseFiles) args.push("-S");
    if (options.hardLinks) args.push("-H");
    if (options.numericIds) args.push("--numeric-ids");
    if (options.itemizeChanges) args.push("-i");
    if (options.stats) args.push("--stats");
    if (options.humanReadable) args.push("-h");
    if (options.createDirs) args.push("--dirs");
    if (options.preserveHierarchy) args.push("--mkpath");
    if (options.recursive) args.push("-r");
  }

  private static addFilterOptions(args: string[], options: RsyncOptions): void {
    if (options.excludeFrom) {
      args.push(`--exclude-from=${escapeShellArg(options.excludeFrom)}`);
    }
    if (options.includeFrom) {
      args.push(`--include-from=${escapeShellArg(options.includeFrom)}`);
    }
    if (options.exclude) {
      options.exclude.forEach((pattern) => {
        args.push(`--exclude=${escapeShellArg(pattern)}`);
      });
    }
    if (options.include) {
      options.include.forEach((pattern) => {
        args.push(`--include=${escapeShellArg(pattern)}`);
      });
    }
  }

  private static addPerformanceOptions(
    args: string[],
    options: RsyncOptions,
  ): void {
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
    sshConfig: NonNullable<RsyncConfig["sshConfig"]>,
    additionalOptions?: string[],
  ): void {
    const sshArgs: string[] = [];

    // Basic SSH options
    sshArgs.push("-o", "BatchMode=yes");
    sshArgs.push("-o", "StrictHostKeyChecking=no");
    sshArgs.push("-o", "UserKnownHostsFile=/dev/null");
    sshArgs.push("-o", "LogLevel=ERROR");

    // Port configuration
    if (sshConfig.port && sshConfig.port !== 22) {
      sshArgs.push("-p", sshConfig.port.toString());
    }

    // SSH private key authentication (required)
    sshArgs.push("-i", escapeShellArg(sshConfig.privateKey));

    // Connection optimization
    sshArgs.push("-o", "Compression=yes");
    sshArgs.push("-o", "ConnectTimeout=30");
    sshArgs.push("-o", "ServerAliveInterval=60");
    sshArgs.push("-o", "ServerAliveCountMax=3");

    // Add additional SSH options
    if (additionalOptions) {
      sshArgs.push(...additionalOptions);
    }

    // Use standard SSH with key-based authentication only
    args.push("-e", `ssh ${sshArgs.join(" ")}`);
  }

  private static formatPaths(config: RsyncConfig): {
    source: string;
    destination: string;
  } {
    let source = config.source;
    let destination = config.destination;

    const isDevelopment = process.env.NODE_ENV === "development";

    // Format remote source path
    if (config.sshConfig) {
      const { host, username } = config.sshConfig;
      const escapedPath = escapeRsyncSSHPath(config.source);

      if (isDevelopment) {
        logger.info("🌐 SSH SOURCE PATH ESCAPING (DEV)", {
          originalPath: config.source,
          escapedPath: escapedPath,
          sshHost: host,
          sshUsername: username,
          fullSSHSource: `${username}@${host}:${escapedPath}`,
          escapingDetails: {
            beforeEscape: config.source,
            afterEscape: escapedPath,
            escapeFunction: "escapeRsyncSSHPath",
            hasSpaces: config.source.includes(" "),
            charactersEscaped: config.source.length !== escapedPath.length,
            lengthChange: escapedPath.length - config.source.length,
          },
        });
      }

      // Use specialized rsync SSH path escaping for paths with spaces and special characters
      source = `${username}@${host}:${escapedPath}`;
    } else {
      const escapedSource = escapeShellArg(config.source);

      if (isDevelopment) {
        logger.info("💻 LOCAL SOURCE PATH ESCAPING (DEV)", {
          originalPath: config.source,
          escapedPath: escapedSource,
          escapeFunction: "escapeShellArg",
          hasSpaces: config.source.includes(" "),
          charactersEscaped: config.source !== escapedSource,
        });
      }

      source = escapedSource;
    }

    // Format destination path (always local in our case)
    // Local paths use standard shell escaping
    const escapedDestination = escapeShellArg(config.destination);

    if (isDevelopment) {
      logger.info("📁 DESTINATION PATH ESCAPING (DEV)", {
        originalPath: config.destination,
        escapedPath: escapedDestination,
        escapeFunction: "escapeShellArg",
        hasSpaces: config.destination.includes(" "),
        charactersEscaped: config.destination !== escapedDestination,
      });
    }

    destination = escapedDestination;

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
      privateKey: string; // SSH private key content (required)
    },
    customOptions: Partial<RsyncOptions> = {},
  ): RsyncConfig {
    return {
      source: remotePath,
      destination: localPath,
      sshConfig,
      options: {
        ...DEFAULT_RSYNC_OPTIONS,
        ...customOptions,
      },
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
      privateKey: string; // SSH private key content (required)
    },
  ): RsyncConfig {
    return {
      source: remotePath,
      destination: "/tmp/", // Dummy destination for dry run
      sshConfig,
      options: {
        dryRun: true,
        verbose: true,
        itemizeChanges: true,
        stats: false,
        progress: false,
      },
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
      privateKey: string; // SSH private key content (required)
    },
    customOptions: Partial<RsyncOptions> = {},
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
        ...customOptions,
      },
    };
  }
}
