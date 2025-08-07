import mongoose, { Document, Schema, Model, Types } from 'mongoose';
import { FileStateType } from '../lib/websocket/events';

// TypeScript interface for FileState
export interface IFileState extends Document {
  _id: string;
  jobId: Types.ObjectId;
  relativePath: string;
  filename: string;
  isDirectory: boolean;
  parentPath: string;
  remote: {
    size?: number;
    modTime?: Date;
    exists: boolean;
    isDirectory?: boolean;
  };
  local: {
    size?: number;
    modTime?: Date;
    exists: boolean;
    isDirectory?: boolean;
  };
  syncState: 'synced' | 'remote_only' | 'local_only' | 'desynced' | 'queued' | 'transferring' | 'failed';
  transfer: {
    progress: number;
    speed?: string;
    eta?: string;
    errorMessage?: string;
    retryCount: number;
    startedAt?: Date;
    completedAt?: Date;
  };
  directorySize?: number;
  fileCount?: number;
  lastSeen: Date;
  addedAt: Date;
  
  // Instance methods
  updateSyncState(): void;
  queueForTransfer(): void;
  startTransfer(): void;
  completeTransfer(): void;
  failTransfer(error: string): void;
}

// Filter interface for findByJob method
interface FileStateFilters {
  syncState?: FileStateType | FileStateType[];
  filename?: string;
  addedAfter?: string | Date;
  addedBefore?: string | Date;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  limit?: string | number;
  skip?: string | number;
}

// Static methods interface
export interface IFileStateModel extends Model<IFileState> {
  findByJob(jobId: string | Types.ObjectId, filters?: FileStateFilters): Promise<IFileState[]>;
  findQueuedFiles(): Promise<IFileState[]>;
  findTransferringFiles(): Promise<IFileState[]>;
  recalculateDirectoryStats(jobId: string | Types.ObjectId): Promise<{ matchedCount: number; modifiedCount: number }>;
}

// Remote metadata subdocument schema
const remoteMetadataSchema = new Schema({
  size: {
    type: Number,
    min: 0
  },
  modTime: {
    type: Date
  },
  exists: {
    type: Boolean,
    default: false
  },
  isDirectory: {
    type: Boolean,
    default: false
  }
}, { _id: false });

// Local metadata subdocument schema
const localMetadataSchema = new Schema({
  size: {
    type: Number,
    min: 0
  },
  modTime: {
    type: Date
  },
  exists: {
    type: Boolean,
    default: false
  },
  isDirectory: {
    type: Boolean,
    default: false
  }
}, { _id: false });

// Transfer metadata subdocument schema
const transferMetadataSchema = new Schema({
  progress: {
    type: Number,
    min: 0,
    max: 100,
    default: 0
  },
  speed: {
    type: String,
    validate: {
      validator: function(speed: string) {
        if (!speed) return true; // Optional field
        // Validate speed format like "10.5 MB/s", "1.2 GB/s", etc.
        return /^\d+(\.\d+)?\s*(B|KB|MB|GB|TB)\/s$/i.test(speed);
      },
      message: 'Speed must be in format like "10.5 MB/s"'
    }
  },
  eta: {
    type: String,
    validate: {
      validator: function(eta: string) {
        if (!eta) return true; // Optional field
        // Validate ETA format like "5m 30s", "1h 25m", "2h", etc.
        return /^\d+[dhms](\s+\d+[dhms])*$/.test(eta);
      },
      message: 'ETA must be in format like "1h 25m" or "5m 30s"'
    }
  },
  errorMessage: {
    type: String,
    maxlength: [500, 'Error message cannot exceed 500 characters']
  },
  retryCount: {
    type: Number,
    min: 0,
    default: 0
  },
  startedAt: {
    type: Date
  },
  completedAt: {
    type: Date
  }
}, { _id: false });

