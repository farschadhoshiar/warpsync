import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createSuccessResponse, withErrorHandler, validateInput } from '@/lib/errors';
import { getModels } from '@/lib/database';
import { ServerProfileCreateSchema, ServerFilterSchema } from '@/lib/validation/schemas';

import { getRequestLogger, PerformanceTimer, logDatabaseOperation } from '@/lib/logger/request';

// GET /api/servers - List all server profiles with pagination and filtering
export const GET = withErrorHandler(async (request: NextRequest) => {
    const logger = await getRequestLogger();
    const timer = new PerformanceTimer(logger, 'list_servers');
    
    try {
      // Establish database connection and import models
      const { ServerProfile } = await getModels();
      
      // Parse and validate query parameters
      const { searchParams } = request.nextUrl;
      const queryParams = Object.fromEntries(searchParams.entries());
      const filters = validateInput<z.infer<typeof ServerFilterSchema>>(ServerFilterSchema, queryParams);
      
      logger.info({ filters }, 'listing server profiles');
      
      // Build query
      const query: Record<string, RegExp | boolean | number> = {};
      
      if (filters.name) {
        query.name = new RegExp(filters.name, 'i');
      }
      
      if (filters.address) {
        query.address = new RegExp(filters.address, 'i');
      }
      
      if (filters.enabled !== undefined) {
        // Note: This would be for future enabled/disabled functionality
        // Currently ServerProfile doesn't have an enabled field
      }
      
      // Calculate pagination
      const skip = (filters.page - 1) * filters.limit;
      
      // Execute database queries
      const dbTimer = new PerformanceTimer(logger, 'database_query');
      
      const [servers, totalCount] = await Promise.all([
        ServerProfile.find(query)
          .sort({ [filters.sortBy]: filters.sortOrder === 'asc' ? 1 : -1 })
          .skip(skip)
          .limit(filters.limit)
          .lean(),
        ServerProfile.countDocuments(query)
      ]);
      
      dbTimer.end({ query, resultCount: servers.length, totalCount });
      
      // Remove sensitive data
      const safeServers = servers.map(server => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { password, privateKey, ...safeServer } = server;
        if (safeServer.deluge) {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { password: delugePassword, ...safeDeluge } = safeServer.deluge;
          safeServer.deluge = safeDeluge;
        }
        return safeServer;
      });
      
      // Calculate pagination metadata
      const totalPages = Math.ceil(totalCount / filters.limit);
      const pagination = {
        page: filters.page,
        limit: filters.limit,
        total: totalCount,
        totalPages
      };
      
      logDatabaseOperation(logger, 'find', 'serverprofiles', query, servers, dbTimer.getDuration());
      
      timer.end({ serverCount: servers.length, pagination });
      
      return createSuccessResponse(safeServers, pagination);
      
    } catch (error) {
      timer.endWithError(error);
      throw error;
    }
});

// POST /api/servers - Create a new server profile
export const POST = withErrorHandler(async (request: NextRequest) => {
    const logger = await getRequestLogger();
    const timer = new PerformanceTimer(logger, 'create_server');
    
    try {
      // Establish database connection and import models
      const { ServerProfile } = await getModels();
      
      // Parse and validate request body
      const body = await request.json();
      const validatedData = validateInput<z.infer<typeof ServerProfileCreateSchema>>(ServerProfileCreateSchema, body);
      
      logger.info({ serverName: validatedData.name }, 'creating new server profile');
      
      // Create new server profile
      const dbTimer = new PerformanceTimer(logger, 'database_create');
      
      const serverProfile = new ServerProfile(validatedData);
      await serverProfile.save();
      
      dbTimer.end({ serverId: serverProfile._id });
      
      // Return safe version without sensitive data
      const safeServer = serverProfile.toSafeObject();
      
      logDatabaseOperation(logger, 'create', 'serverprofiles', validatedData, serverProfile);
      
      timer.end({ serverId: serverProfile._id });
      
      return createSuccessResponse(safeServer);
      
    } catch (error) {
      timer.endWithError(error);
      throw error;
    }
});

// OPTIONS /api/servers - Handle preflight requests
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Allow': 'GET, POST, OPTIONS'
    }
  });
}
