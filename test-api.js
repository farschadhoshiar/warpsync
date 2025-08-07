#!/usr/bin/env node

// Simple test script to verify API endpoints work without bundling issues
async function testAPIs() {
  console.log('Testing API endpoints...');
  
  try {
    // Test if we can import the API route modules without bundling errors
    const jobsRoute = await import('./src/app/api/jobs/route.ts');
    console.log('✅ Jobs API module imported successfully');
    
    const serversRoute = await import('./src/app/api/servers/route.ts');
    console.log('✅ Servers API module imported successfully');
    
    // Test if we can import models without SSH bundling issues
    const models = await import('./src/models/index.ts');
    console.log('✅ Models imported successfully');
    
    console.log('✅ All modules imported without bundling errors');
  } catch (error) {
    console.error('❌ Import error:', error.message);
    process.exit(1);
  }
}

testAPIs();
