#!/usr/bin/env node
/**
 * Test script for the SystemValidator
 * Run with: npx tsx src/debug/test-system-validator.ts
 */

import { SystemValidator } from '../lib/rsync/system-validator';

async function testSystemValidator() {
  console.log('🧪 Testing SystemValidator...\n');

  try {
    // Test critical dependencies only
    console.log('1. Testing critical dependencies...');
    const criticalValidation = await SystemValidator.validateCriticalDependencies();
    
    console.log('✅ Critical Dependencies Result:', {
      valid: criticalValidation.valid,
      errors: criticalValidation.errors,
      warnings: criticalValidation.warnings,
      rsyncVersion: criticalValidation.rsyncVersion,
      sshVersion: criticalValidation.sshVersion
    });

    console.log('\n2. Testing full system validation...');
    const fullValidation = await SystemValidator.validateSystem(
      '/tmp/test-source',
      '/tmp/test-destination',
      'example.com',
      {
        checkRsync: true,
        checkSSH: true,
        checkPaths: true,
        checkNetwork: false, // Skip network test to avoid timeouts
        timeoutMs: 5000
      }
    );

    console.log('✅ Full System Validation Result:', {
      valid: fullValidation.valid,
      errors: fullValidation.errors,
      warnings: fullValidation.warnings,
      rsyncVersion: fullValidation.rsyncVersion,
      sshVersion: fullValidation.sshVersion
    });

  } catch (error) {
    console.error('❌ Test failed:', error instanceof Error ? error.message : error);
  }
}

if (require.main === module) {
  testSystemValidator();
}
