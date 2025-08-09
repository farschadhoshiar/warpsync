import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Interface for parsed composite ID results
 */
export interface ParsedCompositeId {
  jobId: string;
  fileId: string;
  isComposite: boolean;
}

/**
 * Validates if a string is a valid MongoDB ObjectId (24 character hex string)
 */
export function isValidObjectId(id: string): boolean {
  return /^[0-9a-fA-F]{24}$/.test(id);
}

/**
 * Parses a composite ID (jobId-fileId) or returns the original ID if not composite
 * @param id - The ID to parse (either composite "jobId-fileId" or single ObjectId)
 * @returns ParsedCompositeId object with jobId, fileId, and isComposite flag
 */
export function parseCompositeId(id: string): ParsedCompositeId {
  // Check if ID contains a hyphen and both parts are valid ObjectIds
  const hyphenIndex = id.indexOf('-');
  
  if (hyphenIndex !== -1) {
    const potentialJobId = id.substring(0, hyphenIndex);
    const potentialFileId = id.substring(hyphenIndex + 1);
    
    // Verify both parts are valid ObjectIds
    if (isValidObjectId(potentialJobId) && isValidObjectId(potentialFileId)) {
      return {
        jobId: potentialJobId,
        fileId: potentialFileId,
        isComposite: true
      };
    }
  }
  
  // Not a composite ID, treat as single fileId
  return {
    jobId: '',
    fileId: id,
    isComposite: false
  };
}

/**
 * Creates a composite ID from jobId and fileId
 * @param jobId - The job ObjectId
 * @param fileId - The file ObjectId
 * @returns Composite ID in format "jobId-fileId"
 */
export function createCompositeId(jobId: string, fileId: string): string {
  return `${jobId}-${fileId}`;
}
