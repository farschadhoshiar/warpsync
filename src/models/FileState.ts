import mongoose, { Document, Schema, Model, Types } from "mongoose";
import { FileStateType } from "../lib/websocket/events";

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
  syncState:
    | "synced"
    | "remote_only"
    | "local_only"
    | "desynced"
    | "queued"
    | "transferring"
    | "failed";
  transfer: {
    progress: number;
    speed?: string;
    eta?: string;
    errorMessage?: string;
    retryCount: number;
    startedAt?: Date;
    completedAt?: Date;
    transferId?: string;
    lastManualRequest?: Date;
    manualPriority?: boolean;
    source?: "manual" | "automatic" | "scheduled";
    activeTransferId?: string;
    jobConcurrencySlot?: number;
    lastStateChange?: Date;
    stateHistory?: Array<{
      fromState: string;
      toState: string;
      timestamp: Date;
      reason?: string;
      metadata?: Record<string, any>;
    }>;
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
  atomicStateTransition(
    newState: string,
    options?: {
      transferId?: string;
      reason?: string;
      metadata?: Record<string, any>;
    },
  ): Promise<boolean>;
  canBeQueued(maxConcurrency: number): Promise<boolean>;
  assignConcurrencySlot(
    slotNumber: number,
    transferId: string,
  ): Promise<boolean>;
  releaseConcurrencySlot(reason?: string): Promise<boolean>;
}

// Filter interface for findByJob method
interface FileStateFilters {
  syncState?: FileStateType | FileStateType[];
  filename?: string;
  addedAfter?: string | Date;
  addedBefore?: string | Date;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  limit?: string | number;
  skip?: string | number;
}

// Static methods interface
export interface IFileStateModel extends Model<IFileState> {
  findByJob(
    jobId: string | Types.ObjectId,
    filters?: FileStateFilters,
  ): Promise<IFileState[]>;
  findQueuedFiles(): Promise<IFileState[]>;
  findTransferringFiles(): Promise<IFileState[]>;
  recalculateDirectoryStats(
    jobId: string | Types.ObjectId,
  ): Promise<{ matchedCount: number; modifiedCount: number }>;
  getActiveTransfersForJob(jobId: string): Promise<IFileState[]>;
  findOrphanedTransfers(maxAge?: number): Promise<IFileState[]>;
  resetOrphanedTransfers(transferIds: string[]): Promise<number>;
}

// Remote metadata subdocument schema
const remoteMetadataSchema = new Schema(
  {
    size: {
      type: Number,
      min: 0,
    },
    modTime: {
      type: Date,
    },
    exists: {
      type: Boolean,
      default: false,
    },
    isDirectory: {
      type: Boolean,
      default: false,
    },
  },
  { _id: false },
);

// Local metadata subdocument schema
const localMetadataSchema = new Schema(
  {
    size: {
      type: Number,
      min: 0,
    },
    modTime: {
      type: Date,
    },
    exists: {
      type: Boolean,
      default: false,
    },
    isDirectory: {
      type: Boolean,
      default: false,
    },
  },
  { _id: false },
);

// Transfer metadata subdocument schema
const transferMetadataSchema = new Schema(
  {
    progress: {
      type: Number,
      min: 0,
      max: 100,
      default: 0,
    },
    speed: {
      type: String,
      validate: {
        validator: function (speed: string) {
          if (!speed) return true; // Optional field
          // Validate speed format like "10.5 MB/s", "1.2 GB/s", etc.
          return /^\d+(\.\d+)?\s*(B|KB|MB|GB|TB)\/s$/i.test(speed);
        },
        message: 'Speed must be in format like "10.5 MB/s"',
      },
    },
    eta: {
      type: String,
      validate: {
        validator: function (eta: string) {
          if (!eta) return true; // Optional field
          // Validate ETA format like "5m 30s", "1h 25m", "2h", etc.
          return /^\d+[dhms](\s+\d+[dhms])*$/.test(eta);
        },
        message: 'ETA must be in format like "1h 25m" or "5m 30s"',
      },
    },
    errorMessage: {
      type: String,
      maxlength: [500, "Error message cannot exceed 500 characters"],
    },
    retryCount: {
      type: Number,
      min: 0,
      default: 0,
    },
    startedAt: {
      type: Date,
    },
    completedAt: {
      type: Date,
    },
    transferId: {
      type: String,
      maxlength: [100, "Transfer ID cannot exceed 100 characters"],
    },
    lastManualRequest: {
      type: Date,
    },
    manualPriority: {
      type: Boolean,
      default: false,
    },
    source: {
      type: String,
      enum: {
        values: ["manual", "automatic", "scheduled"],
        message: "Transfer source must be one of: manual, automatic, scheduled",
      },
    },
    activeTransferId: {
      type: String,
      maxlength: [100, "Active transfer ID cannot exceed 100 characters"],
      sparse: true,
    },
    jobConcurrencySlot: {
      type: Number,
      min: 0,
      sparse: true,
    },
    lastStateChange: {
      type: Date,
      default: Date.now,
    },
    stateHistory: [
      {
        fromState: {
          type: String,
          required: true,
        },
        toState: {
          type: String,
          required: true,
        },
        timestamp: {
          type: Date,
          default: Date.now,
        },
        reason: {
          type: String,
          maxlength: [200, "State change reason cannot exceed 200 characters"],
        },
        metadata: {
          type: Schema.Types.Mixed,
        },
      },
    ],
  },
  { _id: false },
);

