import { Client } from 'ssh2';
import { logger } from '@/lib/logger';
import { 
  SSHConnectionConfig, 
  ConnectionStatus, 
  ConnectionStats, 
  SSHPoolConfiguration, 
  DEFAULT_SSH_POOL_CONFIG
} from './types';

interface PooledConnection {
  id: string;
  connection: Client;
  config: SSHConnectionConfig;
  status: ConnectionStatus;
  stats: ConnectionStats;
  createdAt: Date;
  lastUsed: Date;
  inUse: boolean;
}

export class SSHConnectionPool {
  private connections = new Map<string, PooledConnection>();
  private config: SSHPoolConfiguration;
  private healthCheckTimer?: NodeJS.Timeout;

  constructor(config: Partial<SSHPoolConfiguration> = {}) {
    this.config = { ...DEFAULT_SSH_POOL_CONFIG, ...config };
    this.startHealthCheck();
  }

  async getConnection(connectionConfig: SSHConnectionConfig): Promise<PooledConnection> {
    const poolKey = this.getPoolKey(connectionConfig);
    
    // Try to reuse existing connection
    const existing = this.findAvailableConnection(poolKey);
    if (existing && this.isConnectionHealthy(existing)) {
      existing.inUse = true;
      existing.lastUsed = new Date();
      logger.debug('Reusing existing SSH connection', {
        connectionId: existing.id,
        poolKey
      });
      return existing;
    }

    // Check connection limits
    if (this.connections.size >= this.config.maxConnections) {
      await this.cleanupIdleConnections();
      
      if (this.connections.size >= this.config.maxConnections) {
        throw new Error('SSH connection pool limit reached');
      }
    }

    // Create new connection
    return await this.createConnection(connectionConfig);
  }

  releaseConnection(connectionId: string): void {
    const connection = this.connections.get(connectionId);
    if (connection) {
      connection.inUse = false;
      connection.lastUsed = new Date();
      logger.debug('Released SSH connection back to pool', {
        connectionId
      });
    }
  }

  async closeConnection(connectionId: string): Promise<void> {
    const connection = this.connections.get(connectionId);
    if (connection) {
      try {
        connection.connection.end();
        this.connections.delete(connectionId);
        logger.debug('Closed SSH connection', {
          connectionId
        });
      } catch (error) {
        logger.error('Error closing SSH connection', {
          connectionId,
          error
        });
      }
    }
  }

  async closeAllConnections(): Promise<void> {
    const closePromises = Array.from(this.connections.keys()).map(id => 
      this.closeConnection(id)
    );
    await Promise.all(closePromises);
    
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }
  }

  getConnectionStats(): { total: number; inUse: number; available: number } {
    const total = this.connections.size;
    const inUse = Array.from(this.connections.values()).filter(c => c.inUse).length;
    return {
      total,
      inUse,
      available: total - inUse
    };
  }

  getConnectionById(connectionId: string): PooledConnection | null {
    return this.connections.get(connectionId) || null;
  }

  private getPoolKey(config: SSHConnectionConfig): string {
    return `${config.host}:${config.port || 22}:${config.username}`;
  }

  private findAvailableConnection(poolKey: string): PooledConnection | undefined {
    return Array.from(this.connections.values()).find(conn => 
      !conn.inUse && 
      this.getPoolKey(conn.config) === poolKey &&
      conn.status === ConnectionStatus.CONNECTED
    );
  }

  private isConnectionHealthy(connection: PooledConnection): boolean {
    const now = new Date();
    const ageMs = now.getTime() - connection.createdAt.getTime();
    const idleMs = now.getTime() - connection.lastUsed.getTime();

    return (
      connection.status === ConnectionStatus.CONNECTED &&
      ageMs < this.config.connectionTTL &&
      idleMs < this.config.idleTimeout
    );
  }

  private async createConnection(config: SSHConnectionConfig): Promise<PooledConnection> {
    const connectionId = `ssh_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const connection = new Client();
    
    console.log(`=== Creating SSH Connection ${connectionId} ===`);
    console.log('Connection config:', {
      host: config.host,
      port: config.port,
      username: config.username,
      hasPassword: !!config.password,
      hasPrivateKey: !!config.privateKey,
      connectionTimeout: config.connectionTimeout || 30000
    });
    
    const pooledConnection: PooledConnection = {
      id: connectionId,
      connection,
      config,
      status: ConnectionStatus.CONNECTING,
      stats: {
        connectionId,
        status: ConnectionStatus.CONNECTING,
        lastActivity: new Date(),
        bytesReceived: 0,
        bytesSent: 0,
        commandsExecuted: 0,
        errors: 0
      },
      createdAt: new Date(),
      lastUsed: new Date(),
      inUse: true
    };

    this.connections.set(connectionId, pooledConnection);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        console.log(`SSH connection ${connectionId} timed out`);
        this.connections.delete(connectionId);
        reject(new Error('SSH connection timeout'));
      }, config.connectionTimeout || 30000);

      connection.on('ready', () => {
        console.log(`SSH connection ${connectionId} ready`);
        clearTimeout(timeout);
        pooledConnection.status = ConnectionStatus.CONNECTED;
        pooledConnection.stats.status = ConnectionStatus.CONNECTED;
        pooledConnection.stats.connectedAt = new Date();
        
        logger.info('SSH connection established', {
          connectionId,
          host: config.host,
          port: config.port,
          username: config.username
        });
        
        resolve(pooledConnection);
      });

      connection.on('error', (error: Error) => {
        console.log(`SSH connection ${connectionId} error:`, error.message);
        console.log('Full error details:', error);
        clearTimeout(timeout);
        pooledConnection.status = ConnectionStatus.ERROR;
        pooledConnection.stats.status = ConnectionStatus.ERROR;
        pooledConnection.stats.errors++;
        this.connections.delete(connectionId);
        
        logger.error('SSH connection error', {
          connectionId,
          error: error.message,
          host: config.host
        });
        
        reject(error);
      });

      connection.on('close', () => {
        console.log(`SSH connection ${connectionId} closed`);
        pooledConnection.status = ConnectionStatus.DISCONNECTED;
        pooledConnection.stats.status = ConnectionStatus.DISCONNECTED;
        pooledConnection.stats.disconnectedAt = new Date();
        this.connections.delete(connectionId);
        
        logger.debug('SSH connection closed', {
          connectionId
        });
      });

      console.log(`Attempting to connect SSH connection ${connectionId}...`);
      connection.connect(config);
    });
  }

  private async cleanupIdleConnections(): Promise<void> {
    const toClose: string[] = [];

    for (const [id, conn] of this.connections) {
      if (!conn.inUse && !this.isConnectionHealthy(conn)) {
        toClose.push(id);
      }
    }

    await Promise.all(toClose.map(id => this.closeConnection(id)));
    
    if (toClose.length > 0) {
      logger.debug('Cleaned up idle SSH connections', {
        count: toClose.length
      });
    }
  }

  private startHealthCheck(): void {
    this.healthCheckTimer = setInterval(() => {
      this.cleanupIdleConnections().catch(error => {
        logger.error('Error during SSH connection health check', { error });
      });
    }, this.config.healthCheckInterval);
  }
}
