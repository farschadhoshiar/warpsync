import { z } from 'zod';

// ServerProfile validation schemas
export const ServerProfileCreateSchema = z.object({
  name: z.string()
    .min(2, 'Name must be at least 2 characters')
    .max(100, 'Name cannot exceed 100 characters')
    .regex(/^[a-zA-Z0-9\s\-_]+$/, 'Name can only contain letters, numbers, spaces, hyphens, and underscores'),
  
  address: z.string()
    .min(1, 'Address is required')
    .refine((address) => {
      const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
      const hostnameRegex = /^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)*$/;
      return ipRegex.test(address) || hostnameRegex.test(address);
    }, 'Please provide a valid IP address or hostname'),
  
  port: z.number()
    .int('Port must be an integer')
    .min(1, 'Port must be between 1 and 65535')
    .max(65535, 'Port must be between 1 and 65535')
    .default(22),
  
  user: z.string()
    .min(1, 'Username is required')
    .max(50, 'Username cannot exceed 50 characters'),
  
  authMethod: z.enum(['password', 'key']),
  
  password: z.string().optional(),
  
  privateKey: z.string().optional(),
  
  deluge: z.object({
    host: z.string().min(1, 'Deluge host is required'),
    port: z.number()
      .int('Deluge port must be an integer')
      .min(1, 'Deluge port must be between 1 and 65535')
      .max(65535, 'Deluge port must be between 1 and 65535')
      .default(58846),
    username: z.string().min(1, 'Deluge username is required'),
    password: z.string().min(1, 'Deluge password is required')
  }).optional()
}).refine((data) => {
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

export const ServerProfileUpdateSchema = ServerProfileCreateSchema.partial().refine((data) => {
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

// SyncJob validation schemas
export const SyncJobCreateSchema = z.object({
  name: z.string()
    .min(2, 'Name must be at least 2 characters')
    .max(100, 'Name cannot exceed 100 characters')
    .regex(/^[a-zA-Z0-9\s\-_]+$/, 'Name can only contain letters, numbers, spaces, hyphens, and underscores'),
  
  enabled: z.boolean().default(true),
  
  serverProfileId: z.string()
    .min(1, 'Server profile is required')
    .regex(/^[0-9a-fA-F]{24}$/, 'Invalid server profile ID format'),
  
  remotePath: z.string()
    .min(1, 'Remote path is required')
    .regex(/^\/[a-zA-Z0-9\/_\-.\s]*$/, 'Remote path must be an absolute Unix path'),
  
  localPath: z.string()
    .min(1, 'Local path is required')
    .refine((path) => {
      // Validate absolute path (Unix or Windows)
      return /^(\/[a-zA-Z0-9\/_\-.\s]*|[a-zA-Z]:\\[a-zA-Z0-9\\_\-.\s\\]*)$/.test(path);
    }, 'Local path must be an absolute path'),
  
  chmod: z.string()
    .regex(/^[0-7]{3,4}$/, 'Chmod must be a valid octal permission mode (e.g., 755, 644)')
    .default('755'),
  
  scanInterval: z.number()
    .int('Scan interval must be an integer')
    .min(5, 'Scan interval must be at least 5 minutes')
    .max(10080, 'Scan interval cannot exceed 10080 minutes (1 week)')
    .default(60),
  
  autoQueue: z.object({
    enabled: z.boolean().default(false),
    patterns: z.array(z.string().min(1, 'Pattern cannot be empty')).default([]),
    excludePatterns: z.array(z.string()).default([])
  }).optional(),
  
  delugeAction: z.object({
    action: z.enum(['none', 'remove', 'remove_data', 'set_label']).default('none'),
    delay: z.number()
      .int('Delay must be an integer')
      .min(0, 'Delay must be 0 or greater')
      .max(1440, 'Delay cannot exceed 1440 minutes (24 hours)')
      .default(15),
    label: z.string()
      .max(50, 'Label cannot exceed 50 characters')
      .optional()
  }).optional().refine((data) => {
    if (!data) return true;
    if (data.action === 'set_label' && !data.label) {
      return false;
    }
    return true;
  }, {
    message: 'Label is required when action is set_label',
    path: ['label']
  }),
  
  parallelism: z.object({
    maxConcurrentTransfers: z.number()
      .int('Max concurrent transfers must be an integer')
      .min(1, 'Max concurrent transfers must be at least 1')
      .max(10, 'Max concurrent transfers cannot exceed 10')
      .default(3),
    maxConnectionsPerTransfer: z.number()
      .int('Max connections per transfer must be an integer')
      .min(1, 'Max connections per transfer must be at least 1')
      .max(20, 'Max connections per transfer cannot exceed 20')
      .default(5)
  }).optional()
});

export const SyncJobUpdateSchema = SyncJobCreateSchema.partial();

// FileState validation schemas
export const FileStateActionSchema = z.object({
  action: z.enum(['queue', 'deleteLocal', 'deleteRemote', 'deleteEverywhere']),
  fileIds: z.array(z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid file ID format'))
    .min(1, 'At least one file ID is required')
    .max(100, 'Cannot process more than 100 files at once')
});

// Query parameter validation schemas
export const PaginationSchema = z.object({
  page: z.string()
    .regex(/^\d+$/, 'Page must be a positive integer')
    .transform(Number)
    .refine(n => n >= 1, 'Page must be at least 1')
    .default(1),
  limit: z.string()
    .regex(/^\d+$/, 'Limit must be a positive integer')
    .transform(Number)
    .refine(n => n >= 1 && n <= 100, 'Limit must be between 1 and 100')
    .default(20)
});

export const FileFilterSchema = z.object({
  syncState: z.enum(['synced', 'remote_only', 'local_only', 'desynced', 'queued', 'transferring', 'failed'])
    .or(z.array(z.enum(['synced', 'remote_only', 'local_only', 'desynced', 'queued', 'transferring', 'failed'])))
    .optional(),
  filename: z.string().optional(),
  search: z.string().optional(),
  minSize: z.string().regex(/^\d+$/, 'Min size must be a positive integer').transform(Number).optional(),
  maxSize: z.string().regex(/^\d+$/, 'Max size must be a positive integer').transform(Number).optional(),
  addedAfter: z.string().datetime().optional(),
  addedBefore: z.string().datetime().optional(),
  sortBy: z.enum(['relativePath', 'filename', 'addedAt', 'lastSeen', 'remote.size']).default('relativePath'),
  sortOrder: z.enum(['asc', 'desc']).default('asc')
}).merge(PaginationSchema);

export const ServerFilterSchema = z.object({
  name: z.string().optional(),
  address: z.string().optional(),
  enabled: z.string()
    .regex(/^(true|false)$/, 'Enabled must be true or false')
    .transform(value => value === 'true')
    .optional(),
  sortBy: z.enum(['name', 'address', 'createdAt', 'updatedAt']).default('name'),
  sortOrder: z.enum(['asc', 'desc']).default('asc')
}).merge(PaginationSchema);

export const JobFilterSchema = z.object({
  name: z.string().optional(),
  search: z.string().optional(),
  enabled: z.string()
    .regex(/^(true|false)$/, 'Enabled must be true or false')
    .transform(value => value === 'true')
    .optional(),
  serverProfileId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid server profile ID format').optional(),
  sortBy: z.enum(['name', 'enabled', 'lastScan', 'createdAt', 'updatedAt']).default('name'),
  sortOrder: z.enum(['asc', 'desc']).default('asc')
}).merge(PaginationSchema);

// API Response schemas
export const ApiSuccessResponseSchema = z.object({
  success: z.literal(true),
  data: z.any(),
  pagination: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    totalPages: z.number()
  }).optional(),
  timestamp: z.string()
});

export const ApiErrorResponseSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.any().optional()
  }),
  timestamp: z.string()
});

// Connection test schema
export const ConnectionTestSchema = z.object({
  timeout: z.number()
    .int('Timeout must be an integer')
    .min(1000, 'Timeout must be at least 1000ms')
    .max(30000, 'Timeout cannot exceed 30000ms')
    .default(10000)
    .optional()
});

// Type exports for TypeScript usage
export type ServerProfileCreate = z.infer<typeof ServerProfileCreateSchema>;
export type ServerProfileUpdate = z.infer<typeof ServerProfileUpdateSchema>;
export type SyncJobCreate = z.infer<typeof SyncJobCreateSchema>;
export type SyncJobUpdate = z.infer<typeof SyncJobUpdateSchema>;
export type FileStateAction = z.infer<typeof FileStateActionSchema>;
export type PaginationParams = z.infer<typeof PaginationSchema>;
export type FileFilterParams = z.infer<typeof FileFilterSchema>;
export type ServerFilterParams = z.infer<typeof ServerFilterSchema>;
export type JobFilterParams = z.infer<typeof JobFilterSchema>;
export type ConnectionTestParams = z.infer<typeof ConnectionTestSchema>;
export type ApiSuccessResponse = z.infer<typeof ApiSuccessResponseSchema>;
export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;
