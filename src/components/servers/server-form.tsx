"use client";

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useServers } from '@/hooks/useServers';
import { Loader2, TestTube } from 'lucide-react';
import { toast } from 'sonner';

const serverFormSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name must be less than 100 characters'),
  address: z.string().min(1, 'Address is required'),
  port: z.number().int().min(1).max(65535, 'Port must be between 1 and 65535'),
  user: z.string().min(1, 'Username is required'),
  authMethod: z.enum(['password', 'key']),
  password: z.string().optional(),
  privateKey: z.string().optional(),
  delugeEnabled: z.boolean(),
  delugeHost: z.string().optional(),
  delugePort: z.number().int().min(1).max(65535).optional(),
  delugeUsername: z.string().optional(),
  delugePassword: z.string().optional(),
}).refine((data) => {
  // For new servers, require credentials
  if (data.authMethod === 'password' && !data.password) {
    return false;
  }
  if (data.authMethod === 'key' && !data.privateKey) {
    return false;
  }
  return true;
}, {
  message: 'Password is required for password authentication, private key is required for key authentication',
  path: ['authMethod']
});

// Separate schema for editing servers where credentials are optional
const serverEditFormSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name must be less than 100 characters'),
  address: z.string().min(1, 'Address is required'),
  port: z.number().int().min(1).max(65535, 'Port must be between 1 and 65535'),
  user: z.string().min(1, 'Username is required'),
  authMethod: z.enum(['password', 'key']),
  password: z.string().optional(),
  privateKey: z.string().optional(),
  delugeEnabled: z.boolean(),
  delugeHost: z.string().optional(),
  delugePort: z.number().int().min(1).max(65535).optional(),
  delugeUsername: z.string().optional(),
  delugePassword: z.string().optional(),
});

type ServerFormData = z.infer<typeof serverFormSchema>;

interface ServerFormProps {
  serverId?: string | null;
  onClose: () => void;
}

