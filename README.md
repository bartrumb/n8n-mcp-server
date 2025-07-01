# n8n MCP Server

An MCP server that provides access to n8n workflows, executions, credentials, and more through the Model Context Protocol. This allows Large Language Models (LLMs) to interact with n8n instances in a secure and standardized way.

## Installation

### Get your n8n API Key

1. Log into your n8n instance
2. Click your user icon in the bottom left
3. Go to Settings
4. Select API
5. Click "Create API Key"
6. Copy your API key (you won't be able to see it again)

### Install the MCP Server

#### Option 1: Install from npm (Recommended)

```bash
npm install -g @illuminaresolutions/n8n-mcp-server
```

#### Option 2: Install from Source

1. Clone the repository:
   ```bash
   git clone https://github.com/illuminaresolutions/n8n-mcp-server.git
   cd n8n-mcp-server
   ```

2. Install dependencies and build:
   ```bash
   npm install
   npm run build
   ```

3. Start the server in the background:
   ```bash
   nohup npm start > n8n-mcp.log 2>&1 &
   ```

   To stop the server:
   ```bash
   pkill -f "node build/index.js"
   ```

Note: When installing from npm, the server will be available as `n8n-mcp-server` in your PATH.

## Configuration

### Claude Desktop

1. Open your Claude Desktop configuration:
   ```
   ~/Library/Application Support/Claude/claude_desktop_config.json
   ```

2. Add the n8n configuration:
   ```json
   {
     "mcpServers": {
        "n8n": {
         "command": "n8n-mcp-server",
         "env": {
           "N8N_HOST": "https://your-n8n-instance.com",
           "N8N_API_KEY": "your-api-key-here"
         }
       }
     }
   }
   ```

### Cline (VS Code)

1. Install the server (follow Installation steps above)
2. Open VS Code
3. Open the Cline extension from the left sidebar
4. Click the 'MCP Servers' icon at the top of the pane
5. Scroll to bottom and click 'Configure MCP Servers'
6. Add to the opened settings file:
   ```json
   {
     "mcpServers": {
       "n8n": {
         "command": "n8n-mcp-server",
         "env": {
           "N8N_HOST": "https://your-n8n-instance.com",
           "N8N_API_KEY": "your-api-key-here"
         }
       }
     }
   }
   ```
7. Save the file
8. Ensure the MCP toggle is enabled (green) and the status indicator is green
9. Start using MCP commands in Cline

### Sage

Coming soon! The n8n MCP server will be available through:
- Smithery.ai marketplace
- Import from Claude Desktop

For now, please use Claude Desktop or Cline.

## Validation

After configuration:

1. Restart your LLM application
2. Ask: "List my n8n workflows"
3. You should see your workflows listed

If you get an error:
- Check that your n8n instance is running
- Verify your API key has correct permissions
- Ensure N8N_HOST has no trailing slash

## Usage Examples

### Basic Workflow Management
```
"List my n8n workflows"
"Show me workflow details for ID 123"
"Activate workflow ID 456"
"Create a new workflow called 'Data Sync'"
```

### Documentation Lookup
```
"Search n8n documentation for HTTP Request"
"Find documentation about workflow triggers"
"Show me all documentation categories"
"Get documentation for the Gmail node"
"How do I configure OAuth2 authentication?"
```

### Execution Management
```
"Show recent workflow executions"
"Get execution details for ID 789"
"List failed executions from today"
"Show executions for workflow ID 123"
```

### Advanced Debugging (NEW in v1.2.0)
```
"Get detailed execution logs for ID 789"
"Show error messages from failed execution 456"
"List all executions for workflow ID 123 with errors only"
"Get comprehensive execution details for ID 789"
"Retry failed execution ID 456"
```

### Security and Auditing
```
"Generate a security audit report"
"Show me all credentials"
"List users in the n8n instance"
"Create a security audit for credentials only"
```

## Features

### Core Features
- List and manage workflows
- View workflow details
- Execute workflows
- Manage credentials
- Handle tags and executions
- Generate security audits
- Manage workflow tags

### Advanced Debugging Features (NEW in v1.2.0)
- **get-execution-details**: Comprehensive execution data with enhanced error handling
- **get-execution-logs**: Extract only error messages and logs without full data payload
- **get-workflow-executions**: List executions for specific workflows with filtering
- **retry-execution**: Retry failed executions directly from Claude
- **Enhanced list-executions**: Better error filtering and status information

### Documentation Features
- **search-docs**: Search through n8n documentation by keywords and topics
- **get-doc-section**: Retrieve specific documentation sections by file path
- **list-doc-categories**: Browse available documentation categories and structure
- **get-node-docs**: Get documentation for specific n8n nodes with fallback search

#### Documentation Search Details

The n8n MCP server includes comprehensive documentation lookup capabilities that allow you to search through and retrieve n8n documentation directly through natural language queries.

**search-docs**
- Searches across all available documentation files
- Uses intelligent relevance scoring
- Returns ranked results with excerpts
- Supports keywords, topics, and questions
- Example: "Search for HTTP Request node configuration"

**get-doc-section**
- Retrieves complete content of specific documentation files
- Use file paths returned from search results
- Returns full documentation with title, category, and content
- Example: "Get the documentation section for workflows/create.md"

**list-doc-categories**
- Browse the structure of available documentation
- Shows all categories and document counts
- Filter by specific categories if needed
- Helps discover available documentation topics

**get-node-docs**
- Node-specific documentation lookup
- Searches for exact node documentation first
- Falls back to general search for related content
- Covers all n8n core and integration nodes
- Example: "Get documentation for the Gmail node"

**Documentation Coverage**
The server provides access to comprehensive n8n documentation including:
- Node configuration and usage
- Workflow creation and management  
- Authentication and credentials
- API integration patterns
- Best practices and troubleshooting
- Advanced features and enterprise capabilities

### Enterprise Features
These features require an n8n Enterprise license:
- Project management
- Variable management
- Advanced user management

## Troubleshooting

### Common Issues

1. "Client not initialized"
   - Check N8N_HOST and N8N_API_KEY are set correctly
   - Ensure n8n instance is accessible
   - Verify API key permissions

2. "License required"
   - You're trying to use an Enterprise feature
   - Either upgrade to n8n Enterprise or use core features only

3. Connection Issues
   - Verify n8n instance is running
   - Check URL protocol (http/https)
   - Remove trailing slash from N8N_HOST

4. Documentation Search Issues
   - "Documentation not found": The docs directory may not be accessible
   - "No results found": Try broader search terms or check spelling
   - "Empty categories": Documentation files may not be in the expected location
   - Check that `/mnt/c/Code/n8n/docs` exists and contains markdown files

## Security Best Practices

1. API Key Management
   - Use minimal permissions necessary
   - Rotate keys regularly
   - Never commit keys to version control

2. Instance Access
   - Use HTTPS for production
   - Enable n8n authentication
   - Keep n8n updated

## Support

- [GitHub Issues](https://github.com/illuminaresolutions/n8n-mcp-server/issues)
- [n8n Documentation](https://docs.n8n.io)

## License

[MIT License](LICENSE)
