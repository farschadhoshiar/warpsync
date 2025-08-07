/**
 * Debug script to test FileScanner functionality
 */

import connectDB from '../lib/mongodb';
import { FileScanner } from '../lib/scanner/file-scanner';

async function testFileScanner() {
  try {
    console.log('Testing FileScanner...');
    
    // Connect to database
    await connectDB();
    console.log('Database connected');
    
    // Get models
    const { SyncJob } = await import('../models');
    console.log('Models imported');
    
    // Find a sync job to test with
    const syncJob = await SyncJob.findOne().populate('serverProfileId');
    
    if (!syncJob) {
      console.log('No sync job found in database');
      return;
    }
    
    console.log('Found sync job:', syncJob.name);
    console.log('Server profile:', syncJob.serverProfileId?.name);
    
    if (!syncJob.serverProfileId) {
      console.log('No server profile found');
      return;
    }
    
    // Create FileScanner
    const fileScanner = new FileScanner();
    console.log('FileScanner created');
    
    // Test SSH config
    const sshConfig = {
      id: `${syncJob.serverProfileId._id}`,
      name: syncJob.serverProfileId.name,
      host: syncJob.serverProfileId.address,
      port: syncJob.serverProfileId.port,
      username: syncJob.serverProfileId.user,
      ...(syncJob.serverProfileId.authMethod === 'password' 
        ? { password: syncJob.serverProfileId.password }
        : { privateKey: syncJob.serverProfileId.privateKey }
      )
    };
    
    console.log('SSH Config:', {
      host: sshConfig.host,
      port: sshConfig.port,
      username: sshConfig.username,
      authMethod: syncJob.serverProfileId.authMethod
    });
    
    // Try the scan
    console.log('Starting scan...');
    const result = await fileScanner.compareDirectories(
      syncJob._id.toString(),
      sshConfig,
      syncJob.remotePath,
      syncJob.localPath
    );
    
    console.log('Scan completed successfully!');
    console.log('Stats:', result.stats);
    
  } catch (error) {
    console.error('Error during test:', error);
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
    }
  }
  
  process.exit(0);
}

testFileScanner();
