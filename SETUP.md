# WarpSync Setup Guide

## Phase 1 Completed ✅

The following components have been successfully set up:

### 1. Next.js Project with TypeScript ✅
- ✅ Project initialized with `create-next-app`
- ✅ TypeScript configuration with `@/*` import alias
- ✅ Tailwind CSS integration
- ✅ ESLint configuration
- ✅ App Router structure

### 2. Shadcn/ui Component Library ✅
- ✅ Shadcn/ui initialized with Neutral color scheme
- ✅ Core dependencies installed: `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`
- ✅ Essential components added: Button, Input, Card, Dialog, Alert
- ✅ Utils library created at `src/lib/utils.ts`

### 3. MongoDB Database Connection ✅
- ✅ Mongoose ODM installed and configured
- ✅ Database connection utility created at `src/lib/mongodb.ts`
- ✅ Environment variables configured in `.env.local`
- ✅ Connection caching and error handling implemented

### 4. Docker Development Environment ✅
- ✅ Production Dockerfile with system dependencies (rsync, openssh-client)
- ✅ Development Dockerfile with hot reload support
- ✅ Docker Compose configuration with MongoDB service
- ✅ Volume mounts for file synchronization directories
- ✅ MongoDB initialization script for database setup
- ✅ Proper networking and security configuration

## Project Structure

```
warpsync/
├── src/
│   ├── app/                 # Next.js App Router
│   ├── components/
│   │   └── ui/             # Shadcn/ui components
│   └── lib/
│       ├── mongodb.ts      # Database connection
│       └── utils.ts        # Utility functions
├── docker/
│   └── mongo-init/         # MongoDB initialization
├── data/                   # File sync directories
│   ├── local/              # Local files
│   └── remote/             # Remote files
├── logs/                   # Application logs
├── Dockerfile              # Production container
├── Dockerfile.dev          # Development container
├── docker-compose.yml      # Container orchestration
└── .env.local             # Environment variables
```

## Quick Start

### Development Mode
```bash
# Start the development server locally
npm run dev

# Or use Docker for development
docker compose up app-dev
```

### Production Mode
```bash
# Build and start with Docker
docker compose up app
```

## Next Steps - Phase 2

The following tasks are ready for implementation:

1. **Database Models and Schemas**
   - ServerProfile Mongoose Schema
   - SyncJob Mongoose Schema  
   - FileState Mongoose Schema
   - Database initialization script

2. **API Routes Development**
   - Server Profile endpoints
   - Sync Job endpoints
   - File State endpoints
   - Authentication middleware

## Environment Variables

Copy `.env.example` to `.env.local` and configure:

```env
MONGODB_URI=mongodb://127.0.0.1:27017/warpsync
NEXTAUTH_SECRET=your-secret-key-here
NEXTAUTH_URL=http://localhost:3000
NODE_ENV=development
```

## System Requirements

- Node.js 20+
- Docker & Docker Compose
- MongoDB (via Docker or local installation)
- System dependencies: rsync, openssh-client (handled in Docker)

Phase 1 setup is complete and ready for Phase 2 implementation! 🚀
