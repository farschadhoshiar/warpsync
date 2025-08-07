import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

// Custom error classes
export class ValidationError extends Error {
  public details: any;
  
  constructor(message: string, details?: any) {
    super(message);
    this.name = 'ValidationError';
    this.details = details;
  }
}

export class NotFoundError extends Error {
  constructor(message: string = 'Resource not found') {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends Error {
  constructor(message: string = 'Resource already exists') {
    super(message);
    this.name = 'ConflictError';
  }
}

export class UnauthorizedError extends Error {
  constructor(message: string = 'Unauthorized access') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends Error {
  constructor(message: string = 'Access forbidden') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

export class ConnectionError extends Error {
  constructor(message: string = 'Connection failed') {
    super(message);
    this.name = 'ConnectionError';
  }
}

export class RateLimitError extends Error {
  constructor(message: string = 'Rate limit exceeded') {
    super(message);
    this.name = 'RateLimitError';
  }
}

// API Error response interface
export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: any;
  };
  timestamp: string;
}

// API Success response interface
export interface ApiSuccessResponse<T = any> {
  success: true;
  data: T;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  timestamp: string;
}

// Error handler function
export function handleApiError(error: unknown): NextResponse<ApiErrorResponse> {
  console.error('API Error:', error);
  
  const timestamp = new Date().toISOString();
  
  // Handle Zod validation errors
  if (error instanceof ZodError) {
    return NextResponse.json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: error.errors.map(err => ({
          field: err.path.join('.'),
          message: err.message,
          value: err.input
        }))
      },
      timestamp
    }, { status: 400 });
  }
  
  // Handle custom validation errors
  if (error instanceof ValidationError) {
    return NextResponse.json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: error.message,
        details: error.details
      },
      timestamp
    }, { status: 400 });
  }
  
  // Handle not found errors
  if (error instanceof NotFoundError) {
    return NextResponse.json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: error.message
      },
      timestamp
    }, { status: 404 });
  }
  
  // Handle conflict errors
  if (error instanceof ConflictError) {
    return NextResponse.json({
      success: false,
      error: {
        code: 'CONFLICT',
        message: error.message
      },
      timestamp
    }, { status: 409 });
  }
  
  // Handle unauthorized errors
  if (error instanceof UnauthorizedError) {
    return NextResponse.json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: error.message
      },
      timestamp
    }, { status: 401 });
  }
  
  // Handle forbidden errors
  if (error instanceof ForbiddenError) {
    return NextResponse.json({
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: error.message
      },
      timestamp
    }, { status: 403 });
  }
  
  // Handle connection errors
  if (error instanceof ConnectionError) {
    return NextResponse.json({
      success: false,
      error: {
        code: 'CONNECTION_ERROR',
        message: error.message
      },
      timestamp
    }, { status: 502 });
  }
  
  // Handle rate limit errors
  if (error instanceof RateLimitError) {
    return NextResponse.json({
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: error.message
      },
      timestamp
    }, { status: 429 });
  }
  
  // Handle MongoDB errors
  if (error && typeof error === 'object' && 'code' in error) {
    const mongoError = error as { code: number; message: string; keyPattern?: any };
    
    // Duplicate key error
    if (mongoError.code === 11000) {
      const field = mongoError.keyPattern ? Object.keys(mongoError.keyPattern)[0] : 'field';
      return NextResponse.json({
        success: false,
        error: {
          code: 'DUPLICATE_KEY',
          message: `A record with this ${field} already exists`,
          details: { field, keyPattern: mongoError.keyPattern }
        },
        timestamp
      }, { status: 409 });
    }
  }
  
  // Handle generic errors
  if (error instanceof Error) {
    return NextResponse.json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      },
      timestamp
    }, { status: 500 });
  }
  
  // Fallback for unknown errors
  return NextResponse.json({
    success: false,
    error: {
      code: 'UNKNOWN_ERROR',
      message: 'An unknown error occurred'
    },
    timestamp
  }, { status: 500 });
}

// Success response helper
export function createSuccessResponse<T>(
  data: T, 
  pagination?: { page: number; limit: number; total: number; totalPages: number }
): NextResponse<ApiSuccessResponse<T>> {
  return NextResponse.json({
    success: true,
    data,
    pagination,
    timestamp: new Date().toISOString()
  });
}

// Async error wrapper for route handlers
export function withErrorHandler<T extends any[], R>(
  handler: (...args: T) => Promise<R>
) {
  return async (...args: T): Promise<R | NextResponse<ApiErrorResponse>> => {
    try {
      return await handler(...args);
    } catch (error) {
      return handleApiError(error);
    }
  };
}

// Validation helper
export function validateInput<T>(schema: any, input: unknown): T {
  try {
    return schema.parse(input);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new ValidationError('Validation failed', error.errors);
    }
    throw error;
  }
}

// Database error helper
export function handleDatabaseError(error: any): never {
  if (error.code === 11000) {
    const field = error.keyPattern ? Object.keys(error.keyPattern)[0] : 'field';
    throw new ConflictError(`A record with this ${field} already exists`);
  }
  
  if (error.name === 'CastError') {
    throw new ValidationError('Invalid ID format');
  }
  
  if (error.name === 'ValidationError') {
    const details = Object.values(error.errors).map((err: any) => ({
      field: err.path,
      message: err.message
    }));
    throw new ValidationError('Database validation failed', details);
  }
  
  throw error;
}
