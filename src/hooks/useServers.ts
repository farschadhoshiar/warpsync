import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';

interface Server {
  _id: string;
  name: string;
  address: string;
  port: number;
  user: string;
  authMethod: 'password' | 'key';
  deluge?: {
    enabled: boolean;
    host: string;
    port: number;
    username: string;
  };
  createdAt: string;
  updatedAt: string;
}

interface ServerFormData {
  name: string;
  address: string;
  port: number;
  user: string;
  authMethod: 'password' | 'key';
  password?: string;
  privateKey?: string;
  deluge?: {
    enabled: boolean;
    host: string;
    port: number;
    username: string;
    password: string;
  };
}

interface ConnectionTestResult {
  connected: boolean;
  serverName: string;
  serverAddress: string;
  serverPort: number;
  authMethod: string;
  duration: number;
  timestamp: string;
  message: string;
  error?: string;
  details?: {
    connectionTime: number;
    serverInfo?: string;
    homeDirectory?: string;
    permissions?: string;
  };
}

export function useServers() {
  const [servers, setServers] = useState<Server[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<Record<string, {
    status: 'connected' | 'disconnected' | 'testing' | 'never-tested' | 'error';
    lastTested?: string;
    lastResult?: ConnectionTestResult;
  }>>({});

  const fetchServers = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch('/api/servers');
      
      if (!response.ok) {
        throw new Error(`Failed to fetch servers: ${response.statusText}`);
      }
      
      const data = await response.json();
      if (data.success) {
        const serverList = data.data || [];
        setServers(serverList);
        
        // Initialize connection status for new servers
        setConnectionStatus(prev => {
          const newStatus = { ...prev };
          serverList.forEach((server: Server) => {
            if (!newStatus[server._id]) {
              newStatus[server._id] = { status: 'never-tested' };
            }
          });
          return newStatus;
        });
      } else {
        throw new Error(data.error?.message || 'Failed to fetch servers');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      setError(errorMessage);
      toast.error(`Error loading servers: ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  }, []);

  const createServer = useCallback(async (serverData: ServerFormData): Promise<Server> => {
    const response = await fetch('/api/servers', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(serverData),
    });

    if (!response.ok) {
      throw new Error(`Failed to create server: ${response.statusText}`);
    }

    const data = await response.json();
    if (!data.success) {
      throw new Error(data.error?.message || 'Failed to create server');
    }

    const newServer = data.data;
    setServers(prev => [...prev, newServer]);
    
    // Initialize connection status for new server
    setConnectionStatus(prev => ({
      ...prev,
      [newServer._id]: { status: 'never-tested' }
    }));
    
    toast.success(`Server "${newServer.name}" created successfully`);
    return newServer;
  }, []);

  const updateServer = useCallback(async (id: string, serverData: Partial<ServerFormData>): Promise<Server> => {
    const response = await fetch(`/api/servers/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(serverData),
    });

    if (!response.ok) {
      throw new Error(`Failed to update server: ${response.statusText}`);
    }

    const data = await response.json();
    if (!data.success) {
      throw new Error(data.error?.message || 'Failed to update server');
    }

    const updatedServer = data.data;
    setServers(prev => prev.map(server => 
      server._id === id ? updatedServer : server
    ));
    toast.success(`Server "${updatedServer.name}" updated successfully`);
    return updatedServer;
  }, []);

  const deleteServer = useCallback(async (id: string): Promise<void> => {
    const response = await fetch(`/api/servers/${id}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      throw new Error(`Failed to delete server: ${response.statusText}`);
    }

    const data = await response.json();
    if (!data.success) {
      throw new Error(data.error?.message || 'Failed to delete server');
    }

    setServers(prev => prev.filter(server => server._id !== id));
    
    // Remove connection status for deleted server
    setConnectionStatus(prev => {
      const newStatus = { ...prev };
      delete newStatus[id];
      return newStatus;
    });
    
    toast.success('Server deleted successfully');
  }, []);

  const testConnection = useCallback(async (id: string): Promise<ConnectionTestResult> => {
    // Update status to testing
    setConnectionStatus(prev => ({
      ...prev,
      [id]: { status: 'testing', lastTested: new Date().toISOString() }
    }));

    try {
      const response = await fetch(`/api/servers/${id}/test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to test connection: ${response.statusText}`);
      }

      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error?.message || 'Connection test failed');
      }

      const result: ConnectionTestResult = data.data;
      
      // Update connection status based on result
      setConnectionStatus(prev => ({
        ...prev,
        [id]: {
          status: result.connected ? 'connected' : 'disconnected',
          lastTested: result.timestamp,
          lastResult: result
        }
      }));

      // Return the connection test result with all details
      return result;
    } catch (error) {
      // Update status to error
      setConnectionStatus(prev => ({
        ...prev,
        [id]: { 
          status: 'error', 
          lastTested: new Date().toISOString()
        }
      }));
      throw error;
    }
  }, []);

  useEffect(() => {
    fetchServers();
  }, [fetchServers]);

  return {
    servers,
    loading,
    error,
    connectionStatus,
    refetch: fetchServers,
    createServer,
    updateServer,
    deleteServer,
    testConnection,
  };
}
