import pino from 'pino';

// Create transport conditionally to avoid worker thread issues in Next.js
let transport;

// Only use pino-pretty transport in pure Node.js environment (not Next.js)
if (process.env.NODE_ENV === 'development' && !process.env.NEXT_RUNTIME) {
  try {
    transport = pino.transport({
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'UTC:yyyy-mm-dd HH:MM:ss.l o',
        ignore: 'pid,hostname',
        singleLine: false,
        hideObject: false
      }
    });
  } catch (error) {
    // Fallback to stdout if transport fails
    transport = process.stdout;
  }
} else {
  // Use stdout for Next.js runtime to avoid worker thread issues
  transport = process.stdout;
}

// Base logger configuration
export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  
  // Base fields included in all logs
  base: {
    env: process.env.NODE_ENV || 'development',
    service: process.env.SERVICE_NAME || 'warpsync-api',
    version: process.env.npm_package_version || '1.0.0'
  },
  
  // Serializers for common objects
  serializers: {
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
    err: pino.stdSerializers.err,
    error: pino.stdSerializers.err
  },
  
  // Custom formatters
  formatters: {
    level(label) {
      return { level: label };
    },
    bindings(bindings) {
      return {
        pid: bindings.pid,
        hostname: bindings.hostname,
        service: bindings.service,
        env: bindings.env,
        version: bindings.version
      };
    }
  },
  
  // Redact sensitive information
  redact: {
    paths: [
      'password',
      'privateKey',
      'deluge.password',
      'authorization',
      'cookie'
    ],
    censor: '[REDACTED]'
  }
}, transport);

// Log levels for reference
export const LogLevel = {
  TRACE: 10,
  DEBUG: 20,
  INFO: 30,
  WARN: 40,
  ERROR: 50,
  FATAL: 60
} as const;

// Helper functions for common logging patterns
export const loggers = {
  // Request logging
  request: (method: string, url: string, additionalData: any = {}) => {
    logger.info({
      type: 'request',
      method,
      url,
      ...additionalData
    }, 'incoming request');
  },
  
  // Response logging
  response: (method: string, url: string, statusCode: number, duration: number, additionalData: any = {}) => {
    logger.info({
      type: 'response',
      method,
      url,
      statusCode,
      duration,
      ...additionalData
    }, 'request completed');
  },
  
  // Database operation logging
  database: (operation: string, collection: string, duration?: number, additionalData: any = {}) => {
    logger.info({
      type: 'database',
      operation,
      collection,
      duration,
      ...additionalData
    }, `database ${operation}`);
  },
  
  // Authentication logging
  auth: (action: string, userId?: string, additionalData: any = {}) => {
    logger.info({
      type: 'auth',
      action,
      userId,
      ...additionalData
    }, `authentication ${action}`);
  },
  
  // Performance logging
  performance: (operation: string, duration: number, additionalData: any = {}) => {
    const level = duration > 1000 ? 'warn' : 'info';
    logger[level]({
      type: 'performance',
      operation,
      duration,
      ...additionalData
    }, `performance metric`);
  },
  
  // Security logging
  security: (event: string, severity: 'low' | 'medium' | 'high' | 'critical', additionalData: any = {}) => {
    const level = severity === 'critical' ? 'error' : severity === 'high' ? 'warn' : 'info';
    logger[level]({
      type: 'security',
      event,
      severity,
      ...additionalData
    }, `security event: ${event}`);
  },
  
  // Validation logging
  validation: (type: 'success' | 'error', schema: string, additionalData: any = {}) => {
    if (type === 'error') {
      logger.warn({
        type: 'validation',
        result: type,
        schema,
        ...additionalData
      }, 'validation failed');
    } else {
      logger.debug({
        type: 'validation',
        result: type,
        schema,
        ...additionalData
      }, 'validation passed');
    }
  }
};

// Export the main logger
export default logger;
