import mongoose, { Document, Schema, Model } from 'mongoose';

// TypeScript interface for ServerProfile
export interface IServerProfile extends Document {
  _id: string;
  name: string;
  address: string;
  port: number;
  user: string;
  authMethod: 'password' | 'key';
  password?: string;
  privateKey?: string;
  deluge?: {
    host: string;
    port: number;
    username: string;
    password: string;
  };
  createdAt: Date;
  updatedAt: Date;
  
  // Instance methods
  testConnection(): Promise<boolean>;
  toSafeObject(): Omit<IServerProfile, 'password' | 'privateKey'>;
}

// Static methods interface
export interface IServerProfileModel extends Model<IServerProfile> {
  findByName(name: string): Promise<IServerProfile | null>;
}

// Deluge subdocument schema
const delugeSchema = new Schema({
  host: {
    type: String,
    required: true,
    trim: true
  },
  port: {
    type: Number,
    required: true,
    min: 1,
    max: 65535,
    default: 58846
  },
  username: {
    type: String,
    required: true,
    trim: true
  },
  password: {
    type: String,
    required: true
  }
}, { _id: false });

// ServerProfile schema
const serverProfileSchema = new Schema<IServerProfile>({
  name: {
    type: String,
    required: [true, 'Server profile name is required'],
    trim: true,
    maxlength: [100, 'Server profile name cannot exceed 100 characters'],
    validate: {
      validator: function(name: string) {
        return /^[a-zA-Z0-9\s\-_]+$/.test(name);
      },
      message: 'Server profile name can only contain letters, numbers, spaces, hyphens, and underscores'
    }
  },
  address: {
    type: String,
    required: [true, 'Server address is required'],
    trim: true,
    validate: {
      validator: function(address: string) {
        // Allow IP addresses, hostnames, and FQDNs
        const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
        const hostnameRegex = /^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)*$/;
        return ipRegex.test(address) || hostnameRegex.test(address);
      },
      message: 'Please provide a valid IP address or hostname'
    }
  },
  port: {
    type: Number,
    required: [true, 'Port is required'],
    min: [1, 'Port must be between 1 and 65535'],
    max: [65535, 'Port must be between 1 and 65535'],
    default: 22
  },
  user: {
    type: String,
    required: [true, 'Username is required'],
    trim: true,
    maxlength: [50, 'Username cannot exceed 50 characters']
  },
  authMethod: {
    type: String,
    required: [true, 'Authentication method is required'],
    enum: {
      values: ['password', 'key'],
      message: 'Authentication method must be either "password" or "key"'
    }
  },
  password: {
    type: String,
    required: function(this: IServerProfile) {
      return this.authMethod === 'password';
    }
  },
  privateKey: {
    type: String,
    required: function(this: IServerProfile) {
      return this.authMethod === 'key';
    }
  },
  deluge: {
    type: delugeSchema,
    required: false
  }
}, {
  timestamps: true,
  toJSON: {
    transform: function(doc, ret: Record<string, unknown>) {
      delete ret.__v;
      return ret;
    }
  }
});

// Indexes
serverProfileSchema.index({ name: 1 }, { unique: true });
serverProfileSchema.index({ address: 1, port: 1 });

// Instance method: Test SSH connection
serverProfileSchema.methods.testConnection = async function(this: IServerProfile): Promise<boolean> {
  try {
    console.log(`=== SSH Connection Test Debug for ${this.user}@${this.address}:${this.port} ===`);
    console.log('Auth method:', this.authMethod);
    console.log('Password provided:', !!this.password);
    console.log('Private key provided:', !!this.privateKey);
    
    // Dynamically import SSH connection manager to avoid bundling on client side
    const { SSHConnectionManager } = await import('../lib/ssh/ssh-connection');
    
    // Create SSH connection manager instance
    const sshManager = new SSHConnectionManager();
    
    // Build SSH config from this server profile
    const config = {
      id: `test-${this._id}`,
      name: `Test connection for ${this.name}`,
      host: this.address,
      port: this.port,
      username: this.user,
      ...(this.authMethod === 'password' 
        ? { password: this.password }
        : { privateKey: this.privateKey }
      )
    };
    
    console.log('SSH Config created:', {
      id: config.id,
      name: config.name,
      host: config.host,
      port: config.port,
      username: config.username,
      hasPassword: this.authMethod === 'password' && !!this.password,
      hasPrivateKey: this.authMethod === 'key' && !!this.privateKey
    });
    
    // Test the connection
    console.log('Attempting SSH connection...');
    const result = await sshManager.testConnection(config);
    
    console.log('SSH connection test result:', result);
    
    // Cleanup
    await sshManager.cleanup();
    
    return result.success;
  } catch (error) {
    console.error(`SSH connection test failed for ${this.user}@${this.address}:${this.port}:`, error);
    console.error('Error details:', {
      name: error instanceof Error ? error.name : 'Unknown',
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : 'No stack trace'
    });
    return false;
  }
};

// Instance method: Return safe object without sensitive data
serverProfileSchema.methods.toSafeObject = function(this: IServerProfile) {
  const obj = this.toObject();
  delete obj.password;
  delete obj.privateKey;
  if (obj.deluge) {
    delete obj.deluge.password;
  }
  return obj;
};

// Static method: Find by name
serverProfileSchema.statics.findByName = function(name: string): Promise<IServerProfile | null> {
  return this.findOne({ name: new RegExp(`^${name}$`, 'i') });
};

// Pre-save validation
serverProfileSchema.pre('save', function(this: IServerProfile, next) {
  // Ensure either password or privateKey is provided based on authMethod
  if (this.authMethod === 'password' && !this.password) {
    next(new Error('Password is required when using password authentication'));
  } else if (this.authMethod === 'key' && !this.privateKey) {
    next(new Error('Private key is required when using key authentication'));
  } else {
    next();
  }
});

// Create and export the model
const ServerProfile = mongoose.models.ServerProfile || mongoose.model<IServerProfile, IServerProfileModel>('ServerProfile', serverProfileSchema);

export default ServerProfile;
