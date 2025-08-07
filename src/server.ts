import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';
import { Server as SocketIOServer } from 'socket.io';
import { logger } from '@/lib/logger';
import { setupSocketHandlers } from '@/lib/websocket/manager';
import { authenticateSocket } from '@/lib/websocket/middleware';

const dev = process.env.NODE_ENV !== 'production';
const hostname = process.env.HOSTNAME || 'localhost';
const port = parseInt(process.env.PORT || '3000', 10);

// Initialize Next.js app
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

async function startServer() {
  try {
    await app.prepare();
    
    // Create HTTP server
    const server = createServer(async (req, res) => {
      const parsedUrl = parse(req.url!, true);
      await handle(req, res, parsedUrl);
    });
    
    // Initialize Socket.IO
    const io = new SocketIOServer(server, {
      cors: {
        origin: process.env.CORS_ORIGIN || "http://localhost:3000",
        methods: ["GET", "POST"],
        credentials: true
      },
      pingTimeout: 60000,
      pingInterval: 25000
    });
    
    // Setup Socket.IO admin UI in development
    if (dev) {
      try {
        const { instrument } = await import('@socket.io/admin-ui');
        instrument(io, {
          auth: false, // Disable auth for development
          mode: "development"
        });
        logger.info('Socket.IO Admin UI available at http://localhost:3000/admin');
      } catch (error) {
        logger.warn('Failed to setup Socket.IO Admin UI', { error });
      }
    }
    
    // Authentication middleware
    io.use(authenticateSocket);
    
    // Setup event handlers
    setupSocketHandlers(io);
    
    // Make io available globally for API routes
    global.io = io;
    
    // Start server
    server.listen(port, () => {
      logger.info(`Server ready on http://${hostname}:${port}`);
    });
    
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
