# Use the official Node.js runtime as the base image
FROM node:20-alpine

# Install system dependencies required for WarpSync
RUN apk add --no-cache \
    rsync \
    openssh-client \
    bash \
    curl

# Set the working directory in the container
WORKDIR /app

# Copy package.json and package-lock.json (if available)
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy the rest of the application code
COPY . .

# Create a non-root user for security
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nextjs -u 1001

# Set ownership of the app directory to the nodejs user
RUN chown -R nextjs:nodejs /app
USER nextjs

# Build the Next.js application
RUN npm run build

# Expose the port the app runs on
EXPOSE 3000

# Define environment variable
ENV NODE_ENV=production

# Start the application
CMD ["npm", "start"]
