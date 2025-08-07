/**
 * Database connection optimization utilities
 * Provides a reusable pattern for API routes to manage database connections efficiently
 */

import connectDB from './mongodb';

/**
 * Higher-order function that ensures database connection and model imports
 * Reduces redundant connection calls and standardizes the pattern
 */
export async function withDatabase<T>(
  operation: () => Promise<T>
): Promise<T> {
  // Ensure database connection is established
  await connectDB();
  
  // Import models after connection to ensure they're registered
  await import('../models');
  
  // Execute the operation
  return operation();
}

/**
 * Type-safe model getter that ensures models are imported
 */
export async function getModels() {
  // Ensure database connection and model registration
  await connectDB();
  return import('../models');
}
