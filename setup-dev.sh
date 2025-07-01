#!/bin/bash

# N8N MCP Server Development Setup Script
# This script sets up the development environment for the n8n MCP server

set -e  # Exit on any error

echo "🔧 N8N MCP Server Development Setup"
echo "====================================="

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check dependencies
echo "📋 Checking development dependencies..."
if ! command_exists node; then
    echo "❌ Node.js is required but not installed. Please install Node.js 18+ and try again."
    exit 1
fi

if ! command_exists npm; then
    echo "❌ npm is required but not installed. Please install npm and try again."
    exit 1
fi

echo "✅ Node.js and npm detected"

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Install optional development dependencies
echo "📦 Installing optional development tools..."
if ! command_exists nodemon; then
    echo "Installing nodemon for development..."
    npm install -g nodemon || echo "⚠️  Failed to install nodemon globally, continuing..."
fi

# Create .env.example file
echo "📄 Creating .env.example file..."
cat > .env.example << EOL
# N8N MCP Server Environment Variables

# Required: n8n API connection
N8N_HOST=http://localhost:5678/api/v1
N8N_API_KEY=your_n8n_api_key_here

# Optional: Server configuration
SERVER_NAME=n8n-workflow-builder
SERVER_VERSION=1.2.0
LOG_LEVEL=info

# Optional: Feature toggles
CACHE_ENABLED=true
CACHE_TTL=300

# Optional: Output formatting
OUTPUT_VERBOSITY=concise
EOL

# Create .env file if it doesn't exist
if [ ! -f ".env" ]; then
    echo "📄 Creating .env file from template..."
    cp .env.example .env
    echo "⚠️  Please edit .env file with your actual n8n configuration"
else
    echo "✅ .env file already exists"
fi

# Build the project
echo "🏗️  Building project..."
npm run build

# Test the build
echo "🧪 Testing the build..."
npm run test:build

# Create development scripts directory
mkdir -p scripts

# Create a quick test script
echo "📄 Creating test script..."
cat > scripts/test-connection.js << 'EOL'
#!/usr/bin/env node

// Quick test script to verify n8n connection
import { config } from '../build/config.js';

console.log('🔍 Testing n8n connection...');
console.log('Host:', config.n8n_host);
console.log('API Key:', config.n8n_api_key ? '***' + config.n8n_api_key.slice(-4) : 'NOT SET');

if (!config.n8n_api_key) {
    console.log('❌ N8N_API_KEY is not set. Please configure your .env file.');
    process.exit(1);
}

// Test connection
try {
    const response = await fetch(`${config.n8n_host}/workflows`, {
        headers: {
            'X-N8N-API-KEY': config.n8n_api_key,
            'Content-Type': 'application/json'
        }
    });

    if (response.ok) {
        console.log('✅ Connection successful!');
        const data = await response.json();
        console.log(`📊 Found ${data.data?.length || 0} workflows`);
    } else {
        console.log(`❌ Connection failed: ${response.status} ${response.statusText}`);
        process.exit(1);
    }
} catch (error) {
    console.log(`❌ Connection error: ${error.message}`);
    process.exit(1);
}
EOL

chmod +x scripts/test-connection.js

# Success message
echo ""
echo "🎉 Development setup complete!"
echo ""
echo "📋 Development workflow:"
echo "  1. Edit .env file with your n8n configuration"
echo "  2. Test connection: node scripts/test-connection.js"
echo "  3. Start development: npm run dev:watch"
echo ""
echo "📋 Available development commands:"
echo "  npm run dev              - Build and start once"
echo "  npm run dev:watch        - Start in watch mode (rebuilds on changes)"
echo "  npm run build:watch     - Build in watch mode only"
echo "  npm run validate         - Run full validation"
echo "  node scripts/test-connection.js - Test n8n connection"
echo ""
echo "📁 Files created:"
echo "  .env.example             - Environment variables template"
echo "  .env                     - Your environment configuration"
echo "  scripts/test-connection.js - Quick connection test"
echo ""
echo "🔧 Next steps:"
echo "  1. Configure your .env file"
echo "  2. Run: node scripts/test-connection.js"
echo "  3. Start development: npm run dev:watch"
echo ""
echo "✅ Ready for development!"