// FileState schema
const fileStateSchema = new Schema<IFileState>({
  jobId: {
    type: Schema.Types.ObjectId,
    ref: 'SyncJob',
    required: [true, 'Job ID is required'],
    validate: {
      validator: async function(jobId: Types.ObjectId) {
        const SyncJob = mongoose.model('SyncJob');
        const job = await SyncJob.findById(jobId);
        return !!job;
      },
      message: 'Referenced sync job does not exist'
    }
  },
  relativePath: {
    type: String,
    required: [true, 'Relative path is required'],
    trim: true,
    maxlength: [1000, 'Relative path cannot exceed 1000 characters'],
    validate: {
      validator: function(path: string) {
        // Validate relative path (no leading slash, no .. for security)
        return !path.startsWith('/') && !path.includes('../') && path.length > 0;
      },
      message: 'Relative path must not start with / or contain ../'
    }
  },
  filename: {
    type: String,
    required: [true, 'Filename is required'],
    trim: true,
    maxlength: [255, 'Filename cannot exceed 255 characters']
  },
  isDirectory: {
    type: Boolean,
    default: false,
    required: [true, 'isDirectory flag is required']
  },
  parentPath: {
    type: String,
    default: '',
    trim: true,
    maxlength: [1000, 'Parent path cannot exceed 1000 characters'],
    validate: {
      validator: function(path: string) {
        // Validate parent path (no leading slash, no .. for security)
        return !path.startsWith('/') && !path.includes('../');
      },
      message: 'Parent path must not start with / or contain ../'
    }
  },
  remote: {
    type: remoteMetadataSchema,
    default: () => ({
      exists: false
    })
  },
  local: {
    type: localMetadataSchema,
    default: () => ({
      exists: false
    })
  },
  syncState: {
    type: String,
    enum: {
      values: ['synced', 'remote_only', 'local_only', 'desynced', 'queued', 'transferring', 'failed'],
      message: 'Sync state must be one of: synced, remote_only, local_only, desynced, queued, transferring, failed'
    },
    required: [true, 'Sync state is required'],
    default: 'remote_only'
  },
  transfer: {
    type: transferMetadataSchema,
    default: () => ({
      progress: 0,
      retryCount: 0
    })
  },
  directorySize: {
    type: Number,
    min: 0,
    default: 0,
    validate: {
      validator: function(this: IFileState, size: number) {
        // Only directories should have directory size
        return !this.isDirectory || size >= 0;
      },
      message: 'Directory size must be non-negative for directories'
    }
  },
  fileCount: {
    type: Number,
    min: 0,
    default: 0,
    validate: {
      validator: function(this: IFileState, count: number) {
        // Only directories should have file count
        return !this.isDirectory || count >= 0;
      },
      message: 'File count must be non-negative for directories'
    }
  },
  lastSeen: {
    type: Date,
    required: [true, 'Last seen date is required'],
    default: Date.now
  },
  addedAt: {
    type: Date,
    required: [true, 'Added date is required'],
    default: Date.now,
    immutable: true
  }
}, {
  timestamps: false, // We manage our own timestamps
  toJSON: {
    transform: function(doc, ret: Record<string, unknown>) {
      delete ret.__v;
      return ret;
    }
  }
});

// Compound indexes for performance
fileStateSchema.index({ jobId: 1, relativePath: 1 }, { unique: true });
fileStateSchema.index({ jobId: 1 });
fileStateSchema.index({ syncState: 1 });
fileStateSchema.index({ lastSeen: 1 });
fileStateSchema.index({ jobId: 1, syncState: 1 });
fileStateSchema.index({ syncState: 1, 'transfer.retryCount': 1 });
fileStateSchema.index({ jobId: 1, isDirectory: 1 });
fileStateSchema.index({ jobId: 1, parentPath: 1 });
fileStateSchema.index({ jobId: 1, isDirectory: 1, syncState: 1 });

// Instance method: Update sync state based on metadata
fileStateSchema.methods.updateSyncState = function(this: IFileState): void {
  const remoteExists = this.remote.exists;
  const localExists = this.local.exists;
  
  // Don't update state if currently transferring
  if (this.syncState === 'transferring' || this.syncState === 'queued') {
    return;
  }
  
  if (!remoteExists && !localExists) {
    // File doesn't exist anywhere - this shouldn't happen normally
    this.syncState = 'failed';
  } else if (remoteExists && !localExists) {
    this.syncState = 'remote_only';
  } else if (!remoteExists && localExists) {
    this.syncState = 'local_only';
  } else if (remoteExists && localExists) {
    // Both exist - check if they're the same
    const sameSize = this.remote.size === this.local.size;
    const sameTime = this.remote.modTime && this.local.modTime && 
      Math.abs(this.remote.modTime.getTime() - this.local.modTime.getTime()) < 2000; // 2 second tolerance
    
    if (sameSize && sameTime) {
      this.syncState = 'synced';
    } else {
      this.syncState = 'desynced';
    }
  }
};

// Instance method: Queue file for transfer
fileStateSchema.methods.queueForTransfer = function(this: IFileState): void {
  if (this.syncState === 'transferring') {
    throw new Error('Cannot queue file that is currently transferring');
  }
  
  this.syncState = 'queued';
  this.transfer.progress = 0;
  this.transfer.speed = undefined;
  this.transfer.eta = undefined;
  this.transfer.errorMessage = undefined;
  this.transfer.startedAt = undefined;
  this.transfer.completedAt = undefined;
};

// Instance method: Start transfer
fileStateSchema.methods.startTransfer = function(this: IFileState): void {
  if (this.syncState !== 'queued') {
    throw new Error('Can only start transfer for queued files');
  }
  
  this.syncState = 'transferring';
  this.transfer.progress = 0;
  this.transfer.startedAt = new Date();
  this.transfer.completedAt = undefined;
  this.transfer.errorMessage = undefined;
};