// FileState schema
const fileStateSchema = new Schema<IFileState>(
  {
    jobId: {
      type: Schema.Types.ObjectId,
      ref: "SyncJob",
      required: [true, "Job ID is required"],
      validate: {
        validator: async function (jobId: Types.ObjectId) {
          const SyncJob = mongoose.model("SyncJob");
          const job = await SyncJob.findById(jobId);
          return !!job;
        },
        message: "Referenced sync job does not exist",
      },
    },
    relativePath: {
      type: String,
      required: [true, "Relative path is required"],
      trim: true,
      maxlength: [1000, "Relative path cannot exceed 1000 characters"],
      validate: {
        validator: function (path: string) {
          // Validate relative path (no leading slash, no .. for security)
          return (
            !path.startsWith("/") && !path.includes("../") && path.length > 0
          );
        },
        message: "Relative path must not start with / or contain ../",
      },
    },
    filename: {
      type: String,
      required: [true, "Filename is required"],
      trim: true,
      maxlength: [255, "Filename cannot exceed 255 characters"],
    },
    isDirectory: {
      type: Boolean,
      default: false,
      required: [true, "isDirectory flag is required"],
    },
    parentPath: {
      type: String,
      default: "",
      trim: true,
      maxlength: [1000, "Parent path cannot exceed 1000 characters"],
      validate: {
        validator: function (path: string) {
          // Validate parent path (no leading slash, no .. for security)
          return !path.startsWith("/") && !path.includes("../");
        },
        message: "Parent path must not start with / or contain ../",
      },
    },
    remote: {
      type: remoteMetadataSchema,
      default: () => ({
        exists: false,
      }),
    },
    local: {
      type: localMetadataSchema,
      default: () => ({
        exists: false,
      }),
    },
    syncState: {
      type: String,
      enum: {
        values: [
          "synced",
          "remote_only",
          "local_only",
          "desynced",
          "queued",
          "transferring",
          "failed",
        ],
        message:
          "Sync state must be one of: synced, remote_only, local_only, desynced, queued, transferring, failed",
      },
      required: [true, "Sync state is required"],
      default: "remote_only",
    },
    transfer: {
      type: transferMetadataSchema,
      default: () => ({
        progress: 0,
        retryCount: 0,
      }),
    },
    directorySize: {
      type: Number,
      min: 0,
      default: 0,
      validate: {
        validator: function (this: IFileState, size: number) {
          // Only directories should have directory size
          return !this.isDirectory || size >= 0;
        },
        message: "Directory size must be non-negative for directories",
      },
    },
    fileCount: {
      type: Number,
      min: 0,
      default: 0,
      validate: {
        validator: function (this: IFileState, count: number) {
          // Only directories should have file count
          return !this.isDirectory || count >= 0;
        },
        message: "File count must be non-negative for directories",
      },
    },
    lastSeen: {
      type: Date,
      required: [true, "Last seen date is required"],
      default: Date.now,
    },
    addedAt: {
      type: Date,
      required: [true, "Added date is required"],
      default: Date.now,
      immutable: true,
    },
  },
  {
    timestamps: false, // We manage our own timestamps
    toJSON: {
      transform: function (doc, ret: Record<string, unknown>) {
        delete ret.__v;
        return ret;
      },
    },
  },
);

// Compound indexes for performance
fileStateSchema.index({ jobId: 1, relativePath: 1 }, { unique: true });
fileStateSchema.index({ jobId: 1 });
fileStateSchema.index({ syncState: 1 });
fileStateSchema.index({ lastSeen: 1 });
fileStateSchema.index({ jobId: 1, syncState: 1 });
fileStateSchema.index({ syncState: 1, "transfer.retryCount": 1 });
fileStateSchema.index({ jobId: 1, isDirectory: 1 });
fileStateSchema.index({ jobId: 1, parentPath: 1 });
fileStateSchema.index({ jobId: 1, isDirectory: 1, syncState: 1 });

