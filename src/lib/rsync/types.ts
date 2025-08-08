export interface RsyncConfig {
  source: string;
  destination: string;
  sshConfig?: {
    host: string;
    port: number;
    username: string;
    privateKey: string;  // SSH private key content (required for SSH key auth only)
  };
  options: RsyncOptions;
}

export interface RsyncOptions {
  archive?: boolean;           // -a (archive mode)
  verbose?: boolean;           // -v (verbose)
  compress?: boolean;          // -z (compress)
  partial?: boolean;           // --partial (keep partial files)
  progress?: boolean;          // --progress (show progress)
  delete?: boolean;            // --delete (delete extraneous files)
  excludeFrom?: string;        // --exclude-from=FILE
  includeFrom?: string;        // --include-from=FILE
  exclude?: string[];          // --exclude=PATTERN
  include?: string[];          // --include=PATTERN
  dryRun?: boolean;           // --dry-run (perform trial run)
  checksum?: boolean;         // -c (checksum-based comparison)
  times?: boolean;            // -t (preserve modification times)
  perms?: boolean;            // -p (preserve permissions)
  owner?: boolean;            // -o (preserve owner)
  group?: boolean;            // -g (preserve group)
  bandwidth?: number;         // --bwlimit=RATE (bandwidth limit in KB/s)
  timeout?: number;           // --timeout=SECONDS
  maxSize?: string;           // --max-size=SIZE
  minSize?: string;           // --min-size=SIZE
  inPlace?: boolean;          // --inplace (update files in-place)
  wholefile?: boolean;        // -W (copy whole files)
  sparseFiles?: boolean;      // -S (handle sparse files efficiently)
  hardLinks?: boolean;        // -H (preserve hard links)
  numericIds?: boolean;       // --numeric-ids (don't map uid/gid values)
  itemizeChanges?: boolean;   // -i (itemize changes)
  stats?: boolean;            // --stats (give file transfer stats)
  humanReadable?: boolean;    // -h (human readable numbers)
  logFile?: string;          // --log-file=FILE
  tempDir?: string;          // --temp-dir=DIR
  sshOptions?: string[];     // additional SSH options
  createDirs?: boolean;       // --dirs (transfer directories without recursing)
  preserveHierarchy?: boolean; // --mkpath (create missing path components)
  recursive?: boolean;        // -r (recursive)
}

export interface RsyncProgress {
  filename: string;
  fileNumber: number;
  totalFiles: number;
  percentage: number;
  speed: string;
  eta: string;
  bytesTransferred: number;
  totalBytes: number;
  elapsedTime: number;
}

export interface RsyncStats {
  totalFiles: number;
  regularFiles: number;
  directories: number;
  symlinks: number;
  devices: number;
  specials: number;
  deletedFiles: number;
  deletedDirs: number;
  totalSize: number;
  totalTransferred: number;
  literalData: number;
  matchedData: number;
  listSize: number;
  listGeneration: number;
  listTransfer: number;
  compressionRatio: number;
  checksummedFiles: number;
  unchangedFiles: number;
  elapsedTime: number;
  transferRate: number;
}

export interface RsyncResult {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  stats?: RsyncStats;
  duration: number;
  error?: string;
}

export interface RsyncProcess {
  id: string;
  config: RsyncConfig;
  startTime: Date;
  endTime?: Date;
  status: ProcessStatus;
  progress?: RsyncProgress;
  logs: string[];
  errors: string[];
  result?: RsyncResult;
  tempKeyFilePath?: string; // Path to temporary SSH key file for cleanup
}

export enum ProcessStatus {
  PENDING = 'pending',
  STARTING = 'starting',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  TIMEOUT = 'timeout'
}

export interface RsyncManagerConfig {
  maxConcurrentProcesses: number;
  defaultTimeout: number;        // in milliseconds
  progressUpdateInterval: number; // in milliseconds
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  retryAttempts: number;
  retryDelay: number;           // in milliseconds
  tempDirectory?: string;
  preservePartialFiles: boolean;
}

export const DEFAULT_RSYNC_CONFIG: RsyncManagerConfig = {
  maxConcurrentProcesses: 3,
  defaultTimeout: 3600000,      // 1 hour
  progressUpdateInterval: 1000,  // 1 second
  logLevel: 'info',
  retryAttempts: 3,
  retryDelay: 5000,             // 5 seconds
  preservePartialFiles: true
};

export const DEFAULT_RSYNC_OPTIONS: RsyncOptions = {
  archive: true,
  verbose: true,
  compress: true,
  partial: true,
  progress: true,
  times: true,
  perms: true,
  itemizeChanges: true,
  stats: true,
  humanReadable: true
};
