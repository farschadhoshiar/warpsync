import { posix } from "path";
import { SSHCommandResult, SSHConnectionError } from "./types";

/**
 * Normalize path for remote Unix systems
 */
export function normalizeRemotePath(path: string): string {
  // Always use POSIX paths for remote systems (assumed to be Unix-like)
  return posix.normalize(path);
}

/**
 * Join paths for remote Unix systems
 */
export function joinRemotePath(...paths: string[]): string {
  return posix.join(...paths);
}

/**
 * Escape shell arguments for SSH commands
 * Improved to handle more edge cases and special characters
 */
export function escapeShellArg(arg: string): string {
  // If the argument contains only safe characters, return as-is
  if (!/[^A-Za-z0-9_\/:=.-]/.test(arg)) {
    return arg;
  }

  // For arguments with special characters, use single quotes and escape any single quotes
  // This handles spaces, special characters, and prevents command injection
  // Replace any single quotes with '\'' to properly escape them
  return "'" + arg.replace(/'/g, "'\\''") + "'";
}

/**
 * Escape paths for rsync over SSH
 * Rsync over SSH requires different escaping than general shell commands
 * Uses double backslash escaping to handle both local and remote shell layers
 */
export function escapeRsyncSSHPath(path: string): string {
  // For rsync over SSH with spawn(), we use single backslash escaping
  // spawn() passes arguments directly without shell interpretation,
  // so the remote SSH shell only processes one level of escaping

  // Characters that need escaping: space, backslash, dollar, backtick, double quote, single quote,
  // semicolon, ampersand, pipe, redirects, parentheses, braces, brackets, wildcards, tilde
  return path.replace(/([\\$`"\s';&|<>(){}[\]?*~])/g, "\\$1");
}

/**
 * Build SSH command string with proper escaping
 */
export function buildSSHCommand(command: string, args: string[] = []): string {
  const escapedArgs = args.map(escapeShellArg);
  return [command, ...escapedArgs].join(" ");
}

/**
 * Parse file permissions from ls -l output
 */
export function parseFilePermissions(permString: string): string {
  // Convert rwxrwxrwx format to octal
  if (permString.length !== 9) return "644";

  let octal = "";
  for (let i = 0; i < 9; i += 3) {
    let value = 0;
    if (permString[i] === "r") value += 4;
    if (permString[i + 1] === "w") value += 2;
    if (permString[i + 2] === "x") value += 1;
    octal += value.toString();
  }

  return octal;
}

/**
 * Parse file size from ls -l output
 */
export function parseFileSize(sizeString: string): number {
  const size = parseInt(sizeString, 10);
  return isNaN(size) ? 0 : size;
}

/**
 * Parse modification time from ls -l output
 */
export function parseModTime(dateString: string): Date {
  try {
    // Handle various date formats from ls -l
    const date = new Date(dateString);
    return isNaN(date.getTime()) ? new Date() : date;
  } catch {
    return new Date();
  }
}

/**
 * Validate that a path is absolute and safe
 */
export function validatePath(
  path: string,
  isRemote = true,
): { valid: boolean; error?: string } {
  if (!path || typeof path !== "string") {
    return { valid: false, error: "Path must be a non-empty string" };
  }

  // Remove any trailing slashes except for root
  const normalizedPath =
    path.endsWith("/") && path.length > 1 ? path.slice(0, -1) : path;

  if (isRemote) {
    // Remote paths should be absolute Unix paths
    if (!normalizedPath.startsWith("/")) {
      return {
        valid: false,
        error: "Remote path must be absolute (start with /)",
      };
    }
  } else {
    // Local paths can be Unix or Windows absolute paths
    const isUnixAbsolute = normalizedPath.startsWith("/");
    const isWindowsAbsolute = /^[A-Za-z]:[\\/]/.test(normalizedPath);

    if (!isUnixAbsolute && !isWindowsAbsolute) {
      return { valid: false, error: "Local path must be absolute" };
    }
  }

  // Check for path traversal attempts
  if (normalizedPath.includes("..")) {
    return {
      valid: false,
      error: "Path cannot contain parent directory references (..)",
    };
  }

  // Check for null bytes and other dangerous characters
  if (/[\x00-\x1f\x7f]/.test(normalizedPath)) {
    return { valid: false, error: "Path contains invalid control characters" };
  }

  return { valid: true };
}

/**
 * Create a standardized SSH error
 */
export function createSSHError(
  message: string,
  code: string,
  level: "connection" | "authentication" | "command" | "network" = "command",
  retryable = false,
  connectionId?: string,
): SSHConnectionError {
  const error = new Error(message) as SSHConnectionError;
  error.code = code;
  error.level = level;
  error.retryable = retryable;
  error.connectionId = connectionId;
  return error;
}

/**
 * Parse SSH command result and check for common errors
 */
export function parseCommandResult(
  stdout: string,
  stderr: string,
  exitCode: number,
  executionTime: number,
): SSHCommandResult {
  const result: SSHCommandResult = {
    stdout: stdout.trim(),
    stderr: stderr.trim(),
    exitCode,
    executionTime,
  };

  return result;
}

/**
 * Check if an SSH error is retryable
 */
export function isRetryableError(error: Error): boolean {
  const retryableMessages = [
    "Connection timeout",
    "Network is unreachable",
    "Connection refused",
    "Host is down",
    "Temporary failure",
    "Too many connections",
  ];

  const message = error.message.toLowerCase();
  return retryableMessages.some((retryableMsg) =>
    message.includes(retryableMsg.toLowerCase()),
  );
}

/**
 * Extract connection info from SSH config
 */
export function extractConnectionInfo(
  host: string,
  port?: number,
  username?: string,
) {
  return {
    host: host.trim(),
    port: port || 22,
    username: username || "root",
    identifier: `${username || "root"}@${host.trim()}:${port || 22}`,
  };
}

/**
 * Generate SSH connection timeout based on operation type
 */
export function getTimeoutForOperation(
  operation: "connect" | "command" | "transfer",
): number {
  const timeouts = {
    connect: 30000, // 30 seconds
    command: 60000, // 1 minute
    transfer: 300000, // 5 minutes
  };

  return timeouts[operation];
}

/**
 * Format bytes for display
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";

  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

/**
 * Format duration in milliseconds to human readable
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
  return `${(ms / 3600000).toFixed(1)}h`;
}
