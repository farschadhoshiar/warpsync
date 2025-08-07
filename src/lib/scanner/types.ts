export interface FileMetadata {
  path: string;
  name: string;
  size: number;
  modTime: Date;
  isDirectory: boolean;
  permissions?: string;
}

export interface ScanResult {
  path: string;
  files: FileMetadata[];
  scannedAt: Date;
  totalFiles: number;
  totalSize: number;
  errors: string[];
}

export interface DirectoryComparison {
  remotePath: string;
  localPath: string;
  remoteFiles: Map<string, FileMetadata>;
  localFiles: Map<string, FileMetadata>;
  comparedAt: Date;
  stats: ComparisonStats;
}

export interface ComparisonStats {
  totalRemote: number;
  totalLocal: number;
  synced: number;
  remoteOnly: number;
  localOnly: number;
  desynced: number;
  totalSizeRemote: number;
  totalSizeLocal: number;
}

export interface FileComparison {
  relativePath: string;
  filename: string;
  state: FileState;
  remote?: FileMetadata;
  local?: FileMetadata;
  sizeDifference?: number;
  timeDifference?: number;
}

export enum FileState {
  SYNCED = 'synced',
  REMOTE_ONLY = 'remote_only',
  LOCAL_ONLY = 'local_only',
  DESYNCED = 'desynced',
  QUEUED = 'queued',
  TRANSFERRING = 'transferring',
  FAILED = 'failed'
}

export interface ScanOptions {
  includeHidden?: boolean;
  followSymlinks?: boolean;
  maxDepth?: number;
  excludePatterns?: string[];
  includePatterns?: string[];
  compareContent?: boolean;
  parallelScans?: boolean;
}

export interface PatternMatcher {
  patterns: string[];
  isInclude: boolean;
  caseSensitive: boolean;
}

export interface AutoQueueConfig {
  enabled: boolean;
  patterns: PatternMatcher[];
  minFileSize?: number;
  maxFileSize?: number;
  excludeExtensions?: string[];
  includeExtensions?: string[];
}

export interface ScanProgress {
  jobId: string;
  phase: 'remote' | 'local' | 'comparing';
  currentPath: string;
  filesScanned: number;
  totalFiles?: number;
  bytesScanned: number;
  totalBytes?: number;
  startTime: Date;
  errors: string[];
}

export const DEFAULT_SCAN_OPTIONS: ScanOptions = {
  includeHidden: false,
  followSymlinks: false,
  maxDepth: undefined,
  excludePatterns: ['.DS_Store', 'Thumbs.db', '*.tmp', '*.temp'],
  includePatterns: [],
  compareContent: false,
  parallelScans: true
};
