// MongoDB initialization script for WarpSync
db = db.getSiblingDB('warpsync');

// Create collections if they don't exist
db.createCollection('serverprofiles');
db.createCollection('syncjobs');
db.createCollection('filestates');

// Create indexes for performance
db.serverprofiles.createIndex({ "name": 1 });
db.syncjobs.createIndex({ "serverProfileId": 1 });
db.syncjobs.createIndex({ "enabled": 1 });
db.filestates.createIndex({ "jobId": 1 });
db.filestates.createIndex({ "syncState": 1 });
db.filestates.createIndex({ "relativePath": 1 });

// Create a default admin user (optional)
// You can remove this if you don't need a default user
db.users.insertOne({
  username: 'admin',
  email: 'admin@warpsync.local',
  role: 'admin',
  createdAt: new Date(),
  updatedAt: new Date()
});

print('WarpSync database initialized successfully!');
