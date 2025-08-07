/**
 * Test utility for directory statistics calculation
 * Can be used to test the directory stats functionality
 */

import { calculateDirectoryStats, calculateAllDirectoryStats, FileStateRecord } from './directory-stats';

// Sample test data
const testFileStates: FileStateRecord[] = [
  {
    _id: "test1",
    jobId: "job1" as any,
    relativePath: "folder1",
    filename: "folder1",
    isDirectory: true,
    parentPath: "",
    remote: { size: 0, exists: true },
    local: { exists: false },
    directorySize: 0,
    fileCount: 0
  },
  {
    _id: "test2",
    jobId: "job1" as any,
    relativePath: "folder1/file1.txt",
    filename: "file1.txt",
    isDirectory: false,
    parentPath: "folder1",
    remote: { size: 1000, exists: true },
    local: { exists: false },
    directorySize: 0,
    fileCount: 0
  },
  {
    _id: "test3",
    jobId: "job1" as any,
    relativePath: "folder1/file2.txt",
    filename: "file2.txt",
    isDirectory: false,
    parentPath: "folder1",
    remote: { size: 2000, exists: true },
    local: { exists: false },
    directorySize: 0,
    fileCount: 0
  },
  {
    _id: "test4",
    jobId: "job1" as any,
    relativePath: "folder1/subfolder",
    filename: "subfolder",
    isDirectory: true,
    parentPath: "folder1",
    remote: { size: 0, exists: true },
    local: { exists: false },
    directorySize: 0,
    fileCount: 0
  },
  {
    _id: "test5",
    jobId: "job1" as any,
    relativePath: "folder1/subfolder/file3.txt",
    filename: "file3.txt",
    isDirectory: false,
    parentPath: "folder1/subfolder",
    remote: { size: 500, exists: true },
    local: { exists: false },
    directorySize: 0,
    fileCount: 0
  }
];

/**
 * Test the directory statistics calculation
 */
export function testDirectoryStats() {
  console.log('Testing directory statistics calculation...');
  
  // Test single directory calculation
  const folder1Stats = calculateDirectoryStats("folder1", testFileStates);
  console.log('folder1 stats:', folder1Stats);
  // Expected: { directorySize: 3500 (1000+2000+500), fileCount: 4 (2 files + 1 subfolder + 1 file in subfolder) }
  
  const subfolderStats = calculateDirectoryStats("folder1/subfolder", testFileStates);
  console.log('subfolder stats:', subfolderStats);
  // Expected: { directorySize: 500, fileCount: 1 }
  
  // Test all directories calculation
  const allStats = calculateAllDirectoryStats(testFileStates);
  console.log('All directory stats:', allStats);
  
  return {
    folder1Stats,
    subfolderStats,
    allStats
  };
}

// Uncomment to run test
// testDirectoryStats();