// Enhanced indexes for new transfer state fields
fileStateSchema.index({ "transfer.activeTransferId": 1 }, { sparse: true });
fileStateSchema.index({
  jobId: 1,
  syncState: 1,
  "transfer.jobConcurrencySlot": 1,
});
fileStateSchema.index({ syncState: 1, "transfer.lastStateChange": 1 });
fileStateSchema.index({ "transfer.lastStateChange": 1 });

// Instance method: Update sync state based on metadata
fileStateSchema.methods.updateSyncState = function (this: IFileState): void {
  const remoteExists = this.remote.exists;
  const localExists = this.local.exists;

  // Don't update state if currently transferring
  if (this.syncState === "transferring" || this.syncState === "queued") {
    return;
  }

  if (!remoteExists && !localExists) {
    // File doesn't exist anywhere - this shouldn't happen normally
    this.syncState = "failed";
  } else if (remoteExists && !localExists) {
    this.syncState = "remote_only";
  } else if (!remoteExists && localExists) {
    this.syncState = "local_only";
  } else if (remoteExists && localExists) {
    // Both exist - check if they're the same
    const sameSize = this.remote.size === this.local.size;
    const sameTime =
      this.remote.modTime &&
      this.local.modTime &&
      Math.abs(this.remote.modTime.getTime() - this.local.modTime.getTime()) <
        2000; // 2 second tolerance

    if (sameSize && sameTime) {
      this.syncState = "synced";
    } else {
      this.syncState = "desynced";
    }
  }
};

// Instance method: Queue file for transfer
fileStateSchema.methods.queueForTransfer = function (this: IFileState): void {
  if (this.syncState === "transferring") {
    throw new Error("Cannot queue file that is currently transferring");
  }

  this.syncState = "queued";
  this.transfer.progress = 0;
  this.transfer.speed = undefined;
  this.transfer.eta = undefined;
  this.transfer.errorMessage = undefined;
  this.transfer.startedAt = undefined;
  this.transfer.completedAt = undefined;
};

// Instance method: Start transfer
fileStateSchema.methods.startTransfer = function (this: IFileState): void {
  if (this.syncState !== "queued") {
    throw new Error("Can only start transfer for queued files");
  }

  this.syncState = "transferring";
  this.transfer.progress = 0;
  this.transfer.startedAt = new Date();
  this.transfer.completedAt = undefined;
  this.transfer.errorMessage = undefined;
};

// Instance method: Update transfer progress dynamically
fileStateSchema.methods.updateTransferProgress = function (
  this: IFileState,
  progress: number,
  speed?: string,
  eta?: string,
): void {
  if (this.syncState !== "transferring") {
    throw new Error("Can only update progress for transferring files");
  }

  this.transfer.progress = Math.min(Math.max(progress, 0), 100);
  if (speed) this.transfer.speed = speed;
  if (eta) this.transfer.eta = eta;
};

// Instance method: Update transfer status dynamically
fileStateSchema.methods.updateTransferStatus = function (
  this: IFileState,
  newStatus: "queued" | "transferring" | "synced" | "failed",
  metadata?: Record<string, any>,
): void {
  const oldStatus = this.syncState;
  this.syncState = newStatus;

  // Update transfer metadata if provided
  if (metadata) {
    if (metadata.progress !== undefined) {
      this.transfer.progress = metadata.progress;
    }
    if (metadata.speed !== undefined) {
      this.transfer.speed = metadata.speed;
    }
    if (metadata.eta !== undefined) {
      this.transfer.eta = metadata.eta;
    }
    if (metadata.error !== undefined) {
      this.transfer.errorMessage = metadata.error;
    }
  }
};

