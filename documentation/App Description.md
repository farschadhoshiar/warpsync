WarpSync is a self-hosted, web-based application designed for robust and high-performance file synchronization between a local server and one or more remote servers. It provides a clean, modern user interface to manage, monitor, and automate large-scale data transfers, making it an ideal open-source alternative to tools like SeedSync or Resilio Sync.

The primary goal is to offer a reliable solution for power users, media enthusiasts, and data hoarders who need to efficiently pull large files (100GB+) from remote sources (like seedboxes or cloud servers) to their local storage (like a NAS or home server) without overwhelming system resources like RAM.
Key Features
1. Connection Management

    Multiple Server Profiles: Configure and save connection details for multiple remote servers.

    Flexible Remote Server Authentication: Connect using standard SSH ports or specify alternative ports. Supports both password-based and more secure public key-based authentication for connecting to remote servers.

    Connection Testing: A simple "Test Connection" button to verify credentials and paths before saving a server profile.

2. Core Synchronization & Transfer

    High-Performance Engine: Utilizes rsync as the backend transfer protocol, ensuring efficient delta-copying (only transferring changed parts of files) and low RAM usage, even for massive files.

    Directory Pairing: Define "sync jobs" by pairing a remote server directory with a local destination directory.

    Intelligent Conflict Handling: Before transferring, the system checks if a file or folder already exists at the destination to prevent accidental overwrites. (Future versions can add more complex rules).

    Post-Transfer Permissions: Automatically run a chmod command on newly transferred files and folders at the destination to ensure consistent permissions (e.g., for media server access).

    Parallelism Control: Fine-tune performance by setting the maximum number of parallel downloads and connections per transfer, similar to lftp/SeedSync.

3. File & Job Management

    Comprehensive Directory View: The UI provides a complete, unified view of all files in both the remote source and local destination directories. The system scans both locations and compares them, assigning a clear status to every file: Synced, Remote Only, Local Only, Desynced, Queued, Transferring, or Failed.

    Powerful Filtering: Users can instantly filter the file list by these statuses to easily manage their data (e.g., view all files that exist remotely but not locally).

    Granular Control: For any file listed, users have clear options to:

        Delete Locally: Remove the file from the local destination.

        Delete Remotely: Remove the file from the remote source.

        Delete Everywhere: Remove the file from both locations.

    AutoQueue & Pattern Matching: Optionally monitor a remote directory and automatically queue new Remote Only files for download. This can be restricted to files matching specific name patterns (e.g., *.mkv, *S01E*).

    Auto-Extraction (Future Goal): Automatically extract compressed archives (.rar, .zip, .7z) after they are successfully downloaded.

4. Automation & Monitoring

    Custom Scan Intervals: Define how frequently WarpSync should perform its full remote/local scan and reconciliation.

    Real-Time Logging: View a live log output for any active rsync process to diagnose issues or monitor progress in detail.

    Large File Transfer Monitoring: The UI will display the real-time transfer progress for individual large files (percentage, speed, ETA).

    Debug Mode: An option to enable more verbose logging for troubleshooting.

    Retry Failed Transfers: The system can be configured to automatically retry failed transfers a set number of times with a delay, making it more resilient to network issues.

5. Deluge Integration (Post-Sync Automation)

    Deluge Connection Settings: Within a server profile, users can optionally add connection details for a Deluge daemon running on that server (host, port, username, password).

    Post-Transfer Actions: For each sync job, users can define an action to be automatically triggered in Deluge after the files have been successfully transferred by rsync.

    Available Actions:

        Do Nothing: Default behavior.

        Remove Torrent: Removes the torrent from the Deluge client but leaves the data intact.

        Remove Torrent and Data: Completely removes the torrent and all associated data from the remote server.

        Set Label/Category: Changes the label or category of the torrent in Deluge.

    Configurable Delay Timer: Set a grace period (e.g., 15 minutes) between a successful transfer and the execution of the Deluge action.

Tech Stack & Architecture

