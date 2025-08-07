import mongoose from 'mongoose';

declare global {
  var mongoose: {
    conn: typeof mongoose | null;
    promise: Promise<typeof mongoose> | null;
  } | undefined;
}

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/warpsync';

if (!MONGODB_URI) {
  throw new Error('Please define the MONGODB_URI environment variable inside .env.local');
}

console.log('🔍 Attempting to connect to MongoDB with URI:', MONGODB_URI.replace(/\/\/.*@/, '//***:***@')); // Log URI without credentials

let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

// Connection event handlers
mongoose.connection.on('connected', () => {
  console.log('✅ Mongoose connected to MongoDB');
});

mongoose.connection.on('error', (err) => {
  console.error('❌ Mongoose connection error:', err);
});

mongoose.connection.on('disconnected', () => {
  console.log('🔌 Mongoose disconnected from MongoDB');
});

// Graceful shutdown handling
process.on('SIGINT', async () => {
  try {
    await mongoose.connection.close();
    console.log('🔌 MongoDB connection closed through app termination');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error closing MongoDB connection:', error);
    process.exit(1);
  }
});

async function connectDB() {
  if (cached?.conn) {
    return cached.conn;
  }

  if (!cached?.promise) {
    const opts = {
      bufferCommands: false,
      maxPoolSize: 10, // Maintain up to 10 socket connections
      serverSelectionTimeoutMS: 5000, // Keep trying to send operations for 5 seconds
      socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
      family: 4 // Use IPv4, skip trying IPv6
    };

    cached!.promise = mongoose.connect(MONGODB_URI, opts).then(async (mongooseInstance) => {
      console.log('✅ Connected to MongoDB');
      
      // Import and register models on connection
      try {
        await import('../models/ServerProfile');
        await import('../models/SyncJob');
        await import('../models/FileState');
        console.log('📋 All models registered successfully');
      } catch (modelError) {
        console.warn('⚠️ Error registering models:', modelError);
      }
      
      return cached;
    });
  }

  try {
    cached!.conn = await cached!.promise;
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
