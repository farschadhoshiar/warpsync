/**
 * JobForm Component
 * Simplified form for creating and editing sync jobs
 */

'use client';

import React, { useState, useEffect } from 'react';
import { useForm, useFieldArray, Control } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { FolderOpen, Plus, X, HelpCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useServers } from '@/hooks/useServers';
import DirectoryBrowserDialog from './directory-browser-dialog';

// Comprehensive form validation schema with all job fields
const syncJobSchema = z.object({
  name: z.string().min(1, 'Job name is required').max(100, 'Job name too long'),
  description: z.string().optional(),
  enabled: z.boolean(),
  sourceServerId: z.string().min(1, 'Source server is required'),
  targetType: z.enum(['server', 'local']),
  targetServerId: z.string().optional(),
  sourcePath: z.string().min(1, 'Source path is required'),
  targetPath: z.string().min(1, 'Target path is required'),
  chmod: z.string().regex(/^[0-7]{3,4}$/, 'Chmod must be a valid octal permission mode (e.g., 755, 644)'),
  scanInterval: z.number().int().min(5, 'Scan interval must be at least 5 minutes').max(10080, 'Scan interval cannot exceed 10080 minutes (1 week)'),
  direction: z.enum(['download', 'upload', 'bidirectional']),
  deleteExtraneous: z.boolean(),
  preserveTimestamps: z.boolean(),
  preservePermissions: z.boolean(),
  compressTransfer: z.boolean(),
  dryRun: z.boolean(),
  maxRetries: z.number().min(0).max(10),
  retryDelay: z.number().min(1000).max(300000),
  autoQueueEnabled: z.boolean(),
  maxConcurrentTransfers: z.number().int().min(1, 'Max concurrent transfers must be at least 1').max(10, 'Max concurrent transfers cannot exceed 10'),
  maxConnectionsPerTransfer: z.number().int().min(1, 'Max connections per transfer must be at least 1').max(20, 'Max connections per transfer cannot exceed 20'),
  delugeAction: z.enum(['none', 'remove', 'remove_data', 'set_label']),
  delugeDelay: z.number().int().min(0, 'Delay must be 0 or greater').max(1440, 'Delay cannot exceed 1440 minutes (24 hours)'),
  delugeLabel: z.string().max(50, 'Label cannot exceed 50 characters').optional(),
}).refine((data) => {
  if (data.targetType === 'server' && !data.targetServerId) {
    return false;
  }
  if (data.targetType === 'server' && data.sourceServerId === data.targetServerId) {
    return false;
  }
  if (data.delugeAction === 'set_label' && (!data.delugeLabel || data.delugeLabel.trim() === '')) {
    return false;
  }
  return true;
}, {
  message: "Target server is required when target type is server, source and target servers must be different, and label is required when deluge action is set_label",
  path: ["targetServerId"]
});

type SyncJobFormSchema = z.infer<typeof syncJobSchema>;

interface SyncJobFormData extends SyncJobFormSchema {
  autoQueuePatterns: string[];
  autoQueueExcludePatterns: string[];
}

interface JobFormProps {
  initialData?: Partial<SyncJobFormData>;
  onSubmit: (data: SyncJobFormData) => Promise<void>;
  onCancel: () => void;
  isEditing?: boolean;
  isLoading?: boolean;
}

