import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getCorsHeaders, getSecurityHeaders } from './src/lib/auth/middleware';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  
  // Generate unique request ID for tracking
  const requestId = crypto.randomUUID();
  
  // Create response
  const response = NextResponse.next();
  
  // Add request ID to headers for logging
  response.headers.set('x-request-id', requestId);
  
  // Add security headers
  const securityHeaders = getSecurityHeaders();
  Object.entries(securityHeaders).forEach(([key, value]) => {
    response.headers.set(key, value);
  });
  
  // Handle CORS for API routes
  if (pathname.startsWith('/api/')) {
    const origin = request.headers.get('origin');
    const corsHeaders = getCorsHeaders(origin || undefined);
    
    Object.entries(corsHeaders).forEach(([key, value]) => {
      response.headers.set(key, value);
    });
    
    // Handle preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }
  }
  
  // Add user ID to headers if available (for request logging)
  const authorization = request.headers.get('authorization');
  if (authorization?.startsWith('Bearer ')) {
    // Simple API key to user ID mapping for logging
    const apiKeyToUserId: Record<string, string> = {
      'warp_dev_key_123': 'dev-user',
      'warp_user_key_456': 'test-user'
    };
    
    const apiKey = authorization.slice(7);
    const userId = apiKeyToUserId[apiKey];
    
    if (userId) {
      response.headers.set('x-user-id', userId);
    }
  }
  
  return response;
}

// Configure which routes the middleware should run on
export const config = {
  matcher: [
    // Match API routes
    '/api/:path*',
    // Match all routes except static files and images
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'
  ]
};
