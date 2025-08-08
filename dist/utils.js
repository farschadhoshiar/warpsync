"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeRemotePath = normalizeRemotePath;
exports.joinRemotePath = joinRemotePath;
exports.escapeShellArg = escapeShellArg;
exports.escapeRsyncSSHPath = escapeRsyncSSHPath;
exports.buildSSHCommand = buildSSHCommand;
exports.parseFilePermissions = parseFilePermissions;
exports.parseFileSize = parseFileSize;
exports.parseModTime = parseModTime;
exports.validatePath = validatePath;
exports.createSSHError = createSSHError;
exports.parseCommandResult = parseCommandResult;
exports.isRetryableError = isRetryableError;
exports.extractConnectionInfo = extractConnectionInfo;
exports.getTimeoutForOperation = getTimeoutForOperation;
exports.formatBytes = formatBytes;
exports.formatDuration = formatDuration;
const path_1 = require("path");
/**
 * Normalize path for remote Unix systems
 */
function normalizeRemotePath(path) {
    // Always use POSIX paths for remote systems (assumed to be Unix-like)
    return path_1.posix.normalize(path);
}
/**
 * Join paths for remote Unix systems
 */
function joinRemotePath(...paths) {
    return path_1.posix.join(...paths);
}
/**
 * Escape shell arguments for SSH commands
 * Improved to handle more edge cases and special characters
 */
function escapeShellArg(arg) {
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
 * Uses quoted paths for better compatibility with spaces and special characters
 */
function escapeRsyncSSHPath(path) {
    // For rsync over SSH, use single quotes to wrap the entire path
    // This is more reliable than backslash escaping for paths with spaces
    // Single quotes preserve all characters literally except for single quotes themselves
    // If the path contains single quotes, we need to escape them specially
    if (path.includes("'")) {
        // Replace each single quote with '\'' (end quote, escaped quote, start quote)
        return "'" + path.replace(/'/g, "'\\''") + "'";
    }
    // For paths without single quotes, simply wrap in single quotes
    return "'" + path + "'";
}
/**
 * Build SSH command string with proper escaping
 */
function buildSSHCommand(command, args = []) {
    const escapedArgs = args.map(escapeShellArg);
    return [command, ...escapedArgs].join(" ");
}
/**
 * Parse file permissions from ls -l output
 */
function parseFilePermissions(permString) {
    // Convert rwxrwxrwx format to octal
    if (permString.length !== 9)
        return "644";
    let octal = "";
    for (let i = 0; i < 9; i += 3) {
        let value = 0;
        if (permString[i] === "r")
            value += 4;
        if (permString[i + 1] === "w")
            value += 2;
        if (permString[i + 2] === "x")
            value += 1;
        octal += value.toString();
    }
    return octal;
}
/**
 * Parse file size from ls -l output
 */
function parseFileSize(sizeString) {
    const size = parseInt(sizeString, 10);
    return isNaN(size) ? 0 : size;
}
/**
 * Parse modification time from ls -l output
 */
function parseModTime(dateString) {
    try {
        // Handle various date formats from ls -l
        const date = new Date(dateString);
        return isNaN(date.getTime()) ? new Date() : date;
    }
    catch (_a) {
        return new Date();
    }
}
/**
 * Validate that a path is absolute and safe
 */
function validatePath(path, isRemote = true) {
    if (!path || typeof path !== "string") {
        return { valid: false, error: "Path must be a non-empty string" };
    }
    // Remove any trailing slashes except for root
    const normalizedPath = path.endsWith("/") && path.length > 1 ? path.slice(0, -1) : path;
    if (isRemote) {
        // Remote paths should be absolute Unix paths
        if (!normalizedPath.startsWith("/")) {
            return {
                valid: false,
                error: "Remote path must be absolute (start with /)",
            };
        }
    }
    else {
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
function createSSHError(message, code, level = "command", retryable = false, connectionId) {
    const error = new Error(message);
    error.code = code;
    error.level = level;
    error.retryable = retryable;
    error.connectionId = connectionId;
    return error;
}
/**
 * Parse SSH command result and check for common errors
 */
function parseCommandResult(stdout, stderr, exitCode, executionTime) {
    const result = {
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
function isRetryableError(error) {
    const retryableMessages = [
        "Connection timeout",
        "Network is unreachable",
        "Connection refused",
        "Host is down",
        "Temporary failure",
        "Too many connections",
    ];
    const message = error.message.toLowerCase();
    return retryableMessages.some((retryableMsg) => message.includes(retryableMsg.toLowerCase()));
}
/**
 * Extract connection info from SSH config
 */
function extractConnectionInfo(host, port, username) {
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
function getTimeoutForOperation(operation) {
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
function formatBytes(bytes) {
    if (bytes === 0)
        return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}
/**
 * Format duration in milliseconds to human readable
 */
function formatDuration(ms) {
    if (ms < 1000)
        return `${ms}ms`;
    if (ms < 60000)
        return `${(ms / 1000).toFixed(1)}s`;
    if (ms < 3600000)
        return `${(ms / 60000).toFixed(1)}m`;
    return `${(ms / 3600000).toFixed(1)}h`;
}