export default function JobForm({ 
  initialData, 
  onSubmit, 
  onCancel, 
  isEditing = false, 
  isLoading = false 
}: JobFormProps) {
  const [testingConnection, setTestingConnection] = useState<string | null>(null);
  const [connectionResults, setConnectionResults] = useState<Record<string, boolean>>({});
  const [directoryBrowser, setDirectoryBrowser] = useState<{
    isOpen: boolean;
    serverId: string;
    serverName: string;
    pathType: 'source' | 'target';
    initialPath?: string;
  } | null>(null);
  
  const { servers, loading: serversLoading } = useServers();
  
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    control,
    formState: { errors }
  } = useForm<SyncJobFormSchema>({
    resolver: zodResolver(syncJobSchema),
    mode: 'onChange',
    defaultValues: {
      name: '',
      description: '',
      enabled: true,
      sourceServerId: '',
      targetType: 'local' as const,
      targetServerId: '',
      sourcePath: '',
      targetPath: '',
      chmod: '755',
      scanInterval: 60,
      direction: 'download' as const,
      deleteExtraneous: false,
      preserveTimestamps: true,
      preservePermissions: true,
      compressTransfer: true,
      dryRun: false,
      maxRetries: 3,
      retryDelay: 5000,
      autoQueueEnabled: false,
      maxConcurrentTransfers: 3,
      maxConnectionsPerTransfer: 5,
      delugeAction: 'none' as const,
      delugeDelay: 15,
      delugeLabel: '',
    }
  });

  const [autoQueuePatterns, setAutoQueuePatterns] = useState<string[]>([]);
  const [autoQueueExcludePatterns, setAutoQueueExcludePatterns] = useState<string[]>([]);
  
  // Update state when form is reset with initialData
  useEffect(() => {
    if (initialData) {
      setAutoQueuePatterns(initialData.autoQueuePatterns || []);
      setAutoQueueExcludePatterns(initialData.autoQueueExcludePatterns || []);
    }
  }, [initialData]);

  // Functions to manage patterns
  const addPattern = () => setAutoQueuePatterns([...autoQueuePatterns, '']);
  const removePattern = (index: number) => setAutoQueuePatterns(autoQueuePatterns.filter((_, i) => i !== index));
  const updatePattern = (index: number, value: string) => {
    const newPatterns = [...autoQueuePatterns];
    newPatterns[index] = value;
    setAutoQueuePatterns(newPatterns);
  };

  const addExcludePattern = () => setAutoQueueExcludePatterns([...autoQueueExcludePatterns, '']);
  const removeExcludePattern = (index: number) => setAutoQueueExcludePatterns(autoQueueExcludePatterns.filter((_, i) => i !== index));
  const updateExcludePattern = (index: number, value: string) => {
    const newPatterns = [...autoQueueExcludePatterns];
    newPatterns[index] = value;
    setAutoQueueExcludePatterns(newPatterns);
  };
  
  // Reset form when initialData changes (for editing)
  useEffect(() => {
    if (initialData && isEditing) {
      console.log('🔄 JobForm Reset - initialData received:', {
        sourceServerId: initialData.sourceServerId,
        name: initialData.name,
        targetType: initialData.targetType,
        direction: initialData.direction,
        deleteExtraneous: initialData.deleteExtraneous,
        preserveTimestamps: initialData.preserveTimestamps
      });
      console.log('🔍 Raw sourceServerId type:', typeof initialData.sourceServerId);
      console.log('🔍 Raw sourceServerId value:', initialData.sourceServerId);
      const resetData: Partial<SyncJobFormSchema> = {
        name: '',
        description: '',
        enabled: true,
        sourceServerId: '',
        targetType: 'local' as const,
        targetServerId: '',
        sourcePath: '',
        targetPath: '/data/local',
        chmod: '755',
        scanInterval: 60,
        direction: 'download' as const,
        deleteExtraneous: false,
        preserveTimestamps: true,
        preservePermissions: true,
        compressTransfer: true,
        dryRun: false,
        maxRetries: 3,
        retryDelay: 5000,
        autoQueueEnabled: false,
        maxConcurrentTransfers: 3,
        maxConnectionsPerTransfer: 5,
        delugeAction: 'none' as const,
        delugeDelay: 15,
        delugeLabel: '',
        ...initialData
      };
      console.log('🔄 Reset data being applied:', resetData);
      reset(resetData);
    }
  }, [initialData, isEditing, reset]);
  
  const watchedValues = watch(['sourceServerId', 'targetServerId', 'targetType', 'direction']);
  
  // Get current form values for selects
  const currentDirection = watch('direction');
  const currentTargetType = watch('targetType');
  
  // Debug: Log form values when they change
  useEffect(() => {
    if (isEditing && watchedValues[0]) {
      console.log('🔍 Form sourceServerId:', watchedValues[0]);
    }
  }, [watchedValues, isEditing]);
  
  // Also reset when servers are loaded to ensure Select components work properly
  useEffect(() => {
    if (initialData && isEditing && servers.length > 0 && !serversLoading) {
      console.log('🔍 Setting up server selection...');
      
      const serverExists = servers.some(s => String(s._id) === String(initialData.sourceServerId));
      
      if (serverExists && String(watchedValues[0]) !== String(initialData.sourceServerId)) {
        console.log('✅ Setting sourceServerId to:', String(initialData.sourceServerId));
        setValue('sourceServerId', String(initialData.sourceServerId));
      } else if (!serverExists) {
        console.error('❌ Server not found in list! Available IDs:', servers.map(s => s._id));
        console.error('❌ Looking for:', String(initialData.sourceServerId));
      } else {
        console.log('✅ Server already selected correctly');
      }
    }
  }, [servers, serversLoading, initialData, isEditing, setValue, watchedValues]);
  
  // Test server connection
  const testConnection = async (serverId: string) => {
    setTestingConnection(serverId);
    try {
      const response = await fetch(`/api/servers/${serverId}/test`, {
        method: 'POST'
      });
      const result = await response.json();
      setConnectionResults(prev => ({
        ...prev,
        [serverId]: result.success
      }));
    } catch {
      setConnectionResults(prev => ({
        ...prev,
        [serverId]: false
      }));
    } finally {
      setTestingConnection(null);
    }
  };
  
  // Open directory browser
  const openDirectoryBrowser = (pathType: 'source' | 'target') => {
    if (pathType === 'target' && watchedValues[2] === 'local') {
      // For local target, don't open browser - user can manually edit path
      toast.info('Local Path', {
        description: 'Edit the path directly in the input field. Default is /data/local'
      });
      return;
    }
    
    const serverId = pathType === 'source' ? watchedValues[0] : watchedValues[1];
    const server = servers.find(s => s._id === serverId);
    
    if (!serverId || !server) {
      toast.error('Please select a server first');
      return;
    }
    
    // Get the current path value for initialPath
    const currentPath = pathType === 'source' ? watch('sourcePath') : watch('targetPath');
    
    setDirectoryBrowser({
      isOpen: true,
      serverId,
      serverName: server.name,
      pathType,
      initialPath: currentPath || '/'
    });
  };
  
  // Handle path selection from directory browser
  const handlePathSelect = (path: string) => {
    if (directoryBrowser?.pathType === 'source') {
      setValue('sourcePath', path);
    } else if (directoryBrowser?.pathType === 'target') {
      setValue('targetPath', path);
    }
    setDirectoryBrowser(null);
  };
  
  const handleFormSubmit = async (data: SyncJobFormSchema) => {
    try {
      // Include the local state arrays in the form data
      const formDataWithArrays: SyncJobFormData = {
        ...data,
        autoQueuePatterns: autoQueuePatterns.filter(p => p.trim() !== ''),
        autoQueueExcludePatterns: autoQueueExcludePatterns.filter(p => p.trim() !== '')
      };
      await onSubmit(formDataWithArrays);
    } catch (error) {
      console.error('Failed to save job:', error);
      // Show the actual error to the user
      if (error instanceof Error) {
        toast.error('Failed to save job', {
          description: error.message
        });
      } else {
        toast.error('Failed to save job', {
          description: 'An unknown error occurred'
        });
      }
    }
  };
  
  return (
    <div className=" mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">
            {isEditing ? 'Edit Sync Job' : 'Create New Sync Job'}
          </h2>
          <p className="text-muted-foreground">
            Configure synchronization between servers
          </p>
        </div>
        <div className="space-x-2">
          <Button variant="outline" onClick={onCancel} disabled={isLoading}>
            Cancel
          </Button>
          <Button 
            type="submit" 
            form="job-form"
            disabled={isLoading}
          >
            {isLoading ? 'Saving...' : (isEditing ? 'Update Job' : 'Create Job')}
          </Button>
        </div>
      </div>
      
      <form id="job-form" onSubmit={handleSubmit(handleFormSubmit)} className="space-y-6">
        
        {/* Basic Information */}
        <Card>
          <CardHeader>
            <CardTitle>Basic Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="name">Job Name</Label>
              <Input 
                id="name"
                placeholder="e.g., Daily Backup, Website Sync" 
                {...register('name')}
              />
              {errors.name && (
                <p className="text-sm text-red-500 mt-1">{errors.name.message}</p>
              )}
            </div>
            
            <div>
              <Label htmlFor="description">Description (Optional)</Label>
              <Textarea 
                id="description"
                placeholder="Detailed description of what this job synchronizes..." 
                {...register('description')}
              />
            </div>
          </CardContent>
        </Card>
        
        {/* Server Configuration */}
        <Card>
          <CardHeader>
            <CardTitle>Server Configuration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="sourceServerId">Source Server</Label>
                <Select 
                  value={watchedValues[0] || ''}
                  onValueChange={(value) => setValue('sourceServerId', value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select source server" />
                  </SelectTrigger>
                  <SelectContent>
                    {servers.map((server) => (
                      <SelectItem key={server._id} value={server._id}>
                        <div className="flex items-center space-x-2">
                          <span>{server.name}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {watchedValues[0] && (
                  <div className="flex items-center space-x-2 mt-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => testConnection(watchedValues[0])}
                      disabled={testingConnection === watchedValues[0]}
                    >
                      {testingConnection === watchedValues[0] ? 'Testing...' : 'Test Connection'}
                    </Button>
                    {connectionResults[watchedValues[0]] !== undefined && (
                      <Badge variant={connectionResults[watchedValues[0]] ? 'default' : 'destructive'}>
                        {connectionResults[watchedValues[0]] ? 'Connected' : 'Failed'}
                      </Badge>
                    )}
                  </div>
                )}
                {errors.sourceServerId && (
                  <p className="text-sm text-red-500 mt-1">{errors.sourceServerId.message}</p>
                )}
              </div>
              
              <div>
                <Label htmlFor="targetType">Target Type</Label>
                <Select 
                  value={watchedValues[2] || 'local'}
                  onValueChange={(value) => {
                    setValue('targetType', value as 'server' | 'local');
                    if (value === 'local') {
                      setValue('targetPath', '/data/local');
                      setValue('targetServerId', '');
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select target type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="local">Local Directory</SelectItem>
                    <SelectItem value="server">Remote Server</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              {watchedValues[2] === 'server' && (
                <div>
                  <Label htmlFor="targetServerId">Target Server</Label>
                  <Select 
                    value={watchedValues[1] || ''}
                    onValueChange={(value) => setValue('targetServerId', value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select target server" />
                    </SelectTrigger>
                    <SelectContent>
                      {servers.map((server) => (
                        <SelectItem key={server._id} value={server._id}>
                          <div className="flex items-center space-x-2">
                            <span>{server.name}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {watchedValues[1] && (
                    <div className="flex items-center space-x-2 mt-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => testConnection(watchedValues[1]!)}
                        disabled={testingConnection === watchedValues[1]}
                      >
                        {testingConnection === watchedValues[1] ? 'Testing...' : 'Test Connection'}
                      </Button>
                      {connectionResults[watchedValues[1]] !== undefined && (
                        <Badge variant={connectionResults[watchedValues[1]] ? 'default' : 'destructive'}>
                          {connectionResults[watchedValues[1]] ? 'Connected' : 'Failed'}
                        </Badge>
                      )}
                    </div>
                  )}
                  {errors.targetServerId && (
                    <p className="text-sm text-red-500 mt-1">{errors.targetServerId.message}</p>
                  )}
                </div>
              )}
              
              {watchedValues[2] === 'local' && (
                <div className="bg-blue-50 p-4 rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                    <span className="text-sm font-medium text-blue-800">Local Sync Target</span>
                  </div>
                  <p className="text-sm text-blue-700">
                    Files will be synchronized to the local `/data/local` directory. 
                    You can mount this directory in Docker to access synced files.
                  </p>
                </div>
              )}
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="sourcePath">Source Path</Label>
                <div className="flex gap-2">
                  <Input 
                    id="sourcePath"
                    placeholder="/path/to/source" 
                    {...register('sourcePath')}
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => openDirectoryBrowser('source')}
                    disabled={!watchedValues[0] || isLoading}
                    className="shrink-0"
                  >
                    <FolderOpen className="h-4 w-4" />
                  </Button>
                </div>
                {errors.sourcePath && (
                  <p className="text-sm text-red-500 mt-1">{errors.sourcePath.message}</p>
                )}
              </div>
              
              <div>
                <Label htmlFor="targetPath">
                  {watchedValues[2] === 'local' ? 'Local Target Path' : 'Target Path'}
                </Label>
                <div className="flex gap-2">
                  <Input 
                    id="targetPath"
                    placeholder={watchedValues[2] === 'local' ? '/data/local/subfolder' : '/path/to/target'} 
                    {...register('targetPath')}
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => openDirectoryBrowser('target')}
                    disabled={watchedValues[2] === 'local' || (!watchedValues[1] && watchedValues[2] === 'server') || isLoading}
                    className="shrink-0"
                  >
                    <FolderOpen className="h-4 w-4" />
                  </Button>
                </div>
                {watchedValues[2] === 'local' && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Path is relative to the container&apos;s /data/local directory
                  </p>
                )}
                {errors.targetPath && (
                  <p className="text-sm text-red-500 mt-1">{errors.targetPath.message}</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
        
        {/* Sync Options */}
        <Card>
          <CardHeader>
            <CardTitle>Sync Options</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="direction">Sync Direction</Label>
              <Select 
                value={currentDirection || 'download'}
                onValueChange={(value) => setValue('direction', value as 'download' | 'upload' | 'bidirectional')}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select direction" />
                </SelectTrigger>
                <SelectContent>
                  {currentTargetType === 'local' ? (
                    <SelectItem value="download">Download to Local (Remote → Local)</SelectItem>
                  ) : (
                    <>
                      <SelectItem value="download">Download (Source → Target)</SelectItem>
                      <SelectItem value="upload">Upload (Target ← Source)</SelectItem>
                      <SelectItem value="bidirectional">Bidirectional</SelectItem>
                    </>
                  )}
                </SelectContent>
              </Select>
              {currentTargetType === 'local' && (
                <p className="text-xs text-muted-foreground mt-1">
                  Local targets only support downloading from remote servers
                </p>
              )}
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="flex items-center space-x-2">
                <Switch 
                  id="deleteExtraneous"
                  checked={watch('deleteExtraneous')}
                  onCheckedChange={(checked) => setValue('deleteExtraneous', checked)}
                />
                <Label htmlFor="deleteExtraneous">Delete Extra Files</Label>
              </div>
              
              <div className="flex items-center space-x-2">
                <Switch 
                  id="preserveTimestamps"
                  checked={watch('preserveTimestamps')}
                  onCheckedChange={(checked) => setValue('preserveTimestamps', checked)}
                />
                <Label htmlFor="preserveTimestamps">Preserve Timestamps</Label>
              </div>
              
              <div className="flex items-center space-x-2">
                <Switch 
                  id="preservePermissions"
                  checked={watch('preservePermissions')}
                  onCheckedChange={(checked) => setValue('preservePermissions', checked)}
                />
                <Label htmlFor="preservePermissions">Preserve Permissions</Label>
              </div>
              
              <div className="flex items-center space-x-2">
                <Switch 
                  id="compressTransfer"
                  checked={watch('compressTransfer')}
                  onCheckedChange={(checked) => setValue('compressTransfer', checked)}
                />
                <Label htmlFor="compressTransfer">Compress Transfer</Label>
              </div>
              
              <div className="flex items-center space-x-2">
                <Switch 
                  id="dryRun"
                  checked={watch('dryRun')}
                  onCheckedChange={(checked) => setValue('dryRun', checked)}
                />
                <Label htmlFor="dryRun">Dry Run</Label>
              </div>
            </div>
          </CardContent>
        </Card>
        
        {/* Job Settings */}
        <Card>
          <CardHeader>
            <CardTitle>Job Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center space-x-2">
              <Switch 
                id="enabled"
                checked={watch('enabled')}
                onCheckedChange={(checked) => setValue('enabled', checked)}
              />
              <Label htmlFor="enabled">Job Enabled</Label>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="scanInterval">Scan Interval (minutes)</Label>
                <Input 
                  id="scanInterval"
                  type="number" 
                  min="5" 
                  max="10080" 
                  {...register('scanInterval', { valueAsNumber: true })}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  How often to scan for new files (5 minutes to 1 week)
                </p>
                {errors.scanInterval && (
                  <p className="text-sm text-red-500 mt-1">{errors.scanInterval.message}</p>
                )}
              </div>
              
              <div>
                <Label htmlFor="chmod">File Permissions (chmod)</Label>
                <Input 
                  id="chmod"
                  placeholder="755" 
                  {...register('chmod')}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Octal permission mode (e.g., 755, 644)
                </p>
                {errors.chmod && (
                  <p className="text-sm text-red-500 mt-1">{errors.chmod.message}</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
        
        {/* Auto-Queue Configuration */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Auto-Queue Configuration
              <HelpCircle className="h-4 w-4 text-muted-foreground" />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center space-x-2">
              <Switch 
                id="autoQueueEnabled"
                checked={watch('autoQueueEnabled')}
                onCheckedChange={(checked) => setValue('autoQueueEnabled', checked)}
              />
              <Label htmlFor="autoQueueEnabled">Enable Auto-Queue</Label>
            </div>
            
            {watch('autoQueueEnabled') && (
              <>
                <div>
                  <Label>Include Patterns</Label>
                  <p className="text-xs text-muted-foreground mb-2">
                    Files matching these patterns will be automatically queued for transfer
                  </p>
                  {autoQueuePatterns.map((pattern, index) => (
                    <div key={index} className="flex gap-2 mb-2">
                      <Input
                        placeholder="*.mkv, *.mp4, complete/*"
                        value={pattern}
                        onChange={(e) => updatePattern(index, e.target.value)}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => removePattern(index)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => addPattern()}
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Add Pattern
                  </Button>
                </div>
                
                <div>
                  <Label>Exclude Patterns</Label>
                  <p className="text-xs text-muted-foreground mb-2">
                    Files matching these patterns will be excluded from auto-queue
                  </p>
                  {autoQueueExcludePatterns.map((pattern, index) => (
                    <div key={index} className="flex gap-2 mb-2">
                      <Input
                        placeholder="*.tmp, *.part, .incomplete/*"
                        value={pattern}
                        onChange={(e) => updateExcludePattern(index, e.target.value)}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => removeExcludePattern(index)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => addExcludePattern()}
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Add Exclude Pattern
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
        
        {/* Transfer Parallelism */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Transfer Parallelism
              <HelpCircle className="h-4 w-4 text-muted-foreground" />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="maxConcurrentTransfers">Max Concurrent Transfers</Label>
                <Input 
                  id="maxConcurrentTransfers"
                  type="number" 
                  min="1" 
                  max="10" 
                  {...register('maxConcurrentTransfers', { valueAsNumber: true })}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Maximum number of files transferring simultaneously
                </p>
                {errors.maxConcurrentTransfers && (
                  <p className="text-sm text-red-500 mt-1">{errors.maxConcurrentTransfers.message}</p>
                )}
              </div>
              
              <div>
                <Label htmlFor="maxConnectionsPerTransfer">Max Connections Per Transfer</Label>
                <Input 
                  id="maxConnectionsPerTransfer"
                  type="number" 
                  min="1" 
                  max="20" 
                  {...register('maxConnectionsPerTransfer', { valueAsNumber: true })}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Maximum connections for each individual file transfer
                </p>
                {errors.maxConnectionsPerTransfer && (
                  <p className="text-sm text-red-500 mt-1">{errors.maxConnectionsPerTransfer.message}</p>
                )}
              </div>
            </div>
            <Alert>
              <AlertDescription>
                Higher values may improve transfer speed but will use more system resources and network connections.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
        
        {/* Deluge Integration */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Deluge Integration
              <HelpCircle className="h-4 w-4 text-muted-foreground" />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="delugeAction">Post-Transfer Action</Label>
              <Select 
                value={watch('delugeAction') || 'none'}
                onValueChange={(value) => setValue('delugeAction', value as 'none' | 'remove' | 'remove_data' | 'set_label')}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select action" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Do Nothing</SelectItem>
                  <SelectItem value="remove">Remove Torrent (Keep Data)</SelectItem>
                  <SelectItem value="remove_data">Remove Torrent and Data</SelectItem>
                  <SelectItem value="set_label">Set Label/Category</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                Action to perform in Deluge after successful file transfer
              </p>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="delugeDelay">Delay (minutes)</Label>
                <Input 
                  id="delugeDelay"
                  type="number" 
                  min="0" 
                  max="1440" 
                  {...register('delugeDelay', { valueAsNumber: true })}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Wait time before executing the action (0-1440 minutes)
                </p>
                {errors.delugeDelay && (
                  <p className="text-sm text-red-500 mt-1">{errors.delugeDelay.message}</p>
                )}
              </div>
              
              {watch('delugeAction') === 'set_label' && (
                <div>
                  <Label htmlFor="delugeLabel">Label</Label>
                  <Input 
                    id="delugeLabel"
                    placeholder="completed"
                    {...register('delugeLabel')}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Label to set in Deluge (required for set_label action)
                  </p>
                  {errors.delugeLabel && (
                    <p className="text-sm text-red-500 mt-1">{errors.delugeLabel.message}</p>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
        
        {/* Advanced Options */}
        <Card>
          <CardHeader>
            <CardTitle>Advanced Options</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="maxRetries">Max Retries</Label>
                <Input 
                  id="maxRetries"
                  type="number" 
                  min="0" 
                  max="10" 
                  {...register('maxRetries', { valueAsNumber: true })}
                />
                {errors.maxRetries && (
                  <p className="text-sm text-red-500 mt-1">{errors.maxRetries.message}</p>
                )}
              </div>
              
              <div>
                <Label htmlFor="retryDelay">Retry Delay (ms)</Label>
                <Input 
                  id="retryDelay"
                  type="number" 
                  min="1000" 
                  max="300000" 
                  {...register('retryDelay', { valueAsNumber: true })}
                />
                {errors.retryDelay && (
                  <p className="text-sm text-red-500 mt-1">{errors.retryDelay.message}</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
        
        {/* Form Actions */}
        <div className="flex justify-end space-x-2 pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={isLoading}
          >
            {isLoading ? 'Saving...' : (isEditing ? 'Update Job' : 'Create Job')}
          </Button>
        </div>
        
      </form>
      
      {serversLoading && (
        <Alert>
          <AlertDescription>Loading servers...</AlertDescription>
        </Alert>
      )}
      
      {/* Directory Browser Dialog */}
      {directoryBrowser && (
        <DirectoryBrowserDialog
          serverId={directoryBrowser.serverId}
          serverName={directoryBrowser.serverName}
          isOpen={directoryBrowser.isOpen}
          onClose={() => setDirectoryBrowser(null)}
          onPathSelect={handlePathSelect}
          initialPath={directoryBrowser.initialPath}
          title={`Browse ${directoryBrowser.pathType === 'source' ? 'Source' : 'Target'} Directory`}
        />
      )}
    </div>
  );
}
