import mongoose, { Document, Schema, Model, Types } from 'mongoose';
import { IServerProfile } from './ServerProfile';

// TypeScript interface for SyncJob
export interface ISyncJob extends Document {
  _id: string;
  name: string;
  enabled: boolean;
  serverProfileId: Types.ObjectId;
  remotePath: string;
  localPath: string;
  chmod: string;
  scanInterval: number;
  autoQueue: {
    enabled: boolean;
    patterns: string[];
    excludePatterns: string[];
  };
  delugeAction: {
    action: 'none' | 'remove' | 'remove_data' | 'set_label';
    delay: number;
    label?: string;
  };
  parallelism: {
    maxConcurrentTransfers: number;
    maxConnectionsPerTransfer: number;
  };
  lastScan?: Date;
  createdAt: Date;
  updatedAt: Date;
  
  // Virtual fields
  isActive: boolean;
  nextScanTime: Date | null;
  
  // Instance methods
  validatePaths(): Promise<{ valid: boolean; errors: string[] }>;
  getServerProfile(): Promise<IServerProfile | null>;
}

// Static methods interface
export interface ISyncJobModel extends Model<ISyncJob> {
  findActiveJobs(): Promise<ISyncJob[]>;
  findJobsForScan(): Promise<ISyncJob[]>;
}

// AutoQueue subdocument schema
const autoQueueSchema = new Schema({
  enabled: {
    type: Boolean,
    default: false
  },
  patterns: {
    type: [String],
    default: [],
    validate: {
      validator: function(patterns: string[]) {
        // Validate that all patterns are valid glob patterns
        return patterns.every(pattern => typeof pattern === 'string' && pattern.length > 0);
      },
      message: 'All patterns must be non-empty strings'
    }
  },
  excludePatterns: {
    type: [String],
    default: []
  }
}, { _id: false });

// Deluge action subdocument schema
const delugeActionSchema = new Schema({
  action: {
    type: String,
    enum: {
      values: ['none', 'remove', 'remove_data', 'set_label'],
      message: 'Action must be one of: none, remove, remove_data, set_label'
    },
    default: 'none'
  },
  delay: {
    type: Number,
    min: [0, 'Delay must be 0 or greater'],
    max: [1440, 'Delay cannot exceed 1440 minutes (24 hours)'],
    default: 15
  },
  label: {
    type: String,
    required: function(this: any) {
      return this.action === 'set_label';
    },
    trim: true,
    maxlength: [50, 'Label cannot exceed 50 characters']
  }
}, { _id: false });

// Parallelism subdocument schema
const parallelismSchema = new Schema({
  maxConcurrentTransfers: {
    type: Number,
    min: [1, 'Max concurrent transfers must be at least 1'],
    max: [10, 'Max concurrent transfers cannot exceed 10'],
    default: 3
  },
  maxConnectionsPerTransfer: {
    type: Number,
    min: [1, 'Max connections per transfer must be at least 1'],
    max: [20, 'Max connections per transfer cannot exceed 20'],
    default: 5
  }
}, { _id: false });

// SyncJob schema
const syncJobSchema = new Schema<ISyncJob>({
  name: {
    type: String,
    required: [true, 'Sync job name is required'],
    unique: true,
    trim: true,
    maxlength: [100, 'Sync job name cannot exceed 100 characters'],
    validate: {
      validator: function(name: string) {
        return /^[a-zA-Z0-9\s\-_]+$/.test(name);
      },
      message: 'Sync job name can only contain letters, numbers, spaces, hyphens, and underscores'
    }
  },
  enabled: {
    type: Boolean,
    default: true
  },
  serverProfileId: {
    type: Schema.Types.ObjectId,
    ref: 'ServerProfile',
    required: [true, 'Server profile is required'],
    validate: {
      validator: async function(profileId: Types.ObjectId) {
        const ServerProfile = mongoose.model('ServerProfile');
        const profile = await ServerProfile.findById(profileId);
        return !!profile;
      },
      message: 'Referenced server profile does not exist'
    }
  },
  remotePath: {
    type: String,
    required: [true, 'Remote path is required'],
    trim: true,
    validate: {
      validator: function(path: string) {
        // Validate absolute Unix path
        return /^\/[a-zA-Z0-9\/_\-.\s]*$/.test(path);
      },
      message: 'Remote path must be an absolute Unix path'
    }
  },
  localPath: {
    type: String,
    required: [true, 'Local path is required'],
    trim: true,
    validate: {
      validator: function(path: string) {
        // Validate absolute path (Unix or Windows)
        return /^(\/[a-zA-Z0-9\/_\-.\s]*|[a-zA-Z]:\\[a-zA-Z0-9\\_\-.\s\\]*)$/.test(path);
      },
      message: 'Local path must be an absolute path'
    }
  },
  chmod: {
    type: String,
    default: '755',
    validate: {
      validator: function(mode: string) {
        // Validate octal chmod format
        return /^[0-7]{3,4}$/.test(mode);
      },
      message: 'Chmod must be a valid octal permission mode (e.g., 755, 644)'
    }
  },
  scanInterval: {
    type: Number,
    required: [true, 'Scan interval is required'],
    min: [5, 'Scan interval must be at least 5 minutes'],
    max: [10080, 'Scan interval cannot exceed 10080 minutes (1 week)'],
    default: 60
  },
  autoQueue: {
    type: autoQueueSchema,
    default: () => ({
      enabled: false,
      patterns: [],
      excludePatterns: []
    })
  },
  delugeAction: {
    type: delugeActionSchema,
    default: () => ({
      action: 'none',
      delay: 15
    })
  },
  parallelism: {
    type: parallelismSchema,
    default: () => ({
      maxConcurrentTransfers: 3,
      maxConnectionsPerTransfer: 5
    })
  },
  lastScan: {
    type: Date,
    required: false
  }
}, {
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform: function(doc, ret) {
      delete ret.__v;
      return ret;
    }
  }
});

