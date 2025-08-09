/**
 * Validation utilities for ObjectId and jobId formats
 */

/**
 * Validates if a string is a valid MongoDB ObjectId format
 * @param id - The string to validate
 * @returns boolean indicating if the string is a valid ObjectId
 */
export function isValidObjectId(id: string): boolean {
  if (!id || typeof id !== 'string') {
    return false;
  }
  return /^[a-f\d]{24}$/i.test(id);
}

/**
 * Validates if a string is a valid jobId (ObjectId or special cases like "all")
 * @param jobId - The jobId to validate
 * @returns boolean indicating if the jobId is valid
 */
export function isValidJobId(jobId: string): boolean {
  if (!jobId || typeof jobId !== 'string') {
    return false;
  }

  // Allow special cases
  const specialCases = ['all', 'unknown'];
  if (specialCases.includes(jobId.toLowerCase())) {
    return true;
  }

  // Otherwise must be a valid ObjectId
  return isValidObjectId(jobId);
}

/**
 * Validates if a string is a valid serverId (must be ObjectId)
 * @param serverId - The serverId to validate
 * @returns boolean indicating if the serverId is valid
 */
export function isValidServerId(serverId: string): boolean {
  return isValidObjectId(serverId);
}

/**
 * Gets the room name for a given serverId
 * @param serverId - The serverId
 * @returns The room name or null if invalid
 */
export function getServerRoomName(serverId: string): string | null {
  if (!isValidServerId(serverId)) {
    return null;
  }
  return `server:${serverId}`;
}

/**
 * Extracts the ID from a room name
 * @param roomName - The room name (e.g., "job:60a7c8b5f4e1234567890abc")
 * @returns The extracted ID or null if invalid format
 */
export function extractIdFromRoomName(roomName: string): string | null {
  if (!roomName || typeof roomName !== 'string') {
    return null;
  }

  const match = roomName.match(/^(job|server):(.+)$/);
  return match ? match[2] : null;
}

/**
 * Gets the room type from a room name
 * @param roomName - The room name (e.g., "job:60a7c8b5f4e1234567890abc")
 * @returns The room type ('job' | 'server') or null if invalid
 */
export function getRoomType(roomName: string): 'job' | 'server' | null {
  if (!roomName || typeof roomName !== 'string') {
    return null;
  }

  const match = roomName.match(/^(job|server):.+$/);
  return match ? (match[1] as 'job' | 'server') : null;
}
