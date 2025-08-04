FROM node:20-alpine

# Build arguments for metadata
ARG BUILD_DATE
ARG VCS_REF
ARG VERSION

# Add metadata labels
LABEL org.opencontainers.image.title="Exif AI" \
      org.opencontainers.image.description="AI-powered image metadata generator with HTTP API" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.vendor="exif-ai" \
      org.opencontainers.image.source="https://github.com/tychenjiajun/exif-ai" \
      org.opencontainers.image.documentation="https://github.com/tychenjiajun/exif-ai#readme" \
      org.opencontainers.image.licenses="GPL-2.0-only"

# Set working directory
WORKDIR /app

# Install system dependencies for better compatibility
RUN apk add --no-cache \
    wget \
    curl \
    ca-certificates \
    && rm -rf /var/cache/apk/*

# Copy package files
COPY package*.json ./

# Install dependencies (including dev dependencies for building)
RUN npm ci

# Copy source code
COPY . .

# Build the application
RUN npm run build \
    && npm prune --production \
    && npm cache clean --force

# Create non-root user
RUN addgroup -g 1001 -S nodejs \
    && adduser -S exifai -u 1001

# Change ownership of the app directory
RUN chown -R exifai:nodejs /app
USER exifai

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Start the server
CMD ["npm", "run", "server"]