export function ServerForm({ serverId, onClose }: ServerFormProps) {
  const { servers, createServer, updateServer, testConnection } = useServers();
  const [testing, setTesting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [isChangingKey, setIsChangingKey] = useState(false);

  const isEditing = !!serverId;
  const existingServer = servers.find(s => s._id === serverId);

  const form = useForm<ServerFormData>({
    resolver: zodResolver(isEditing ? serverEditFormSchema : serverFormSchema),
    defaultValues: {
      name: '',
      address: '',
      port: 22,
      user: '',
      authMethod: 'password',
      password: '',
      privateKey: '',
      delugeEnabled: false,
      delugeHost: '',
      delugePort: 58846,
      delugeUsername: '',
      delugePassword: '',
    },
  });

  // Load existing server data when editing
  useEffect(() => {
    if (isEditing && existingServer) {
      form.reset({
        name: existingServer.name,
        address: existingServer.address,
        port: existingServer.port,
        user: existingServer.user,
        authMethod: existingServer.authMethod,
        password: '', // Don't populate password for security
        privateKey: '', // Don't populate private key for security
        delugeEnabled: existingServer.deluge?.enabled || false,
        delugeHost: existingServer.deluge?.host || '',
        delugePort: existingServer.deluge?.port || 58846,
        delugeUsername: existingServer.deluge?.username || '',
        delugePassword: '', // Don't populate password for security
      });
      // Reset credential change states when loading new server data
      setIsChangingPassword(false);
      setIsChangingKey(false);
    }
  }, [isEditing, existingServer, form]);

  const authMethod = form.watch('authMethod');
  const delugeEnabled = form.watch('delugeEnabled');

  // Reset credential change states when auth method changes
  useEffect(() => {
    setIsChangingPassword(false);
    setIsChangingKey(false);
    form.setValue('password', '');
    form.setValue('privateKey', '');
  }, [authMethod, form]);

  const onSubmit = async (data: ServerFormData) => {
    try {
      setSubmitting(true);
      
      const serverData: Partial<ServerFormData> = {
        name: data.name,
        address: data.address,
        port: data.port,
        user: data.user,
        authMethod: data.authMethod,
        ...(data.delugeEnabled && {
          deluge: {
            enabled: true,
            host: data.delugeHost!,
            port: data.delugePort!,
            username: data.delugeUsername!,
            password: data.delugePassword!,
          }
        }),
      };

      // Only include credentials if this is a new server or credentials are being changed
      if (!isEditing) {
        // New server - always require credentials
        if (data.authMethod === 'password') {
          serverData.password = data.password;
        } else {
          serverData.privateKey = data.privateKey;
        }
      } else {
        // Editing existing server - only include credentials if they're being changed
        if (data.authMethod === 'password' && isChangingPassword && data.password) {
          serverData.password = data.password;
        } else if (data.authMethod === 'key' && isChangingKey && data.privateKey) {
          serverData.privateKey = data.privateKey;
        }
      }

      if (isEditing && serverId) {
        await updateServer(serverId, serverData as Partial<ServerFormData>);
      } else {
        await createServer(serverData as ServerFormData);
      }
      
      onClose();
    } catch (error) {
      toast.error(`Failed to ${isEditing ? 'update' : 'create'} server: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleTestConnection = async () => {
    if (!isEditing || !serverId) {
      toast.error('Save the server first before testing connection');
      return;
    }

    setTesting(true);
    
    // Show loading toast
    const loadingToast = toast.loading('Testing SSH connection...', {
      description: 'Establishing connection to server'
    });

    try {
      const result = await testConnection(serverId);
      
      // Dismiss loading toast
      toast.dismiss(loadingToast);
      
      if (result.connected) {
        toast.success(`Connection successful! 🎉`, {
          description: `Connected to ${result.serverName} in ${result.duration}ms`,
          duration: 5000,
          action: result.details ? {
            label: 'Details',
            onClick: () => {
              toast.info('Connection Details', {
                description: `Server: ${result.details?.serverInfo || 'N/A'}\nHome: ${result.details?.homeDirectory || 'N/A'}\nUser: ${result.details?.permissions || 'N/A'}`,
                duration: 8000
              });
            }
          } : undefined
        });
      } else {
        toast.error(`Connection failed ❌`, {
          description: result.error || result.message || 'Unknown connection error',
          duration: 8000,
          action: {
            label: 'Retry',
            onClick: handleTestConnection
          }
        });
      }
    } catch (error) {
      // Dismiss loading toast
      toast.dismiss(loadingToast);
      
      toast.error(`Connection test failed ❌`, {
        description: error instanceof Error ? error.message : 'Unknown error occurred',
        duration: 8000,
        action: {
          label: 'Retry',
          onClick: handleTestConnection
        }
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? 'Edit Server Profile' : 'Add Server Profile'}
          </DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Basic Information */}
            <div className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Server Name</FormLabel>
                    <FormControl>
                      <Input placeholder="My Seedbox" {...field} />
                    </FormControl>
                    <FormDescription>
                      A friendly name to identify this server
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2">
                  <FormField
                    control={form.control}
                    name="address"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Address</FormLabel>
                        <FormControl>
                          <Input placeholder="server.example.com" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={form.control}
                  name="port"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Port</FormLabel>
                      <FormControl>
                        <Input 
                          type="number" 
                          {...field} 
                          onChange={(e) => field.onChange(parseInt(e.target.value) || 22)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="user"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Username</FormLabel>
                    <FormControl>
                      <Input placeholder="username" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <Separator />

            {/* Authentication */}
            <div className="space-y-4">
              <FormField
                control={form.control}
                name="authMethod"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Authentication Method</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select authentication method" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="password">Password</SelectItem>
                        <SelectItem value="key">SSH Private Key</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {authMethod === 'password' && (
                <div className="space-y-4">
                  {!isEditing || isChangingPassword ? (
                    <FormField
                      control={form.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Password</FormLabel>
                          <FormControl>
                            <Input type="password" placeholder="Enter password" {...field} />
                          </FormControl>
                          <FormMessage />
                          {isEditing && isChangingPassword && (
                            <div className="mt-2">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setIsChangingPassword(false);
                                  form.setValue('password', '');
                                }}
                              >
                                Cancel Password Change
                              </Button>
                            </div>
                          )}
                        </FormItem>
                      )}
                    />
                  ) : (
                    <div className="space-y-2">
                      <FormLabel>Password</FormLabel>
                      <div className="flex items-center justify-between p-3 border rounded-md bg-muted">
                        <span className="text-sm text-muted-foreground">Password is set (hidden for security)</span>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setIsChangingPassword(true)}
                        >
                          Change Password
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {authMethod === 'key' && (
                <div className="space-y-4">
                  {!isEditing || isChangingKey ? (
                    <FormField
                      control={form.control}
                      name="privateKey"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>SSH Private Key</FormLabel>
                          <FormControl>
                            <Textarea 
                              placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;...&#10;-----END OPENSSH PRIVATE KEY-----"
                              className="min-h-[100px]"
                              {...field} 
                            />
                          </FormControl>
                          <FormDescription>
                            Paste your SSH private key (OpenSSH format)
                          </FormDescription>
                          <FormMessage />
                          {isEditing && isChangingKey && (
                            <div className="mt-2">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setIsChangingKey(false);
                                  form.setValue('privateKey', '');
                                }}
                              >
                                Cancel Key Change
                              </Button>
                            </div>
                          )}
                        </FormItem>
                      )}
                    />
                  ) : (
                    <div className="space-y-2">
                      <FormLabel>SSH Private Key</FormLabel>
                      <div className="flex items-center justify-between p-3 border rounded-md bg-muted">
                        <span className="text-sm text-muted-foreground">SSH key is set (hidden for security)</span>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setIsChangingKey(true)}
                        >
                          Change SSH Key
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <Separator />

            {/* Deluge Integration */}
            <div className="space-y-4">
              <FormField
                control={form.control}
                name="delugeEnabled"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5">
                      <FormLabel className="text-base">
                        Deluge Integration
                      </FormLabel>
                      <FormDescription>
                        Enable post-transfer actions with Deluge daemon
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              {delugeEnabled && (
                <div className="space-y-4 pl-4">
                  <div className="grid grid-cols-3 gap-4">
                    <div className="col-span-2">
                      <FormField
                        control={form.control}
                        name="delugeHost"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Deluge Host</FormLabel>
                            <FormControl>
                              <Input placeholder="127.0.0.1" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    <FormField
                      control={form.control}
                      name="delugePort"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Port</FormLabel>
                          <FormControl>
                            <Input 
                              type="number" 
                              {...field} 
                              onChange={(e) => field.onChange(parseInt(e.target.value) || 58846)}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name="delugeUsername"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Deluge Username</FormLabel>
                        <FormControl>
                          <Input placeholder="admin" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="delugePassword"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Deluge Password</FormLabel>
                        <FormControl>
                          <Input type="password" placeholder="Enter Deluge password" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between pt-4">
              <div>
                {isEditing && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleTestConnection}
                    disabled={testing}
                  >
                    {testing ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <TestTube className="h-4 w-4 mr-2" />
                    )}
                    Test Connection
                  </Button>
                )}
              </div>
              
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={onClose}>
                  Cancel
                </Button>
                <Button type="submit" disabled={submitting}>
                  {submitting ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : null}
                  {isEditing ? 'Update' : 'Create'} Server
                </Button>
              </div>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
