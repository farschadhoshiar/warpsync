import { headers } from 'next/headers';
import { logger } from './index';

// Request context interface
export interface RequestContext {
  requestId: string;
  userId?: string;
  userAgent?: string;
  ip?: string;
  method?: string;
  url?: string;
}

// Get request-scoped logger with context
export async function getRequestLogger(additionalContext?: Partial<RequestContext>) {
  try {
    const headersList = await headers();
    
    // Extract request context
    const requestId = headersList.get('x-request-id') || crypto.randomUUID();
    const userId = headersList.get('x-user-id') || undefined;
    const userAgent = headersList.get('user-agent') || undefined;
    const ip = headersList.get('x-forwarded-for') || 
              headersList.get('x-real-ip') || 
              headersList.get('x-client-ip') || 
              'unknown';
    
    const context: RequestContext = {
      requestId,
      userId,
      userAgent,
      ip,
      ...additionalContext
    };
    
    return logger.child(context);
  } catch (error) {
    // Fallback to base logger if headers are not available
    console.warn('Failed to get request headers, using base logger:', error);
    return logger.child({ requestId: crypto.randomUUID() });
  }
}

// Performance timer utility
export class PerformanceTimer {
  private startTime: number;
  private logger: any;
  private operation: string;
  
  constructor(logger: any, operation: string) {
    this.logger = logger;
    this.operation = operation;
    this.startTime = performance.now();
  }
  
  end(additionalData?: any): number {
    const duration = Math.round(performance.now() - this.startTime);
    
    this.logger.info({
      operation: this.operation,
      duration,
      ...additionalData
    }, `${this.operation} completed`);
    
    return duration;
  }
  
  getDuration(): number {
    return Math.round(performance.now() - this.startTime);
  }
  
  endWithError(error: any, additionalData?: any): number {
    const duration = Math.round(performance.now() - this.startTime);
    
    this.logger.error({
      operation: this.operation,
      duration,
      error: {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      },
      ...additionalData
    }, `${this.operation} failed`);
    
    return duration;
  }
}

// Request logging middleware helper
export async function logRequest(
  method: string, 
  url: string, 
  additionalData?: any
) {
  const requestLogger = await getRequestLogger({ method, url });
  
  requestLogger.info({
    type: 'request_start',
    method,
    url,
    timestamp: new Date().toISOString(),
    ...additionalData
  }, 'incoming request');
  
  return requestLogger;
}

// Response logging helper
export function logResponse(
  logger: any,
  method: string,
  url: string,
  statusCode: number,
  duration: number,
  additionalData?: any
) {
  const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';
  
  logger[level]({
    type: 'request_end',
    method,
    url,
    statusCode,
    duration,
    timestamp: new Date().toISOString(),
    ...additionalData
  }, `request ${statusCode >= 400 ? 'failed' : 'completed'}`);
}

// Database operation logging helper
export function logDatabaseOperation(
  logger: any,
  operation: string,
  collection: string,
  query?: any,
  result?: any,
  duration?: number
) {
  logger.info({
    type: 'database_operation',
    operation,
    collection,
    query: query ? JSON.stringify(query) : undefined,
    resultCount: Array.isArray(result) ? result.length : result ? 1 : 0,
    duration,
    timestamp: new Date().toISOString()
  }, `database ${operation} on ${collection}`);
}

// Error logging helper
export function logError(
  logger: any,
  error: any,
  context?: any
) {
  logger.error({
    type: 'error',
    error: {
      name: error instanceof Error ? error.name : 'Unknown',
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    },
    context,
    timestamp: new Date().toISOString()
  }, 'error occurred');
}

// Validation logging helper
export function logValidation(
  logger: any,
  success: boolean,
  schema: string,
  errors?: any,
  data?: any
) {
  if (success) {
    logger.debug({
      type: 'validation_success',
      schema,
      dataKeys: data ? Object.keys(data) : undefined,
      timestamp: new Date().toISOString()
    }, 'validation passed');
  } else {
    logger.warn({
      type: 'validation_error',
      schema,
      errors,
      timestamp: new Date().toISOString()
    }, 'validation failed');
  }
}

// Authentication logging helper
export function logAuth(
  logger: any,
  action: string,
  success: boolean,
  userId?: string,
  additionalData?: any
) {
  const level = success ? 'info' : 'warn';
  
  logger[level]({
    type: 'authentication',
    action,
    success,
    userId,
    timestamp: new Date().toISOString(),
    ...additionalData
  }, `authentication ${action} ${success ? 'succeeded' : 'failed'}`);
}

// Security event logging helper
export function logSecurityEvent(
  logger: any,
  event: string,
  severity: 'low' | 'medium' | 'high' | 'critical',
  additionalData?: any
) {
  const level = severity === 'critical' ? 'error' : severity === 'high' ? 'warn' : 'info';
  
  logger[level]({
    type: 'security_event',
    event,
    severity,
    timestamp: new Date().toISOString(),
    ...additionalData
  }, `security event: ${event}`);
}
