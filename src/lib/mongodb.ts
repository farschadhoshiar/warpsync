import mongoose from 'mongoose';
import { databaseConfig, validateDatabaseConfig } from '@/config/database';

// Validate configuration on import
validateDatabaseConfig();

declare global {
  var mongoose: {
    conn: typeof import('mongoose') | null;
    promise: Promise<typeof import('mongoose')> | null;
  } | undefined;
}

const MONGODB_URI = databaseConfig.uri;

if (!MONGODB_URI) {
  throw new Error('Please define the MONGODB_URI environment variable inside .env.local');
}

let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

// Connection event handlers (only set up once)
let eventsSetup = false;

function setupConnectionEvents() {
  if (eventsSetup) return;
  
  // Set max listeners to prevent memory leak warnings
  mongoose.connection.setMaxListeners(databaseConfig.maxListeners);
  
  // Use 'once' for one-time connection events to prevent accumulation
  mongoose.connection.once('connected', () => {
    console.log('✅ Mongoose connected to MongoDB');
  });

  mongoose.connection.on('error', (err) => {
    console.error('❌ Mongoose connection error:', err);
  });

  mongoose.connection.on('disconnected', () => {
    console.log('🔌 Mongoose disconnected from MongoDB');
  });

  // Add connection monitoring
  mongoose.connection.on('reconnected', () => {
    console.log('🔄 Mongoose reconnected to MongoDB');
  });

  mongoose.connection.on('reconnectFailed', () => {
    console.error('❌ Mongoose reconnection failed');
  });
  
  eventsSetup = true;
}

// Graceful shutdown handling with improved cleanup
const gracefulShutdown = async () => {
  try {
    if (mongoose.connection.readyState === 1) {
      console.log('🔄 Closing MongoDB connection...');
      await mongoose.connection.close();
      console.log('🔌 MongoDB connection closed through app termination');
    }
  } catch (error) {
    console.error('❌ Error closing MongoDB connection:', error);
  }
};

process.on('SIGINT', async () => {
  await gracefulShutdown();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await gracefulShutdown();
  process.exit(0);
});

// Handle uncaught exceptions and unhandled rejections
process.on('uncaughtException', async (error) => {
  console.error('❌ Uncaught Exception:', error);
  await gracefulShutdown();
  process.exit(1);
});

process.on('unhandledRejection', async (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  await gracefulShutdown();
  process.exit(1);
});

async function connectDB() {
  if (cached?.conn) {
    return cached.conn;
  }

  if (!cached?.promise) {
    setupConnectionEvents();
    
    const opts = databaseConfig.options;

    cached!.promise = mongoose.connect(MONGODB_URI, opts).then(async () => {
      console.log('✅ Connected to MongoDB');
      console.log(`📊 Connection pool: max=${opts.maxPoolSize}, min=${opts.minPoolSize}`);
      
      // Import and register models on connection
      try {
        await import('../models/ServerProfile');
        await import('../models/SyncJob');
        await import('../models/FileState');
        console.log('📋 All models registered successfully');
      } catch (modelError) {
        console.warn('⚠️ Error registering models:', modelError);
      }
      
      cached!.conn = mongoose;
      return mongoose;
    }).catch((error) => {
      console.error('❌ MongoDB connection failed:', error);
      cached!.promise = null; // Reset promise on failure
      throw error;
    });
  }

  try {
    cached!.conn = await cached!.promise;
    return cached!.conn;
  } catch (e) {
    cached!.promise = null;
    console.error('❌ MongoDB connection error:', e);
    throw e;
  }

  return cached!.conn;
}

export default connectDB;

// Test connection function
export async function testConnection(): Promise<boolean> {
  try {
    await connectDB();
    return true;
  } catch (error) {
    console.error('Database connection test failed:', error);
    return false;
  }
}
