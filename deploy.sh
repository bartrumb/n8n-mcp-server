#!/bin/bash

# N8N MCP Server Deployment Script
# This script handles building, testing, and deploying the n8n MCP server

set -e  # Exit on any error

echo "🚀 N8N MCP Server Deployment Script"
echo "======================================"

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check dependencies
echo "📋 Checking dependencies..."
if ! command_exists node; then
    echo "❌ Node.js is required but not installed. Please install Node.js 18+ and try again."
    exit 1
fi

if ! command_exists npm; then
    echo "❌ npm is required but not installed. Please install npm and try again."
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node --version | cut -d'v' -f2)
REQUIRED_VERSION="18.0.0"

if [ "$(printf '%s\n' "$REQUIRED_VERSION" "$NODE_VERSION" | sort -V | head -n1)" != "$REQUIRED_VERSION" ]; then
    echo "❌ Node.js version $NODE_VERSION is too old. Please upgrade to Node.js 18+ and try again."
    exit 1
fi

echo "✅ Node.js $NODE_VERSION detected"

# Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
else
    echo "✅ Dependencies already installed"
fi

# Run validation (lint + build test)
echo "🔍 Running validation..."
npm run validate

# Optional: Run additional checks
if [ "$1" = "--full-check" ]; then
    echo "🧪 Running full validation checks..."
    
    # Check if all required files exist
    REQUIRED_FILES=(
        "src/index.ts"
        "src/schemas.ts"
        "src/node-validator.ts"
        "src/config.ts"
        "src/resource-handlers.ts"
        "src/workflow-composition-guide.ts"
        "package.json"
        "tsconfig.json"
    )
    
    for file in "${REQUIRED_FILES[@]}"; do
        if [ ! -f "$file" ]; then
            echo "❌ Required file missing: $file"
            exit 1
        fi
    done
    
    echo "✅ All required files present"
    
    # Validate TypeScript compilation
    echo "🔧 Validating TypeScript compilation..."
    npm run lint
    
    # Test the build
    echo "🏗️  Testing build process..."
    npm run test:build
fi

# Package the application
echo "📦 Creating package..."
npm run package

# Success message
echo ""
echo "🎉 Deployment preparation complete!"
echo ""
echo "📋 Available commands:"
echo "  npm start                 - Start the MCP server"
echo "  npm run dev              - Build and start in development mode"
echo "  npm run dev:watch        - Start in watch mode for development"
echo "  npm run build:watch     - Build in watch mode"
echo "  npm run validate         - Run linting and build tests"
echo "  npm run install:global  - Install globally for system-wide access"
echo ""
echo "🔧 Environment variables (optional):"
echo "  N8N_HOST                 - n8n API host (default: http://localhost:5678/api/v1)"
echo "  N8N_API_KEY             - n8n API key (required for most operations)"
echo "  OUTPUT_VERBOSITY        - Output detail level: concise|summary|full"
echo "  CACHE_ENABLED           - Enable node validation caching: true|false"
echo "  LOG_LEVEL               - Log level: info|debug|warn|error"
echo ""
echo "✅ Ready for deployment!"