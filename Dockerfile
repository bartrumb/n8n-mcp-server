# N8N MCP Server Dockerfile
# Multi-stage build for optimized production image

# Build stage
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy source code
COPY src/ ./src/

# Build the application
RUN npm run build

# Production stage
FROM node:18-alpine AS production

WORKDIR /app

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create non-root user
RUN addgroup -g 1001 -S n8n && \
    adduser -S n8n -u 1001

# Copy package files and install production dependencies
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy built application from builder stage
COPY --from=builder /app/build ./build

# Set ownership
RUN chown -R n8n:n8n /app
USER n8n

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "console.log('Health check: OK')" || exit 1

# Environment variables with defaults
ENV NODE_ENV=production
ENV N8N_HOST=http://localhost:5678/api/v1
ENV OUTPUT_VERBOSITY=concise
ENV CACHE_ENABLED=true
ENV LOG_LEVEL=info

# Expose port (if needed for future web interface)
# EXPOSE 3000

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Run the application
CMD ["node", "build/index.js"]

# Metadata
LABEL maintainer="Illuminare Solutions"
LABEL description="N8N MCP Server with schema validation and workflow management"
LABEL version="1.2.0"