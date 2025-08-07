import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import { createSuccessResponse, withErrorHandler, validateInput, NotFoundError, ConnectionError } from '@/lib/errors';
import { ConnectionTestSchema } from '@/lib/validation/schemas';

import { getRequestLogger, PerformanceTimer } from '@/lib/logger/request';

// POST /api/servers/[id]/test - Test SSH connection to server
export const POST = withErrorHandler(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const logger = await getRequestLogger();
    const timer = new PerformanceTimer(logger, 'test_server_connection');
    
    try {
      const { id } = await params;
      
      // Parse and validate request body (optional timeout parameter)
      const body = await request.json().catch(() => ({}));
      const validatedData = validateInput(ConnectionTestSchema, body);
      const { timeout } = validatedData as { timeout?: number };
      
      logger.info({ serverId: id, timeout }, 'testing server connection');
      
      // Connect to database
      await connectDB();
      const { ServerProfile } = await import('@/models');
      
      // Find server profile
      const dbTimer = new PerformanceTimer(logger, 'database_findById');
      
      const serverProfile = await ServerProfile.findById(id);
      
      dbTimer.end({ serverId: id, found: !!serverProfile });
      
      if (!serverProfile) {
        throw new NotFoundError('Server profile not found');
      }
      
      // Test connection using the real SSH connection manager
      const connectionTimer = new PerformanceTimer(logger, 'ssh_connection_test');
      
      try {
        // Import SSH connection manager
        const { SSHConnectionManager } = await import('@/lib/ssh/ssh-connection');
        
        // Build SSH configuration from server profile
        const sshConfig = {
          id: `test-${id}`,
          name: `Test connection for ${serverProfile.name}`,
          host: serverProfile.address,
          port: serverProfile.port,
          username: serverProfile.user,
          ...(serverProfile.authMethod === 'password' 
            ? { password: serverProfile.password }
            : { privateKey: serverProfile.privateKey }
          )
        };

        logger.debug('=== SSH Connection Test Debug ===', {
          serverId: id,
          host: sshConfig.host,
          port: sshConfig.port,
          username: sshConfig.username,
          authMethod: serverProfile.authMethod,
          hasPassword: serverProfile.authMethod === 'password' && !!serverProfile.password,
          hasPrivateKey: serverProfile.authMethod === 'key' && !!serverProfile.privateKey
        });

        // Get SSH manager instance and test connection
        const sshManager = SSHConnectionManager.getInstance();
        const connectionResult = await sshManager.testConnection(sshConfig);
        
        const connectionDuration = connectionTimer.end({ 
          serverId: id,
          success: connectionResult.success,
          serverAddress: serverProfile.address,
          serverPort: serverProfile.port,
          connectionTime: connectionResult.details.connectionTime,
          serverInfo: connectionResult.details.serverInfo,
          homeDirectory: connectionResult.details.homeDirectory
        });
        
        if (!connectionResult.success) {
          throw new ConnectionError(connectionResult.message);
        }
        
        // Log successful connection test
        logger.info({
          serverId: id,
          serverName: serverProfile.name,
          serverAddress: serverProfile.address,
          serverPort: serverProfile.port,
          authMethod: serverProfile.authMethod,
          duration: connectionDuration,
          serverInfo: connectionResult.details.serverInfo,
          homeDirectory: connectionResult.details.homeDirectory,
          permissions: connectionResult.details.permissions
        }, 'connection test successful');
        
        timer.end({ serverId: id, success: true, duration: connectionDuration });
        
        return createSuccessResponse({
          connected: true,
          serverName: serverProfile.name,
          serverAddress: serverProfile.address,
          serverPort: serverProfile.port,
          authMethod: serverProfile.authMethod,
          duration: connectionDuration,
          connectionTime: connectionResult.details.connectionTime,
          serverInfo: connectionResult.details.serverInfo,
          homeDirectory: connectionResult.details.homeDirectory,
          permissions: connectionResult.details.permissions,
          timestamp: new Date().toISOString(),
          message: connectionResult.message
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
          connectionTime: 0,
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
