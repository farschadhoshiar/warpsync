/**
 * Server Analytics API Endpoint
 * Provides server-specific analytics for charts and visualizations
 */

import { NextResponse } from 'next/server';
import { withErrorHandler, createSuccessResponse } from '@/lib/errors';
import { getRequestLogger, PerformanceTimer } from '@/lib/logger/request';
import { getModels } from '@/lib/database';

export const GET = withErrorHandler(async () => {
  const logger = await getRequestLogger();
  const timer = new PerformanceTimer(logger, 'get_server_analytics');
  
  try {
    logger.info('Fetching server analytics data');
    
    // Get database models
    const { ServerProfile } = await getModels();
    
    // Get all servers with their basic info
    const servers = await ServerProfile.find().lean();
    
    // For now, we'll simulate connection status based on server data
    // In production, this would be based on actual connection tests
    const connectionStatusData = {
      connected: 0,
      disconnected: 0,
      testing: 0,
      error: 0
    };

    // Simulate connection status (in production, this would be real data)
    servers.forEach((server, index) => {
      // Simulate some logic for connection status
      const rand = (index + server.name.length) % 4;
      if (rand === 0) connectionStatusData.connected++;
      else if (rand === 1) connectionStatusData.disconnected++;
      else if (rand === 2) connectionStatusData.testing++;
      else connectionStatusData.error++;
    });

    // Server distribution by authentication method
    const authMethodDistribution = servers.reduce((acc, server) => {
      acc[server.authMethod] = (acc[server.authMethod] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    // Server usage statistics (placeholder for future implementation)
    const serverUsage = servers.map(server => ({
      name: server.name,
      address: server.address,
      jobCount: Math.floor(Math.random() * 10), // Placeholder
      lastUsed: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000).toISOString()
    }));

    const analytics = {
      connectionStatus: [
        { 
          status: 'connected', 
          count: connectionStatusData.connected, 
          fill: 'var(--color-connected)' 
        },
        { 
          status: 'disconnected', 
          count: connectionStatusData.disconnected, 
          fill: 'var(--color-disconnected)' 
        },
        { 
          status: 'testing', 
          count: connectionStatusData.testing, 
          fill: 'var(--color-testing)' 
        },
        { 
          status: 'error', 
          count: connectionStatusData.error, 
          fill: 'var(--color-error)' 
        }
      ],
      authMethods: Object.entries(authMethodDistribution).map(([method, count]) => ({
        method,
        count,
        fill: method === 'password' ? 'var(--color-password)' : 'var(--color-key)'
      })),
      serverUsage,
      summary: {
        total: servers.length,
        ...connectionStatusData
      },
      timestamp: new Date().toISOString()
    };

    timer.end({ serverCount: servers.length });

    logger.info('Server analytics retrieved successfully', {
      totalServers: servers.length,
      connected: connectionStatusData.connected,
      disconnected: connectionStatusData.disconnected
    });

    return createSuccessResponse(analytics);

  } catch (error) {
    timer.endWithError(error);
    logger.error('Failed to fetch server analytics', { error });
    throw error;
  }
});
