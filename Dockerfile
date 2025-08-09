# Use the official Node.js runtime as the base image
FROM node:20-alpine

# Install system dependencies required for WarpSync
RUN apk add --no-cache \
    rsync \
    openssh-client \
    sshpass \
    bash \
    curl

# Install pnpm globally
RUN npm install -g pnpm

# Set the working directory in the container
WORKDIR /app

# Copy package.json and pnpm-lock.yaml
COPY package.json pnpm-lock.yaml ./

# Install all dependencies (including dev dependencies for build)
RUN pnpm install --frozen-lockfile

# Copy the rest of the application code
COPY . .

# Create a non-root user for security
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nextjs -u 1001

# Build the Next.js application (needs dev dependencies)
RUN pnpm run build

# Remove dev dependencies to reduce image size
RUN pnpm prune --prod

# Set ownership of the app directory to the nodejs user
RUN chown -R nextjs:nodejs /app
USER nextjs

# Expose the port the app runs on
EXPOSE 3000

# Define environment variable
ENV NODE_ENV=production

# Start the application
CMD ["pnpm", "start"]
