/**
 * Configuration module for the n8n MCP server
 *
 * Handles environment variables and server configuration
 */
function getEnvVar(name, defaultValue) {
    return process.env[name] || defaultValue;
}
function getEnvVarBool(name, defaultValue) {
    const value = process.env[name];
    if (value === undefined)
        return defaultValue;
    return value.toLowerCase() === 'true' || value === '1';
}
function getEnvVarNumber(name, defaultValue) {
    const value = process.env[name];
    if (value === undefined)
        return defaultValue;
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? defaultValue : parsed;
}
function getOutputVerbosity() {
    const value = process.env.OUTPUT_VERBOSITY?.toLowerCase();
    if (value === 'full' || value === 'summary') {
        return value;
    }
    return 'concise'; // default
}
// Load package.json to get version
let packageVersion = '1.0.0';
try {
    // Try to read package.json from the build directory or source directory
    const packagePath = process.env.NODE_ENV === 'development'
        ? '../package.json'
        : '../../package.json';
    // In a real scenario, you might want to bundle this or read it differently
    packageVersion = '1.2.0'; // Hardcoded for now, can be improved
}
catch (error) {
    console.warn('Could not read package version, using default');
}
export const config = {
    n8n_host: getEnvVar('N8N_HOST', 'http://localhost:5678/api/v1'),
    n8n_api_key: getEnvVar('N8N_API_KEY', ''),
    server_name: getEnvVar('SERVER_NAME', 'n8n-workflow-builder'),
    server_version: getEnvVar('SERVER_VERSION', packageVersion),
    log_level: getEnvVar('LOG_LEVEL', 'info'),
    cache_enabled: getEnvVarBool('CACHE_ENABLED', true), // Enable by default for better performance
    cache_ttl: getEnvVarNumber('CACHE_TTL', 300), // 5 minutes default
    output_verbosity: getOutputVerbosity(),
};
// Validate required configuration
if (!config.n8n_api_key) {
    console.warn('N8N_API_KEY environment variable is not set. Some features may not work.');
}
// Normalize the n8n host URL (remove trailing slash, ensure it ends with /api/v1)
config.n8n_host = config.n8n_host.replace(/\/$/, '');
if (!config.n8n_host.endsWith('/api/v1')) {
    if (config.n8n_host.endsWith('/api')) {
        config.n8n_host += '/v1';
    }
    else {
        config.n8n_host += '/api/v1';
    }
}
/**
 * Helper function to format output based on verbosity setting
 */
export function formatOutput(data, verbosity) {
    const outputVerbosity = verbosity || config.output_verbosity;
    if (outputVerbosity === 'full') {
        return JSON.stringify(data, null, 2);
    }
    else if (outputVerbosity === 'summary') {
        // For summary mode, provide high-level overview
        return JSON.stringify(simplifyForSummary(data), null, 2);
    }
    else {
        // For concise mode, provide essential information only
        return JSON.stringify(simplifyForConcise(data), null, 2);
    }
}
/**
 * Simplifies data for summary output
 */
function simplifyForSummary(data) {
    if (Array.isArray(data)) {
        return {
            count: data.length,
            items: data.slice(0, 5).map(simplifyObject), // Show first 5 items
            ...(data.length > 5 && { note: `Showing first 5 of ${data.length} items` })
        };
    }
    return simplifyObject(data);
}
/**
 * Simplifies data for concise output
 */
function simplifyForConcise(data) {
    if (Array.isArray(data)) {
        return data.map(simplifyObject);
    }
    return simplifyObject(data);
}
/**
 * Simplifies an individual object for output
 */
function simplifyObject(obj) {
    if (!obj || typeof obj !== 'object')
        return obj;
    // For workflows, keep only essential fields
    if (obj.name && obj.id && 'active' in obj) {
        return {
            id: obj.id,
            name: obj.name,
            active: obj.active,
            ...(obj.createdAt && { createdAt: obj.createdAt }),
            ...(obj.updatedAt && { updatedAt: obj.updatedAt }),
            ...(obj.nodes && { nodeCount: obj.nodes.length }),
            ...(obj.tags && { tags: obj.tags })
        };
    }
    // For executions, keep only essential fields
    if (obj.id && obj.workflowId && obj.startedAt) {
        return {
            id: obj.id,
            workflowId: obj.workflowId,
            status: obj.status,
            startedAt: obj.startedAt,
            stoppedAt: obj.stoppedAt,
            finished: obj.finished,
            mode: obj.mode,
        };
    }
    // For nodes, keep essential fields
    if (obj.name && obj.display_name) {
        return {
            name: obj.name,
            displayName: obj.display_name,
            ...(obj.description && { description: obj.description }),
            ...(obj.type && { type: obj.type })
        };
    }
    // Default case, return the object as is but limit depth
    return obj;
}