// Instance method: Complete transfer
fileStateSchema.methods.completeTransfer = function (this: IFileState): void {
  if (this.syncState !== "transferring") {
    throw new Error("Can only complete transfer for transferring files");
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
fileStateSchema.methods.failTransfer = function (
  this: IFileState,
  error: string,
): void {
  if (this.syncState !== "transferring") {
    throw new Error("Can only fail transfer for transferring files");
  }

  this.syncState = "failed";
  this.transfer.errorMessage = error;
  this.transfer.retryCount += 1;
  this.transfer.completedAt = new Date();
  this.transfer.speed = undefined;
  this.transfer.eta = undefined;
};

// Instance method: Atomic state transition with history
fileStateSchema.methods.atomicStateTransition = async function (
  this: IFileState,
  newState: string,
  options?: {
    transferId?: string;
    reason?: string;
    metadata?: Record<string, any>;
  },
): Promise<boolean> {
  const oldState = this.syncState;

  // Validate state transition
  const validTransitions = {
    remote_only: ["queued", "failed"],
    queued: ["transferring", "failed", "remote_only"],
    transferring: ["synced", "failed", "queued"],
    failed: ["queued", "remote_only"],
    synced: ["desynced", "failed"],
    desynced: ["queued", "failed"],
    local_only: ["failed"],
  };

  if (
    validTransitions[oldState as keyof typeof validTransitions]?.includes(
      newState,
    ) ||
    oldState === newState
  ) {
    this.syncState = newState as any;
    this.transfer.lastStateChange = new Date();

    if (options?.transferId) {
      this.transfer.activeTransferId = options.transferId;
    }

    // Add to state history
    this.transfer.stateHistory.push({
      fromState: oldState,
      toState: newState,
      timestamp: new Date(),
      reason: options?.reason || `Transition from ${oldState} to ${newState}`,
      metadata: options?.metadata,
    });

    // Limit state history to last 10 entries
    if (this.transfer.stateHistory.length > 10) {
      this.transfer.stateHistory = this.transfer.stateHistory.slice(-10);
    }

    return true;
  }

  return false;
};

// Instance method: Check if file can be queued (respects concurrency)
fileStateSchema.methods.canBeQueued = async function (
  this: IFileState,
  maxConcurrency: number,
): Promise<boolean> {
  if (this.syncState === "transferring") {
    return false;
  }

  // Count active transfers for this job
  const activeCount = await (this.constructor as any).countDocuments({
    jobId: this.jobId,
    syncState: "transferring",
  });

  return activeCount < maxConcurrency;
};

// Instance method: Assign concurrency slot
fileStateSchema.methods.assignConcurrencySlot = async function (
  this: IFileState,
  slotNumber: number,
  transferId: string,
): Promise<boolean> {
  // Atomic operation to assign slot if available
  const result = await (this.constructor as any).findOneAndUpdate(
    {
      _id: this._id,
      $or: [
        { "transfer.jobConcurrencySlot": { $exists: false } },
        { "transfer.jobConcurrencySlot": null },
      ],
    },
    {
      $set: {
        "transfer.jobConcurrencySlot": slotNumber,
        "transfer.activeTransferId": transferId,
        "transfer.lastStateChange": new Date(),
      },
    },
    { new: true },
  );

  if (result) {
    this.transfer.jobConcurrencySlot = slotNumber;
    this.transfer.activeTransferId = transferId;
    this.transfer.lastStateChange = new Date();
    console.log(`Assigned slot ${slotNumber} to file ${this._id}`);
    return true;
  } else {
    console.warn(`Failed to assign slot ${slotNumber} to file ${this._id}`);
    return false;
  }
};

// Instance method: Release concurrency slot
fileStateSchema.methods.releaseConcurrencySlot = async function (
  this: IFileState,
  reason?: string,
): Promise<boolean> {
  const result = await (this.constructor as any).findOneAndUpdate(
    { _id: this._id },
    {
      $unset: {
        "transfer.jobConcurrencySlot": 1,
        "transfer.activeTransferId": 1,
      },
      $set: {
        "transfer.lastStateChange": new Date(),
      },
      $push: {
        "transfer.stateHistory": {
          fromState: this.syncState,
          toState: this.syncState,
          timestamp: new Date(),
          reason: reason || "Concurrency slot released",
          metadata: { slotReleased: true },
        },
      },
    },
    { new: true },
  );

  if (result) {
    this.transfer.jobConcurrencySlot = undefined;
    this.transfer.activeTransferId = undefined;
    this.transfer.lastStateChange = new Date();
    console.log(`Released concurrency slot for file ${this._id}`);
    return true;
  } else {
    console.warn(`Failed to release concurrency slot for file ${this._id}`);
    return false;
  }
};

// Static method: Get active transfers for job with concurrency info
fileStateSchema.statics.getActiveTransfersForJob = function (
  jobId: string,
): Promise<IFileState[]> {
  return this.find({
    jobId,
    syncState: { $in: ["queued", "transferring"] },
  }).sort({ "transfer.jobConcurrencySlot": 1, "transfer.lastStateChange": 1 });
};

// Static method: Find orphaned transferring states
fileStateSchema.statics.findOrphanedTransfers = function (
  maxAge: number = 30 * 60 * 1000, // 30 minutes default
): Promise<IFileState[]> {
  const cutoff = new Date(Date.now() - maxAge);

  return this.find({
    syncState: "transferring",
    "transfer.lastStateChange": { $lt: cutoff },
  });
};

// Static method: Reset orphaned transfers to failed state
fileStateSchema.statics.resetOrphanedTransfers = async function (
  transferIds: string[],
): Promise<number> {
  if (transferIds.length === 0) {
    return 0;
  }

  const result = await this.updateMany(
    { "transfer.activeTransferId": { $in: transferIds } },
    {
      $set: {
        syncState: "failed",
        "transfer.errorMessage": "Transfer orphaned - reset by system",
        "transfer.completedAt": new Date(),
        "transfer.lastStateChange": new Date(),
      },
      $unset: {
        "transfer.activeTransferId": 1,
        "transfer.jobConcurrencySlot": 1,
      },
    },
  );

  return result.modifiedCount;
};

// Static method: Find files by job with optional filters
fileStateSchema.statics.findByJob = function (
  jobId: string | Types.ObjectId,
  filters: FileStateFilters = {},
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
    query.filename = new RegExp(filters.filename, "i");
  }

  // Add date range filters
  if (filters.addedAfter) {
    query.addedAt = { $gte: new Date(filters.addedAfter) };
  }

  if (filters.addedBefore) {
    const existingDate = (query.addedAt as Record<string, unknown>) || {};
    query.addedAt = { ...existingDate, $lte: new Date(filters.addedBefore) };
  }

  let queryBuilder = this.find(query);

  // Add sorting
  if (filters.sortBy) {
    const sortDirection = filters.sortOrder === "desc" ? -1 : 1;
    queryBuilder = queryBuilder.sort({ [filters.sortBy]: sortDirection });
  } else {
    queryBuilder = queryBuilder.sort({ relativePath: 1 });
  }

  // Add pagination
  if (filters.limit) {
    const limitNum =
      typeof filters.limit === "string"
        ? parseInt(filters.limit)
        : filters.limit;
    queryBuilder = queryBuilder.limit(limitNum);
  }

  if (filters.skip) {
    const skipNum =
      typeof filters.skip === "string" ? parseInt(filters.skip) : filters.skip;
    queryBuilder = queryBuilder.skip(skipNum);
  }

  return queryBuilder.exec();
};

// Static method: Find queued files
fileStateSchema.statics.findQueuedFiles = function (): Promise<IFileState[]> {
  return this.find({ syncState: "queued" })
    .sort({ addedAt: 1 }) // FIFO queue
    .populate("jobId");
};

// Static method: Find transferring files
fileStateSchema.statics.findTransferringFiles = function (): Promise<
  IFileState[]
> {
  return this.find({ syncState: "transferring" })
    .sort({ "transfer.startedAt": 1 })
    .populate("jobId");
};

// Pre-save middleware
fileStateSchema.pre("save", function (this: IFileState, next) {
  // Auto-generate filename from relativePath if not provided
  if (!this.filename && this.relativePath) {
    this.filename = this.relativePath.split("/").pop() || this.relativePath;
  }

  // Update lastSeen to current time
  this.lastSeen = new Date();

  // Validate transfer progress
  if (this.transfer.progress < 0 || this.transfer.progress > 100) {
    next(new Error("Transfer progress must be between 0 and 100"));
    return;
  }

  // Validate state transitions
  if (this.syncState === "transferring" && !this.transfer.startedAt) {
    this.transfer.startedAt = new Date();
  }

  next();
});

// Static method: Bulk recalculate directory statistics
fileStateSchema.statics.recalculateDirectoryStats = async function (
  jobId: string | Types.ObjectId,
) {
  const { calculateAllDirectoryStats } = await import(
    "../lib/scanner/directory-stats"
  );

  // Get all file states for the job
  const fileStates = await this.find({ jobId }).lean();

  // Calculate statistics
  const statsMap = calculateAllDirectoryStats(
    fileStates as unknown as import("../lib/scanner/directory-stats").FileStateRecord[],
  );

  // Update directories with calculated statistics
  const bulkOps = [];
  for (const [directoryPath, stats] of statsMap) {
    bulkOps.push({
      updateOne: {
        filter: {
          jobId,
          relativePath: directoryPath,
          isDirectory: true,
        },
        update: {
          $set: {
            directorySize: stats.directorySize,
            fileCount: stats.fileCount,
          },
        },
      },
    });
  }

  if (bulkOps.length > 0) {
    return await this.bulkWrite(bulkOps);
  }

  return { matchedCount: 0, modifiedCount: 0 };
};

// Create and export the model
const FileState =
  mongoose.models.FileState ||
  mongoose.model<IFileState, IFileStateModel>("FileState", fileStateSchema);

export default FileState;
