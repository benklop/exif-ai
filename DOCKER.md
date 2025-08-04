# Docker Deployment Guide

This guide explains how to deploy Exif AI using Docker.

## Quick Start

### Using GitHub Container Registry (Recommended)

```bash
# Pull the latest image
docker pull ghcr.io/benklop/exif-ai:latest

# Run with default settings (Ollama provider)
docker run -p 3000:3000 ghcr.io/benklop/exif-ai:latest

# Run with OpenAI provider
docker run -p 3000:3000 \
  -e EXIF_AI_PROVIDER=openai \
  -e OPENAI_API_KEY=your_api_key \
  ghcr.io/benklop/exif-ai:latest
```

### Using Docker Compose

```bash
# Clone the repository
git clone https://github.com/benklop/exif-ai.git
cd exif-ai

# Copy and configure environment
cp .env.example .env
# Edit .env with your settings

# Start the services
docker-compose up -d
```

## Available Images

| Registry | Image | Description |
|----------|--------|-------------|
| GitHub Container Registry | `ghcr.io/benklop/exif-ai` | Official builds from main branch |
| Docker Hub | `benklop/exif-ai` | Mirror of GHCR images |

### Tags

- `latest` - Latest stable build from main branch
- `main` - Latest build from main branch (same as latest)
- `v*.*.*` - Specific version tags
- `main-<sha>` - Specific commit builds

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `EXIF_AI_PROVIDER` | `ollama` | AI provider |
| `EXIF_AI_MODEL` | Provider default | AI model |
| `EXIF_AI_TASKS` | `description,tag` | Tasks to perform |
| `EXIF_AI_VERBOSE` | `false` | Enable verbose logging |

### Provider-Specific Variables

**OpenAI:**
```bash
EXIF_AI_PROVIDER=openai
OPENAI_API_KEY=your_api_key
EXIF_AI_MODEL=gpt-4o
```

**Google Gemini:**
```bash
EXIF_AI_PROVIDER=google
GOOGLE_API_KEY=your_api_key
EXIF_AI_MODEL=gemini-1.5-pro
```

**Anthropic Claude:**
```bash
EXIF_AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=your_api_key
EXIF_AI_MODEL=claude-3-5-sonnet-20241022
```

**Ollama (Local):**
```bash
EXIF_AI_PROVIDER=ollama
OLLAMA_BASE_URL=http://host.docker.internal:11434
EXIF_AI_MODEL=llama3.2-vision
```

## Docker Compose Examples

### Basic Setup

```yaml
version: '3.8'
services:
  exif-ai:
    image: ghcr.io/benklop/exif-ai:latest
    ports:
      - "3000:3000"
    environment:
      - EXIF_AI_PROVIDER=ollama
      - EXIF_AI_MODEL=llama3.2-vision
    restart: unless-stopped
```

### With Ollama Service

```yaml
version: '3.8'
services:
  exif-ai:
    image: ghcr.io/benklop/exif-ai:latest
    ports:
      - "3000:3000"
    environment:
      - EXIF_AI_PROVIDER=ollama
      - OLLAMA_BASE_URL=http://ollama:11434
      - EXIF_AI_MODEL=llama3.2-vision
    depends_on:
      - ollama
    restart: unless-stopped

  ollama:
    image: ollama/ollama:latest
    ports:
      - "11434:11434"
    volumes:
      - ollama_data:/root/.ollama
    restart: unless-stopped

volumes:
  ollama_data:
```

### Production Setup with Nginx

```yaml
version: '3.8'
services:
  exif-ai:
    image: ghcr.io/benklop/exif-ai:latest
    environment:
      - EXIF_AI_PROVIDER=openai
      - OPENAI_API_KEY=${OPENAI_API_KEY}
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - ./ssl:/etc/nginx/ssl
    depends_on:
      - exif-ai
    restart: unless-stopped
```

## Building from Source

```bash
# Clone the repository
git clone https://github.com/benklop/exif-ai.git
cd exif-ai

# Build the image
docker build -t exif-ai .

# Run the built image
docker run -p 3000:3000 exif-ai
```

## Health Checks

The container includes built-in health checks:

```bash
# Check container health
docker ps --format "table {{.Names}}\t{{.Status}}"

# View health check logs
docker inspect --format='{{json .State.Health}}' <container-name>
```

## Troubleshooting

### Common Issues

1. **Permission denied errors**
   - The container runs as non-root user `exifai` (uid: 1001)
   - Ensure mounted volumes have correct permissions

2. **Out of memory errors**
   - Large images may require more memory
   - Increase Docker memory limits or use smaller images

3. **Network connectivity issues**
   - For Ollama: Use `host.docker.internal` on Docker Desktop
   - For cloud providers: Ensure correct API keys are set

### Logs

```bash
# View container logs
docker logs <container-name>

# Follow logs in real-time
docker logs -f <container-name>

# View logs with timestamps
docker logs -t <container-name>
```

### Debug Mode

```bash
# Run with verbose logging
docker run -p 3000:3000 \
  -e EXIF_AI_VERBOSE=true \
  ghcr.io/benklop/exif-ai:latest

# Run with shell access
docker run -it --entrypoint /bin/sh ghcr.io/benklop/exif-ai:latest
```

## Security

- Container runs as non-root user
- Uses official Node.js Alpine base image
- Includes security scanning in CI/CD
- Minimal attack surface with .dockerignore

## Performance

### Resource Requirements

| Workload | CPU | Memory | Notes |
|----------|-----|--------|-------|
| Light (< 10 req/min) | 0.1 CPU | 256MB | Basic usage |
| Medium (< 100 req/min) | 0.5 CPU | 512MB | Small business |
| Heavy (> 100 req/min) | 1+ CPU | 1GB+ | High traffic |

### Optimization Tips

1. **Use appropriate AI models**
   - Smaller models = faster processing
   - Local models (Ollama) = no API costs

2. **Configure resource limits**
   ```yaml
   deploy:
     resources:
       limits:
         cpus: '1'
         memory: 1G
       reservations:
         cpus: '0.5'
         memory: 512M
   ```

3. **Enable image caching**
   - Mount volume for temporary files
   - Use CDN for frequently processed images

## Support

- GitHub Issues: https://github.com/benklop/exif-ai/issues
- Documentation: https://github.com/benklop/exif-ai#readme
- Container Registry: https://ghcr.io/benklop/exif-ai