// Instance method: Complete transfer
fileStateSchema.methods.completeTransfer = function(this: IFileState): void {
  if (this.syncState !== 'transferring') {
    throw new Error('Can only complete transfer for transferring files');
  }
  
  this.transfer.progress = 100;
  this.transfer.completedAt = new Date();
  this.transfer.speed = undefined;
  this.transfer.eta = undefined;
  this.transfer.errorMessage = undefined;
  
  // Update metadata and sync state
  this.local.exists = true;
  this.local.size = this.remote.size;
  this.local.modTime = this.remote.modTime;
  this.updateSyncState();
};

// Instance method: Fail transfer
fileStateSchema.methods.failTransfer = function(this: IFileState, error: string): void {
  if (this.syncState !== 'transferring') {
    throw new Error('Can only fail transfer for transferring files');
  }
  
  this.syncState = 'failed';
  this.transfer.errorMessage = error;
  this.transfer.retryCount += 1;
  this.transfer.completedAt = new Date();
  this.transfer.speed = undefined;
  this.transfer.eta = undefined;
};

// Static method: Find files by job with optional filters
fileStateSchema.statics.findByJob = function(
  jobId: string | Types.ObjectId, 
  filters: FileStateFilters = {}
): Promise<IFileState[]> {
  const query: Record<string, unknown> = { jobId };
  
  // Add sync state filter
  if (filters.syncState) {
    if (Array.isArray(filters.syncState)) {
      query.syncState = { $in: filters.syncState };
    } else {
      query.syncState = filters.syncState;
    }
  }
  
  // Add filename search
  if (filters.filename) {
    query.filename = new RegExp(filters.filename, 'i');
  }
  
  // Add date range filters
  if (filters.addedAfter) {
    query.addedAt = { $gte: new Date(filters.addedAfter) };
  }
  
  if (filters.addedBefore) {
    const existingDate = query.addedAt as Record<string, unknown> || {};
    query.addedAt = { ...existingDate, $lte: new Date(filters.addedBefore) };
  }
  
  let queryBuilder = this.find(query);
  
  // Add sorting
  if (filters.sortBy) {
    const sortDirection = filters.sortOrder === 'desc' ? -1 : 1;
    queryBuilder = queryBuilder.sort({ [filters.sortBy]: sortDirection });
  } else {
    queryBuilder = queryBuilder.sort({ relativePath: 1 });
  }
  
  // Add pagination
  if (filters.limit) {
    const limitNum = typeof filters.limit === 'string' ? parseInt(filters.limit) : filters.limit;
    queryBuilder = queryBuilder.limit(limitNum);
  }
  
  if (filters.skip) {
    const skipNum = typeof filters.skip === 'string' ? parseInt(filters.skip) : filters.skip;
    queryBuilder = queryBuilder.skip(skipNum);
  }
  
  return queryBuilder.exec();
};

// Static method: Find queued files
fileStateSchema.statics.findQueuedFiles = function(): Promise<IFileState[]> {
  return this.find({ syncState: 'queued' })
    .sort({ addedAt: 1 }) // FIFO queue
    .populate('jobId');
};

// Static method: Find transferring files
fileStateSchema.statics.findTransferringFiles = function(): Promise<IFileState[]> {
  return this.find({ syncState: 'transferring' })
    .sort({ 'transfer.startedAt': 1 })
    .populate('jobId');
};

// Pre-save middleware
fileStateSchema.pre('save', function(this: IFileState, next) {
  // Auto-generate filename from relativePath if not provided
  if (!this.filename && this.relativePath) {
    this.filename = this.relativePath.split('/').pop() || this.relativePath;
  }
  
  // Update lastSeen to current time
  this.lastSeen = new Date();
  
  // Validate transfer progress
  if (this.transfer.progress < 0 || this.transfer.progress > 100) {
    next(new Error('Transfer progress must be between 0 and 100'));
    return;
  }
  
  // Validate state transitions
  if (this.syncState === 'transferring' && !this.transfer.startedAt) {
    this.transfer.startedAt = new Date();
  }
  
  next();
});

// Static method: Bulk recalculate directory statistics
fileStateSchema.statics.recalculateDirectoryStats = async function(jobId: string | Types.ObjectId) {
  const { calculateAllDirectoryStats } = await import('../lib/scanner/directory-stats');
  
  // Get all file states for the job
  const fileStates = await this.find({ jobId }).lean();
  
  // Calculate statistics
  const statsMap = calculateAllDirectoryStats(fileStates as unknown as import('../lib/scanner/directory-stats').FileStateRecord[]);
  
  // Update directories with calculated statistics
  const bulkOps = [];
  for (const [directoryPath, stats] of statsMap) {
    bulkOps.push({
      updateOne: {
        filter: { 
          jobId,
          relativePath: directoryPath,
          isDirectory: true
        },
        update: {
          $set: {
            directorySize: stats.directorySize,
            fileCount: stats.fileCount
          }
        }
      }
    });
  }

  if (bulkOps.length > 0) {
    return await this.bulkWrite(bulkOps);
  }
  
  return { matchedCount: 0, modifiedCount: 0 };
};

// Create and export the model
const FileState = mongoose.models.FileState || mongoose.model<IFileState, IFileStateModel>('FileState', fileStateSchema);

export default FileState;
