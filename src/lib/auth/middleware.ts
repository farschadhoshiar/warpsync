import { NextRequest } from 'next/server';
import { UnauthorizedError, ForbiddenError, RateLimitError } from '../errors';
import { logAuth, logSecurityEvent } from '../logger/request';

// User interface for authentication context
export interface AuthUser {
  id: string;
  role: 'admin' | 'user';
  apiKey?: string;
  sessionId?: string;
}

// Rate limiting store (in production, use Redis or similar)
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

// Simple API key validation (in production, use proper key management)
const API_KEYS = new Map([
  ['warp_dev_key_123', { userId: 'dev-user', role: 'admin' as const }],
  ['warp_user_key_456', { userId: 'test-user', role: 'user' as const }]
]);

// Authentication middleware
export async function requireAuth(request: NextRequest): Promise<AuthUser> {
  const authorization = request.headers.get('authorization');
  const sessionCookie = request.cookies.get('session');
  
  // Try API key authentication first
  if (authorization?.startsWith('Bearer ')) {
    const apiKey = authorization.slice(7);
    const keyData = API_KEYS.get(apiKey);
    
    if (keyData) {
      return {
        id: keyData.userId,
        role: keyData.role,
        apiKey
      };
    }
    
    throw new UnauthorizedError('Invalid API key');
  }
  
  // Try session authentication
  if (sessionCookie) {
    // In production, validate session with proper session store
    // For now, we'll use a simple validation
    try {
      const sessionData = JSON.parse(sessionCookie.value);
      if (sessionData.userId && sessionData.role) {
        return {
          id: sessionData.userId,
          role: sessionData.role,
          sessionId: sessionData.sessionId
        };
      }
    } catch (error) {
      // Invalid session format
    }
  }
  
  throw new UnauthorizedError('Authentication required');
}

// Optional authentication (doesn't throw if not authenticated)
export async function optionalAuth(request: NextRequest): Promise<AuthUser | null> {
  try {
    return await requireAuth(request);
  } catch (error) {
    return null;
  }
}

// Role-based authorization
export function requireRole(user: AuthUser, requiredRole: 'admin' | 'user'): void {
  if (requiredRole === 'admin' && user.role !== 'admin') {
    throw new ForbiddenError('Admin access required');
  }
  // Users can access user endpoints, admins can access everything
}

// Rate limiting middleware
export async function checkRateLimit(
  request: NextRequest, 
  identifier?: string,
  limit: number = 100,
  windowMs: number = 15 * 60 * 1000 // 15 minutes
): Promise<void> {
  const key = identifier || 
              request.headers.get('x-forwarded-for') || 
              request.headers.get('x-real-ip') || 
              'unknown';
  
  const now = Date.now();
  const windowStart = now - windowMs;
  
  const current = rateLimitStore.get(key);
  
  if (!current || current.resetTime < windowStart) {
    // Reset or initialize the counter
    rateLimitStore.set(key, { count: 1, resetTime: now + windowMs });
    return;
  }
  
  if (current.count >= limit) {
    throw new RateLimitError(`Rate limit exceeded. Try again in ${Math.ceil((current.resetTime - now) / 1000)} seconds`);
  }
  
  // Increment counter
  current.count++;
  rateLimitStore.set(key, current);
}

// CORS headers helper
export function getCorsHeaders(origin?: string): Record<string, string> {
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3001'];
  const isAllowed = !origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin);
  
  return {
    'Access-Control-Allow-Origin': isAllowed ? (origin || '*') : 'null',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400' // 24 hours
  };
}

// Security headers helper
export function getSecurityHeaders(): Record<string, string> {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy': "default-src 'self'",
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=()'
  };
}

// Input sanitization helper
export function sanitizeInput(input: any): any {
  if (typeof input === 'string') {
    // Basic XSS prevention
    return input
      .replace(/[<>]/g, '') // Remove angle brackets
      .trim()
      .slice(0, 10000); // Limit length
  }
  
  if (Array.isArray(input)) {
    return input.map(sanitizeInput);
  }
  
  if (input && typeof input === 'object') {
    const sanitized: any = {};
    for (const [key, value] of Object.entries(input)) {
      sanitized[key] = sanitizeInput(value);
    }
    return sanitized;
  }
  
  return input;
}

// Request validation helper
export function validateRequestMethod(
  request: NextRequest, 
  allowedMethods: string[]
): void {
  if (!allowedMethods.includes(request.method)) {
    throw new Error(`Method ${request.method} not allowed`);
  }
}

// IP extraction helper
export function getClientIP(request: NextRequest): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0] ||
         request.headers.get('x-real-ip') ||
         request.headers.get('x-client-ip') ||
         'unknown';
}

// User agent extraction helper
export function getUserAgent(request: NextRequest): string {
  return request.headers.get('user-agent') || 'unknown';
}

// Request size validation
export function validateRequestSize(
  request: NextRequest,
  maxSizeBytes: number = 10 * 1024 * 1024 // 10MB default
): void {
  const contentLength = request.headers.get('content-length');
  if (contentLength && parseInt(contentLength) > maxSizeBytes) {
    throw new Error(`Request too large. Maximum size: ${maxSizeBytes} bytes`);
  }
}

// Authentication wrapper for route handlers
export function withAuth(
  handler: (request: NextRequest, user: AuthUser, ...args: any[]) => Promise<Response>,
  requiredRole?: 'admin' | 'user'
) {
  return async (request: NextRequest, ...args: any[]): Promise<Response> => {
    try {
      const user = await requireAuth(request);
      
      if (requiredRole) {
        requireRole(user, requiredRole);
      }
      
      return await handler(request, user, ...args);
    } catch (error) {
      throw error; // Will be handled by error handler
    }
  };
}

// Optional auth wrapper for route handlers
export function withOptionalAuth(
  handler: (request: NextRequest, user: AuthUser | null, ...args: any[]) => Promise<Response>
) {
  return async (request: NextRequest, ...args: any[]): Promise<Response> => {
    const user = await optionalAuth(request);
    return await handler(request, user, ...args);
  };
}

// Rate limiting wrapper for route handlers
export function withRateLimit(
  handler: (request: NextRequest, ...args: any[]) => Promise<Response>,
  limit: number = 100,
  windowMs: number = 15 * 60 * 1000
) {
  return async (request: NextRequest, ...args: any[]): Promise<Response> => {
    await checkRateLimit(request, undefined, limit, windowMs);
    return await handler(request, ...args);
  };
}

// Combined middleware wrapper
export function withMiddleware(
  handler: (request: NextRequest, user?: AuthUser, ...args: any[]) => Promise<Response>,
  options: {
    auth?: 'required' | 'optional' | 'none';
    role?: 'admin' | 'user';
    rateLimit?: { limit: number; windowMs: number };
    validateSize?: number;
  } = {}
) {
  return async (request: NextRequest, ...args: any[]): Promise<Response> => {
    // Validate request size
    if (options.validateSize) {
      validateRequestSize(request, options.validateSize);
    }
    
    // Apply rate limiting
    if (options.rateLimit) {
      await checkRateLimit(request, undefined, options.rateLimit.limit, options.rateLimit.windowMs);
    }
    
    // Handle authentication
    let user: AuthUser | undefined;
    
    if (options.auth === 'required') {
      user = await requireAuth(request);
      if (options.role) {
        requireRole(user, options.role);
      }
    } else if (options.auth === 'optional') {
      user = await optionalAuth(request) || undefined;
    }
    
    return await handler(request, user, ...args);
  };
}
