/**
 * Database Configuration
 * Centralized configuration for MongoDB connection settings
 */

export interface DatabaseConfig {
  uri: string;
  options: {
    bufferCommands: boolean;
    maxPoolSize: number;
    minPoolSize: number;
    serverSelectionTimeoutMS: number;
    socketTimeoutMS: number;
    connectTimeoutMS: number;
    heartbeatFrequencyMS: number;
    maxIdleTimeMS: number;
    retryWrites: boolean;
    retryReads: boolean;
    family: number;
  };
  maxListeners: number;
  healthCheck: {
    enabled: boolean;
    interval: number; // milliseconds
    timeout: number; // milliseconds
  };
  retry: {
    attempts: number;
    delay: number; // milliseconds
    backoffFactor: number;
  };
}

const isProduction = process.env.NODE_ENV === 'production';

export const databaseConfig: DatabaseConfig = {
  uri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/warpsync',
  
  options: {
    bufferCommands: false,
    maxPoolSize: isProduction ? 100 : 50, // Higher pool size in production
    minPoolSize: isProduction ? 10 : 5,   // Higher minimum in production
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 30000,
    connectTimeoutMS: 10000,
    heartbeatFrequencyMS: isProduction ? 10000 : 15000, // More frequent in production
    maxIdleTimeMS: 30000,
    retryWrites: true,
    retryReads: true,
    family: 4
  },
  
  maxListeners: 20, // Prevent EventEmitter memory leak warnings
  
  healthCheck: {
    enabled: true,
    interval: isProduction ? 30000 : 60000, // More frequent checks in production
    timeout: 5000
  },
  
  retry: {
    attempts: 3,
    delay: 1000,
    backoffFactor: 2
  }
};

/**
 * Get database configuration for current environment
 */
export function getDatabaseConfig(): DatabaseConfig {
  return databaseConfig;
}

/**
 * Validate database configuration
 */
export function validateDatabaseConfig(): void {
  if (!databaseConfig.uri) {
    throw new Error('MONGODB_URI environment variable is required');
  }
  
  if (databaseConfig.options.maxPoolSize < databaseConfig.options.minPoolSize) {
    throw new Error('maxPoolSize cannot be less than minPoolSize');
  }
  
  if (databaseConfig.options.serverSelectionTimeoutMS < 1000) {
    throw new Error('serverSelectionTimeoutMS should be at least 1000ms');
  }
}
