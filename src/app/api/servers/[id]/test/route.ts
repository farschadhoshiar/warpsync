import { NextRequest, NextResponse } from 'next/server';
import { ServerProfile } from '@/models';
import { handleApiError, createSuccessResponse, withErrorHandler, validateInput, NotFoundError, ConnectionError } from '@/lib/errors';
import { ConnectionTestSchema } from '@/lib/validation/schemas';

import { getRequestLogger, PerformanceTimer, logDatabaseOperation } from '@/lib/logger/request';

// POST /api/servers/[id]/test - Test SSH connection to server
export const POST = withErrorHandler(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const logger = await getRequestLogger();
    const timer = new PerformanceTimer(logger, 'test_server_connection');
    
    try {
      const { id } = await params;
      
      // Parse and validate request body (optional timeout parameter)
      const body = await request.json().catch(() => ({}));
      const validatedData = validateInput(ConnectionTestSchema, body);
      const { timeout } = validatedData;
      
      logger.info({ serverId: id, timeout }, 'testing server connection');
      
      // Find server profile
      const dbTimer = new PerformanceTimer(logger, 'database_findById');
      
      const serverProfile = await ServerProfile.findById(id);
      
      dbTimer.end({ serverId: id, found: !!serverProfile });
      
      if (!serverProfile) {
        throw new NotFoundError('Server profile not found');
      }
      
      // Test connection using the server profile's testConnection method
      const connectionTimer = new PerformanceTimer(logger, 'ssh_connection_test');
      
      try {
        // Note: The actual SSH connection test would be implemented here
        // For now, we'll use the model's testConnection method which is a placeholder
        const isConnected = await serverProfile.testConnection();
        
        const connectionDuration = connectionTimer.end({ 
          serverId: id,
          success: isConnected,
          serverAddress: serverProfile.address,
          serverPort: serverProfile.port
        });
        
        if (!isConnected) {
          throw new ConnectionError('Failed to establish SSH connection');
        }
        
        // Log successful connection test
        logger.info({
          serverId: id,
          serverName: serverProfile.name,
          serverAddress: serverProfile.address,
          serverPort: serverProfile.port,
          authMethod: serverProfile.authMethod,
          duration: connectionDuration
        }, 'connection test successful');
        
        timer.end({ serverId: id, success: true, duration: connectionDuration });
        
        return createSuccessResponse({
          connected: true,
          serverName: serverProfile.name,
          serverAddress: serverProfile.address,
          serverPort: serverProfile.port,
          authMethod: serverProfile.authMethod,
          duration: connectionDuration,
          timestamp: new Date().toISOString(),
          message: 'SSH connection successful'
        });
        
      } catch (connectionError) {
        const connectionDuration = connectionTimer.endWithError(connectionError, {
          serverId: id,
          serverAddress: serverProfile.address,
          serverPort: serverProfile.port
        });
        
        // Log failed connection test
        logger.warn({
          serverId: id,
          serverName: serverProfile.name,
          serverAddress: serverProfile.address,
          serverPort: serverProfile.port,
          authMethod: serverProfile.authMethod,
          duration: connectionDuration,
          error: connectionError instanceof Error ? connectionError.message : 'Unknown error'
        }, 'connection test failed');
        
        timer.end({ serverId: id, success: false, duration: connectionDuration });
        
        return createSuccessResponse({
          connected: false,
          serverName: serverProfile.name,
          serverAddress: serverProfile.address,
          serverPort: serverProfile.port,
          authMethod: serverProfile.authMethod,
          duration: connectionDuration,
          timestamp: new Date().toISOString(),
          error: connectionError instanceof Error ? connectionError.message : 'Connection failed',
          message: 'SSH connection failed'
        });
      }
      
    } catch (error) {
      timer.endWithError(error);
      throw error;
    }
});

// OPTIONS /api/servers/[id]/test - Handle preflight requests
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Allow': 'POST, OPTIONS'
    }
  });
}