This project will use a simplified, unified architecture, with the database running as a separate service.

    Framework: Next.js (with TypeScript)

        Why: Next.js is a full-stack React framework that handles both the frontend UI and the backend API logic in a single, cohesive application. This simplifies the development process, reduces boilerplate, and eliminates the need for a monorepo. We will use its API Routes feature to build the backend and its powerful React capabilities with Shadcn/ui for the frontend.

    UI Components: Shadcn/ui

        Why: It provides beautifully designed, accessible, and unstyled components (built with Radix UI and Tailwind CSS) that you copy into your project. This gives us complete control over styling and avoids heavy dependencies, resulting in a fast and lightweight frontend.

    Database: MongoDB

        Why: MongoDB's flexible, document-based structure is a natural fit for storing our data. It will run in its own container, separate from the main application.

        ODM: Mongoose will be used within the Next.js API routes to model and interact with the MongoDB database in a structured and type-safe way.

    Deployment: Docker

        Why: The entire application stack will be managed with docker-compose.

        The App Container: A single Dockerfile will build the Next.js application and install system dependencies like rsync and openssh-client.

        The Database Container: A separate, standard mongo image will be used for the database.

Database Models & API Routes

The data structures remain the same, but the API will be built using Next.js API Routes (e.g., in the /app/api directory).
1. MongoDB Schemas (Mongoose Models)

Example Database Schemes:

Syncjob:

{
  "_id": {
    "$oid": "6894d46ffc0e1c22626587b1"
  },
  "name": "Test",
  "enabled": true,
  "serverProfileId": {
    "$oid": "689499ffdc04988a6f160192"
  },
  "remotePath": "/media/Downloads/completed",
  "localPath": "/data/local",
  "chmod": "755",
  "scanInterval": 3600,
  "autoQueue": {
    "enabled": false,
    "patterns": [],
    "excludePatterns": []
  },
  "delugeAction": {
    "action": "none",
    "delay": 15
  },
  "parallelism": {
    "maxConcurrentTransfers": 3,
    "maxConnectionsPerTransfer": 5
  },
  "createdAt": {
    "$date": "2025-08-07T16:29:35.142Z"
  },
  "updatedAt": {
    "$date": "2025-08-07T17:45:31.283Z"
  },
  "__v": 0,
  "lastScan": {
    "$date": "2025-08-07T16:31:24.477Z"
  },
  "retrySettings": {
    "maxRetries": 3,
    "retryDelay": 5000
  },
  "syncOptions": {
    "direction": "download",
    "deleteExtraneous": false,
    "preserveTimestamps": true,
    "preservePermissions": true,
    "compressTransfer": true,
    "dryRun": false
  },
  "targetType": "local"
}

serverprofiles:

{
  "_id": {
    "$oid": "689499ffdc04988a6f160192"
  },
  "name": "Deluge Server",
  "address": "193.23.249.116",
  "port": 2222,
  "user": "user",
  "authMethod": "password",
  "password": "VCBv5nnhoz",
  "deluge": {
    "host": "192.168.1.100",
    "port": 58846,
    "username": "deluge",
    "password": "deluge123"
  },
  "createdAt": {
    "$date": "2025-08-07T12:20:15.314Z"
  },
  "updatedAt": {
    "$date": "2025-08-07T19:43:50.996Z"
  },
  "__v": 0
}

filestates:

{
  "_id": {
    "$oid": "6895057576101f3cc4124f69"
  },
  "jobId": {
    "$oid": "6894d46ffc0e1c22626587b1"
  },
  "relativePath": "Family.Guy.S01-S19.1080p.WEB-DL.10bit.x265.HEVC-MiXeD/Season 08",
  "filename": "Season 08",
  "isDirectory": true,
  "parentPath": "Family.Guy.S01-S19.1080p.WEB-DL.10bit.x265.HEVC-MiXeD",
  "remote": {
    "size": 0,
    "modTime": {
      "$date": "2025-08-06T16:22:33.823Z"
    },
    "exists": true,
    "isDirectory": true
  },
  "local": {
    "exists": false,
    "isDirectory": false
  },
  "syncState": "remote_only",
  "transfer": {
    "progress": 0,
    "retryCount": 0
  },
  "directorySize": 7225064104,
  "fileCount": 20,
  "lastSeen": {
    "$date": "2025-08-07T19:58:45.253Z"
  },
  "addedAt": {
    "$date": "2025-08-07T19:58:45.253Z"
  },
  "__v": 0
}