// Indexes
syncJobSchema.index({ name: 1 }, { unique: true });
syncJobSchema.index({ serverProfileId: 1 });
syncJobSchema.index({ enabled: 1 });
syncJobSchema.index({ lastScan: 1 });
syncJobSchema.index({ enabled: 1, lastScan: 1 });

// Virtual field: isActive
syncJobSchema.virtual('isActive').get(function(this: ISyncJob) {
  return this.enabled && !!this.serverProfileId;
});

// Virtual field: nextScanTime
syncJobSchema.virtual('nextScanTime').get(function(this: ISyncJob): Date | null {
  if (!this.lastScan || !this.enabled) {
    return null;
  }
  return new Date(this.lastScan.getTime() + (this.scanInterval * 60 * 1000));
});

// Instance method: Validate paths
syncJobSchema.methods.validatePaths = async function(this: ISyncJob): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];
  
  try {
    // Basic path validation
    if (!this.remotePath.startsWith('/')) {
      errors.push('Remote path must be absolute (start with /)');
    }
    
    if (!this.localPath || (!this.localPath.startsWith('/') && !/^[a-zA-Z]:/.test(this.localPath))) {
      errors.push('Local path must be absolute');
    }
    
    // TODO: Implement actual path accessibility checks
    // This would involve SSH connection to remote server and local filesystem checks
    console.log(`Validating paths: remote=${this.remotePath}, local=${this.localPath}`);
    
    return {
      valid: errors.length === 0,
      errors
    };
  } catch (error) {
    errors.push(`Path validation error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return {
      valid: false,
      errors
    };
  }
};

// Instance method: Get server profile
syncJobSchema.methods.getServerProfile = async function(this: ISyncJob): Promise<IServerProfile | null> {
  try {
    await this.populate('serverProfileId');
    return this.serverProfileId as unknown as IServerProfile;
  } catch (error) {
    console.error('Error getting server profile:', error);
    return null;
  }
};

// Static method: Find active jobs
syncJobSchema.statics.findActiveJobs = function(): Promise<ISyncJob[]> {
  return this.find({ enabled: true }).populate('serverProfileId');
};

// Static method: Find jobs due for scanning
syncJobSchema.statics.findJobsForScan = function(): Promise<ISyncJob[]> {
  const now = new Date();
  return this.find({
    enabled: true,
    $or: [
      { lastScan: { $exists: false } },
      { lastScan: null },
      {
        $expr: {
          $lt: [
            { $add: ['$lastScan', { $multiply: ['$scanInterval', 60000] }] },
            now
          ]
        }
      }
    ]
  }).populate('serverProfileId');
};

// Pre-save validation
syncJobSchema.pre('save', async function(this: ISyncJob, next) {
  // Validate server profile exists
  if (this.isModified('serverProfileId')) {
    const ServerProfile = mongoose.model('ServerProfile');
    const profile = await ServerProfile.findById(this.serverProfileId);
    if (!profile) {
      next(new Error('Referenced server profile does not exist'));
      return;
    }
  }
  
  // Validate deluge action configuration
  if (this.delugeAction.action === 'set_label' && !this.delugeAction.label) {
    next(new Error('Label is required when deluge action is set_label'));
    return;
  }
  
  next();
});

// Create and export the model
const SyncJob = mongoose.models.SyncJob || mongoose.model<ISyncJob, ISyncJobModel>('SyncJob', syncJobSchema);

export default SyncJob;
