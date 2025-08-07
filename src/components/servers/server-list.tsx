"use client";

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger 
} from '@/components/ui/dropdown-menu';
import { useServers } from '@/hooks/useServers';
import { ServerForm } from './server-form';
import { ConnectionStatusBadge } from './connection-status-badge';
import { 
  Plus, 
  MoreHorizontal, 
  Edit, 
  Trash2, 
  TestTube, 
  Server,
  Loader2,
  XCircle
} from 'lucide-react';
import { toast } from 'sonner';

export function ServerList() {
  const { servers, loading, error, connectionStatus, deleteServer, testConnection } = useServers();
  const [showForm, setShowForm] = useState(false);
  const [editingServer, setEditingServer] = useState<string | null>(null);

  const handleDelete = async (id: string, name: string) => {
    if (confirm(`Are you sure you want to delete server "${name}"?`)) {
      try {
        await deleteServer(id);
      } catch (error) {
        toast.error(`Failed to delete server: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  };

  const handleTestConnection = async (id: string, name: string) => {
    // Show loading toast
    const loadingToast = toast.loading(`Testing connection to "${name}"...`, {
      description: 'Establishing SSH connection'
    });

    try {
      const result = await testConnection(id);
      
      // Dismiss loading toast
      toast.dismiss(loadingToast);
      
      if (result.connected) {
        toast.success(`Connection to "${name}" successful! 🎉`, {
          description: `Connected in ${result.duration}ms`,
          duration: 4000,
          action: result.details ? {
            label: 'Details',
            onClick: () => {
              toast.info(`Connection Details for "${name}"`, {
                description: `Server: ${result.details?.serverInfo || 'N/A'}\nHome: ${result.details?.homeDirectory || 'N/A'}\nUser: ${result.details?.permissions || 'N/A'}`,
                duration: 8000
              });
            }
          } : undefined
        });
      } else {
        toast.error(`Connection to "${name}" failed ❌`, {
          description: result.error || result.message || 'Unknown connection error',
          duration: 6000,
          action: {
            label: 'Retry',
            onClick: () => handleTestConnection(id, name)
          }
        });
      }
    } catch (error) {
      // Dismiss loading toast
      toast.dismiss(loadingToast);
      
      toast.error(`Connection test failed ❌`, {
        description: error instanceof Error ? error.message : 'Unknown error occurred',
        duration: 6000,
        action: {
          label: 'Retry',
          onClick: () => handleTestConnection(id, name)
        }
      });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-8 w-8 animate-spin" />
        <span className="ml-2">Loading servers...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <XCircle className="h-8 w-8 text-red-500 mx-auto mb-2" />
        <p className="text-muted-foreground">Error loading servers: {error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Server Profiles</h1>
          <p className="text-muted-foreground">
            Manage your remote server connections and credentials
          </p>
        </div>
        <Button onClick={() => setShowForm(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Add Server
        </Button>
      </div>

      {servers.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Server className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No servers configured</h3>
            <p className="text-muted-foreground text-center mb-4">
              Get started by adding your first remote server profile
            </p>
            <Button onClick={() => setShowForm(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Your First Server
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {servers.map((server) => (
            <Card key={server._id} className="relative">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex flex-col gap-1">
                    <CardTitle className="text-lg">{server.name}</CardTitle>
                    <ConnectionStatusBadge 
                      status={connectionStatus[server._id]?.status || 'never-tested'}
                      lastTested={connectionStatus[server._id]?.lastTested}
                      size="sm"
                    />
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => handleTestConnection(server._id, server.name)}
                        disabled={connectionStatus[server._id]?.status === 'testing'}
                      >
                        <TestTube className="h-4 w-4 mr-2" />
                        Test Connection
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setEditingServer(server._id)}>
                        <Edit className="h-4 w-4 mr-2" />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem 
                        onClick={() => handleDelete(server._id, server.name)}
                        className="text-red-600"
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div>
                    <p className="text-sm font-medium">Address</p>
                    <p className="text-sm text-muted-foreground">
                      {server.user}@{server.address}:{server.port}
                    </p>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <Badge variant={server.authMethod === 'key' ? 'default' : 'secondary'}>
                      {server.authMethod === 'key' ? 'SSH Key' : 'Password'}
                    </Badge>
                    
                    {server.deluge?.enabled && (
                      <Badge variant="outline">Deluge</Badge>
                    )}
                  </div>

                  <div className="flex items-center gap-2 pt-2">
                    {connectionStatus[server._id]?.status === 'testing' ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span className="text-sm">Testing...</span>
                      </>
                    ) : (
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => handleTestConnection(server._id, server.name)}
                        disabled={connectionStatus[server._id]?.status === 'testing'}
                      >
                        <TestTube className="h-4 w-4 mr-2" />
                        Test Connection
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {(showForm || editingServer) && (
        <ServerForm
          serverId={editingServer}
          onClose={() => {
            setShowForm(false);
            setEditingServer(null);
          }}
        />
      )}
    </div>
  );
}
