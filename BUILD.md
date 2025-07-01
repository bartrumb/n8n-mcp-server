# Build and Deployment Guide

This guide covers building, testing, and deploying the N8N MCP Server with its new modular architecture.

## 🏗️ Build System Overview

The project uses a modern TypeScript build system with enhanced scripts for development and production deployment.

### Build Architecture

```
src/
├── index.ts                    # Main MCP server entry point
├── schemas.ts                  # Zod schema validation
├── node-validator.ts           # Node type validation with caching
├── config.ts                   # Environment configuration system
├── resource-handlers.ts        # MCP resource endpoints
└── workflow-composition-guide.ts # Comprehensive workflow guidance
```

## 📋 Available Scripts

### Core Scripts
```bash
npm run build          # Clean build with executable permissions
npm run build:watch    # Build in watch mode for development
npm run start          # Start the built server
npm run clean          # Remove build directory
```

### Development Scripts
```bash
npm run dev            # Build and start once
npm run dev:watch      # Start in watch mode (requires nodemon)
npm run lint           # TypeScript type checking
npm run lint:fix       # TypeScript check with success message
```

### Validation & Testing
```bash
npm run validate       # Run lint + build test
npm run test:build     # Test build process
```

### Package Management
```bash
npm run package        # Create npm package
npm run install:global # Install globally for system access
npm run uninstall:global # Remove global installation
```

## 🔧 Development Setup

### Quick Setup
```bash
# Run the development setup script
./setup-dev.sh

# Or manually:
npm install
npm run build
```

### Environment Configuration
Create a `.env` file with your n8n configuration:

```env
# Required
N8N_HOST=http://localhost:5678/api/v1
N8N_API_KEY=your_api_key_here

# Optional
OUTPUT_VERBOSITY=concise
CACHE_ENABLED=true
LOG_LEVEL=info
```

### Development Workflow
1. **Initial setup**: `./setup-dev.sh`
2. **Test connection**: `node scripts/test-connection.js`
3. **Start development**: `npm run dev:watch`
4. **Make changes**: Files rebuild automatically
5. **Validate changes**: `npm run validate`

## 🚀 Production Deployment

### Standard Deployment
```bash
# Run the deployment script
./deploy.sh

# Or manually:
npm run validate
npm run package
```

### Docker Deployment
```bash
# Build Docker image
docker build -t n8n-mcp-server .

# Run with Docker Compose
docker-compose up -d

# Or run directly
docker run -e N8N_API_KEY=your_key -e N8N_HOST=your_host n8n-mcp-server
```

### Global Installation
```bash
npm run install:global
# Now available as: n8n-mcp-server
```

## 🐳 Docker Support

### Docker Build
The project includes multi-stage Docker build for optimized production images:

- **Builder stage**: Compiles TypeScript and installs dependencies
- **Production stage**: Minimal runtime with only production dependencies
- **Security**: Non-root user, proper signal handling with dumb-init
- **Health checks**: Built-in container health monitoring

### Docker Compose
The `docker-compose.yml` provides:
- Complete service orchestration
- Environment variable management
- Network isolation
- Resource limits
- Logging configuration
- Optional n8n service integration

## 🔍 Build Validation

### Validation Checks
The build system includes comprehensive validation:

1. **TypeScript Compilation**: Ensures type safety
2. **Build Test**: Verifies successful compilation
3. **File Integrity**: Checks all required files exist
4. **Dependency Validation**: Ensures all imports resolve

### Running Validation
```bash
# Quick validation
npm run validate

# Full validation with all checks
./deploy.sh --full-check
```

## 📦 Package Structure

### Build Output
```
build/
├── index.js                    # Main executable
├── schemas.js                  # Compiled schema validation
├── node-validator.js           # Compiled node validator
├── config.js                   # Compiled configuration
├── resource-handlers.js        # Compiled resource handlers
└── workflow-composition-guide.js # Compiled workflow guide
```

### Package Contents
- `build/` - Compiled JavaScript
- `package.json` - Package metadata
- `README.md` - Usage documentation
- `LICENSE` - MIT license

## 🔧 Troubleshooting

### Common Issues

**Build Fails**
```bash
# Clear cache and rebuild
npm run clean
npm install
npm run build
```

**TypeScript Errors**
```bash
# Check for type issues
npm run lint
```

**Permission Issues**
```bash
# Fix executable permissions
chmod +x build/index.js
chmod +x deploy.sh
chmod +x setup-dev.sh
```

**Docker Build Issues**
```bash
# Build with no cache
docker build --no-cache -t n8n-mcp-server .
```

### Performance Optimization

**Build Speed**
- Use `npm run build:watch` for incremental builds
- Consider using `tsc --incremental` for faster rebuilds

**Runtime Performance**
- Enable caching: `CACHE_ENABLED=true`
- Adjust cache TTL: `CACHE_TTL=300`
- Use concise output: `OUTPUT_VERBOSITY=concise`

## 📊 Module Architecture

### Core Modules
- **index.ts**: MCP server with all tool handlers
- **schemas.ts**: Zod validation schemas for type safety
- **node-validator.ts**: Smart node validation with caching
- **config.ts**: Environment-based configuration system
- **resource-handlers.ts**: MCP resource protocol implementation
- **workflow-composition-guide.ts**: Comprehensive workflow guidance

### Dependencies
- **@modelcontextprotocol/sdk**: MCP protocol implementation
- **zod**: Runtime type validation
- **node-fetch**: HTTP client for n8n API calls

### Features
- ✅ Schema validation with Zod
- ✅ Smart node suggestions using Levenshtein distance
- ✅ Workflow filtering (name, tags, active status)
- ✅ Caching system with configurable TTL
- ✅ MCP Resources for standardized data access
- ✅ Verbosity control (concise/summary/full)
- ✅ Comprehensive workflow composition guidance
- ✅ Real-time node validation
- ✅ Environment-based configuration

## 🎯 Deployment Checklist

### Pre-deployment
- [ ] Run `npm run validate`
- [ ] Test with your n8n instance
- [ ] Configure environment variables
- [ ] Review security settings

### Deployment
- [ ] Choose deployment method (npm, Docker, global)
- [ ] Set production environment variables
- [ ] Configure logging and monitoring
- [ ] Test connectivity to n8n

### Post-deployment
- [ ] Verify MCP server starts correctly
- [ ] Test basic tool functionality
- [ ] Monitor performance and logs
- [ ] Set up health checks

---

For more information, see:
- [README.md](README.md) - Usage documentation
- [DEVELOPMENT.md](DEVELOPMENT.md) - Development guide
- [CLAUDE.md](CLAUDE.md) - Claude Code integration guide