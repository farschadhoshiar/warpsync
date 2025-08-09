/**
 * Socket.IO Event Schemas and Payload Validation
 *
 * This file contains Zod schemas and TypeScript utilities for validating
 * Socket.IO event payloads at runtime. These ensure type safety and data
 * integrity for all WebSocket communications.
 */

import { z } from "zod";

/**
 * Base event schema with common fields
 */
export const BaseEventSchema = z.object({
  timestamp: z.number().optional(),
  eventId: z.string().optional(),
});

/**
 * Job event schemas
 */
export const JobProgressSchema = BaseEventSchema.extend({
  jobId: z.string(),
  transferId: z.string().optional(),
  fileId: z.string().optional(),
  progress: z.number().min(0).max(100).optional(),
  percentage: z.number().min(0).max(100).optional(),
  speed: z.string().optional(),
  eta: z.string().optional(),
  bytesTransferred: z.number().nonnegative().optional(),
  totalBytes: z.number().nonnegative().optional(),
  currentFile: z.string().optional(),
});

export const JobStatusSchema = BaseEventSchema.extend({
  jobId: z.string(),
  status: z.union([
    z.literal("pending"),
    z.literal("running"),
    z.literal("completed"),
    z.literal("failed"),
    z.literal("paused"),
  ]),
  message: z.string().optional(),
  details: z.record(z.string(), z.any()).optional(),
});

export const JobErrorSchema = BaseEventSchema.extend({
  jobId: z.string(),
  type: z.union([
    z.literal("validation"),
    z.literal("transfer"),
    z.literal("connection"),
    z.literal("system"),
    z.literal("unknown"),
  ]),
  message: z.string(),
  details: z
    .object({
      code: z.string().optional(),
      stack: z.string().optional(),
      context: z.record(z.string(), z.any()).optional(),
    })
    .optional(),
});

export const JobCompleteSchema = BaseEventSchema.extend({
  jobId: z.string(),
  success: z.boolean(),
  stats: z
    .object({
      totalFiles: z.number().nonnegative().optional(),
      totalBytes: z.number().nonnegative().optional(),
      duration: z.number().nonnegative().optional(),
      averageSpeed: z.string().optional(),
    })
    .optional(),
  message: z.string().optional(),
});

/**
 * Server event schemas
 */
export const ServerStatusSchema = BaseEventSchema.extend({
  serverId: z.string(),
  status: z.union([
    z.literal("online"),
    z.literal("offline"),
    z.literal("maintenance"),
    z.literal("error"),
  ]),
  uptime: z.number().nonnegative().optional(),
  lastSeen: z.string().optional(),
  message: z.string().optional(),
});

export const ServerMetricsSchema = BaseEventSchema.extend({
  serverId: z.string(),
  metrics: z.object({
    cpu: z.number().min(0).max(100).optional(),
    memory: z.number().min(0).max(100).optional(),
    disk: z.number().min(0).max(100).optional(),
    network: z
      .object({
        bytesIn: z.number().nonnegative().optional(),
        bytesOut: z.number().nonnegative().optional(),
      })
      .optional(),
    activeConnections: z.number().nonnegative().optional(),
    activeTransfers: z.number().nonnegative().optional(),
  }),
});

export const ServerAlertSchema = BaseEventSchema.extend({
  serverId: z.string(),
  level: z.union([
    z.literal("info"),
    z.literal("warning"),
    z.literal("error"),
    z.literal("critical"),
  ]),
  message: z.string(),
  alertType: z.union([
    z.literal("performance"),
    z.literal("security"),
    z.literal("system"),
    z.literal("network"),
  ]),
  details: z.record(z.string(), z.any()).optional(),
});

/**
 * Room event schemas
 */
export const RoomJoinedSchema = z.object({
  roomName: z.string(),
  jobId: z.string().optional(),
  serverId: z.string().optional(),
  type: z.string(),
});

export const RoomErrorSchema = z.object({
  message: z.string(),
  jobId: z.string().optional(),
  type: z.string(),
});

/**
 * Event schema map for runtime validation
 */
export const EventSchemaMap = {
  "job:progress": JobProgressSchema,
  "job:status": JobStatusSchema,
  "job:error": JobErrorSchema,
  "job:complete": JobCompleteSchema,
  "server:status": ServerStatusSchema,
  "server:metrics": ServerMetricsSchema,
  "server:alert": ServerAlertSchema,
  "room:joined": RoomJoinedSchema,
  "room:error": RoomErrorSchema,
} as const;

/**
 * Type inference helpers
 */
export type JobProgressPayload = z.infer<typeof JobProgressSchema>;
export type JobStatusPayload = z.infer<typeof JobStatusSchema>;
export type JobErrorPayload = z.infer<typeof JobErrorSchema>;
export type JobCompletePayload = z.infer<typeof JobCompleteSchema>;
export type ServerStatusPayload = z.infer<typeof ServerStatusSchema>;
export type ServerMetricsPayload = z.infer<typeof ServerMetricsSchema>;
export type ServerAlertPayload = z.infer<typeof ServerAlertSchema>;
export type RoomJoinedPayload = z.infer<typeof RoomJoinedSchema>;
export type RoomErrorPayload = z.infer<typeof RoomErrorSchema>;

/**
 * Event validation utility
 */
export function validateEventPayload<T extends keyof typeof EventSchemaMap>(
  eventType: T,
  payload: unknown,
): payload is z.infer<(typeof EventSchemaMap)[T]> {
  try {
    const schema = EventSchemaMap[eventType];
    schema.parse(payload);
    return true;
  } catch (error) {
    console.warn(`Invalid payload for event ${eventType}:`, error);
    return false;
  }
}

/**
 * Safe event payload parser
 */
export function parseEventPayload<T extends keyof typeof EventSchemaMap>(
  eventType: T,
  payload: unknown,
): any | null {
  try {
    const schema = EventSchemaMap[eventType];
    return schema.parse(payload);
  } catch (error) {
    console.error(`Failed to parse payload for event ${eventType}:`, error);
    return null;
  }
}

/**
 * Event type guards
 */
export const isJobProgressPayload = (
  data: unknown,
): data is JobProgressPayload => validateEventPayload("job:progress", data);

export const isJobStatusPayload = (data: unknown): data is JobStatusPayload =>
  validateEventPayload("job:status", data);

export const isJobErrorPayload = (data: unknown): data is JobErrorPayload =>
  validateEventPayload("job:error", data);

export const isJobCompletePayload = (
  data: unknown,
): data is JobCompletePayload => validateEventPayload("job:complete", data);

export const isServerStatusPayload = (
  data: unknown,
): data is ServerStatusPayload => validateEventPayload("server:status", data);

export const isServerMetricsPayload = (
  data: unknown,
): data is ServerMetricsPayload => validateEventPayload("server:metrics", data);

export const isServerAlertPayload = (
  data: unknown,
): data is ServerAlertPayload => validateEventPayload("server:alert", data);
