import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import fetch from 'node-fetch';
import * as fs from 'fs';
import * as path from 'path';
import { NodeSchema, WorkflowSchema, CreateWorkflowInputSchema } from './schemas.js';
import { NodeValidator } from './node-validator.js';
import { config, formatOutput } from './config.js';
import { setupResourceHandlers } from './resource-handlers.js';
// Helper functions for response size management
const MAX_RESPONSE_TOKENS = 8000; // Ultra conservative limit to prevent MCP token overages
const TRUNCATION_MESSAGE = "\n\n[Response truncated due to size limits. Use more specific filtering or pagination to get complete data.]";
function estimateTokenCount(text) {
    // More conservative estimate: 1 token ≈ 3.5 characters (accounting for MCP overhead)
    return Math.ceil(text.length / 3.5);
}
function truncateResponse(obj) {
    const jsonString = JSON.stringify(obj, null, 2);
    const tokenCount = estimateTokenCount(jsonString);
    if (tokenCount <= MAX_RESPONSE_TOKENS) {
        return jsonString;
    }
    // Try to truncate execution data if present
    if (obj.data && Array.isArray(obj.data)) {
        const truncatedObj = {
            ...obj,
            data: obj.data.map((item) => truncateExecutionItem(item))
        };
        const truncatedString = JSON.stringify(truncatedObj, null, 2);
        if (estimateTokenCount(truncatedString) <= MAX_RESPONSE_TOKENS) {
            return truncatedString + TRUNCATION_MESSAGE;
        }
    }
    // If still too large, truncate more aggressively
    const maxLength = MAX_RESPONSE_TOKENS * 4; // Convert back to characters
    return jsonString.substring(0, maxLength) + TRUNCATION_MESSAGE;
}
function truncateExecutionItem(execution) {
    if (!execution)
        return execution;
    const truncated = {
        id: execution.id,
        mode: execution.mode,
        status: execution.status,
        startedAt: execution.startedAt,
        stoppedAt: execution.stoppedAt,
        workflowId: execution.workflowId,
        waitTill: execution.waitTill
    };
    // Include ultra minimal data summary only
    if (execution.data && typeof execution.data === 'object') {
        const hasResults = execution.data.resultData?.runData ?
            Object.keys(execution.data.resultData.runData).length : 0;
        truncated.dataSummary = `${hasResults} nodes executed`;
    }
    return truncated;
}
function createSummaryResponse(executions) {
    if (!executions || !executions.data) {
        return JSON.stringify(executions, null, 2);
    }
    const summary = {
        totalExecutions: executions.data.length,
        summary: executions.data.map((exec) => ({
            id: exec.id,
            status: exec.status,
            startedAt: exec.startedAt,
            stoppedAt: exec.stoppedAt,
            workflowId: exec.workflowId,
            mode: exec.mode,
            dataSize: exec.data ? 'present' : 'none'
        })),
        nextCursor: executions.nextCursor
    };
    return JSON.stringify(summary, null, 2);
}
function truncateSingleExecution(execution) {
    if (!execution)
        return execution;
    // Create heavily truncated version for single execution responses
    const truncated = {
        id: execution.id,
        finished: execution.finished,
        mode: execution.mode,
        status: execution.status,
        createdAt: execution.createdAt,
        startedAt: execution.startedAt,
        stoppedAt: execution.stoppedAt,
        workflowId: execution.workflowId,
        waitTill: execution.waitTill
    };
    // Include minimal data summary
    if (execution.data) {
        const nodeCount = execution.data.resultData?.runData ?
            Object.keys(execution.data.resultData.runData).length : 0;
        const lastNode = execution.data.resultData?.lastNodeExecuted || 'unknown';
        truncated.dataSummary = {
            nodesExecuted: nodeCount,
            lastNodeExecuted: lastNode,
            hasStartData: !!execution.data.startData,
            hasExecutionData: !!execution.data.executionData,
            note: 'Full execution data truncated. Use specific node queries for details.'
        };
    }
    // Include workflow data summary if present
    if (execution.workflowData) {
        truncated.workflowSummary = {
            id: execution.workflowData.id,
            name: execution.workflowData.name,
            active: execution.workflowData.active,
            nodeCount: execution.workflowData.nodes?.length || 0,
            note: 'Full workflow data truncated.'
        };
    }
    return truncated;
}
// Documentation helper functions
class DocumentationManager {
    docsPath;
    docIndex = new Map();
    categories = new Set();
    constructor(docsPath = '/mnt/c/Code/n8n/docs') {
        this.docsPath = docsPath;
        this.loadDocumentation();
    }
    loadDocumentation() {
        try {
            this.scanDirectory(this.docsPath, '');
        }
        catch (error) {
            console.warn('Documentation not available:', error);
        }
    }
    scanDirectory(dirPath, category) {
        if (!fs.existsSync(dirPath))
            return;
        const files = fs.readdirSync(dirPath);
        for (const file of files) {
            const filePath = path.join(dirPath, file);
            const stat = fs.statSync(filePath);
            if (stat.isDirectory()) {
                const subCategory = category ? `${category}/${file}` : file;
                this.categories.add(subCategory);
                this.scanDirectory(filePath, subCategory);
            }
            else if (file.endsWith('.md')) {
                const content = fs.readFileSync(filePath, 'utf-8');
                const title = this.extractTitle(content) || file.replace('.md', '');
                const relativePath = path.relative(this.docsPath, filePath);
                const docSection = {
                    path: relativePath,
                    title,
                    content,
                    category: category || 'root'
                };
                this.docIndex.set(relativePath, docSection);
                this.categories.add(category || 'root');
            }
        }
    }
    extractTitle(content) {
        const titleMatch = content.match(/^#\s+(.+)$/m);
        return titleMatch ? titleMatch[1].trim() : null;
    }
    searchDocuments(query, limit = 10) {
        const results = [];
        const queryLower = query.toLowerCase();
        for (const [path, doc] of this.docIndex) {
            const titleScore = this.calculateRelevance(doc.title.toLowerCase(), queryLower);
            const contentScore = this.calculateRelevance(doc.content.toLowerCase(), queryLower) * 0.5;
            const relevanceScore = titleScore + contentScore;
            if (relevanceScore > 0) {
                const excerpt = this.extractExcerpt(doc.content, queryLower);
                results.push({
                    path: doc.path,
                    title: doc.title,
                    excerpt,
                    category: doc.category,
                    relevanceScore
                });
            }
        }
        return results
            .sort((a, b) => b.relevanceScore - a.relevanceScore)
            .slice(0, limit);
    }
    calculateRelevance(text, query) {
        const words = query.split(/\s+/);
        let score = 0;
        for (const word of words) {
            const occurrences = (text.match(new RegExp(word, 'g')) || []).length;
            score += occurrences;
        }
        return score;
    }
    extractExcerpt(content, query) {
        const words = query.split(/\s+/);
        const lines = content.split('\n');
        for (const line of lines) {
            const lineLower = line.toLowerCase();
            if (words.some(word => lineLower.includes(word))) {
                return line.trim().substring(0, 200) + (line.length > 200 ? '...' : '');
            }
        }
        return content.substring(0, 200) + (content.length > 200 ? '...' : '');
    }
    getDocument(docPath) {
        return this.docIndex.get(docPath) || null;
    }
    getCategories() {
        return Array.from(this.categories).sort();
    }
    getDocumentsByCategory(category) {
        return Array.from(this.docIndex.values())
            .filter(doc => doc.category === category)
            .sort((a, b) => a.title.localeCompare(b.title));
    }
    getNodeDocumentation(nodeName) {
        // Look for node-specific documentation
        const nodePattern = new RegExp(`${nodeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
        for (const [path, doc] of this.docIndex) {
            if (nodePattern.test(doc.title) || nodePattern.test(path)) {
                return doc;
            }
        }
        return null;
    }
}
// Initialize documentation manager
const docManager = new DocumentationManager();
class N8nClient {
    baseUrl;
    apiKey;
    nodeValidator;
    constructor(baseUrl, apiKey) {
        this.baseUrl = baseUrl;
        this.apiKey = apiKey;
        // Remove trailing slash if present
        this.baseUrl = baseUrl.replace(/\/$/, '');
        this.nodeValidator = new NodeValidator(this.baseUrl, this.apiKey);
    }
    async makeRequest(endpoint, options = {}) {
        const url = `${this.baseUrl}/api/v1${endpoint}`;
        const headers = {
            'X-N8N-API-KEY': this.apiKey,
            'Accept': 'application/json',
            'Content-Type': 'application/json',
        };
        try {
            const response = await fetch(url, {
                ...options,
                headers: {
                    ...headers,
                    ...options.headers,
                },
            });
            if (!response.ok) {
                const errorText = await response.text();
                let errorMessage;
                try {
                    const errorJson = JSON.parse(errorText);
                    // Check for license-related errors
                    if (errorJson.message && errorJson.message.includes('license')) {
                        errorMessage = `This operation requires an n8n Enterprise license with project management features enabled. Error: ${errorJson.message}`;
                    }
                    else {
                        errorMessage = errorJson.message || errorText;
                    }
                }
                catch {
                    errorMessage = errorText;
                }
                throw new Error(`N8N API error: ${errorMessage}`);
            }
            // Handle 204 No Content responses
            if (response.status === 204) {
                return {};
            }
            // Handle successful responses that may have JSON parsing issues
            const responseText = await response.text();
            if (!responseText.trim()) {
                // Empty response from successful operation
                return {};
            }
            try {
                return JSON.parse(responseText);
            }
            catch (jsonError) {
                // JSON parsing failed but HTTP request succeeded
                // This often happens with successful operations that return malformed JSON
                console.warn(`JSON parsing failed for successful response. Status: ${response.status}, URL: ${url}, Response: ${responseText.substring(0, 200)}, Error: ${jsonError}`);
                // For successful operations that don't return JSON, return empty object
                return {};
            }
        }
        catch (error) {
            if (error instanceof Error) {
                // Don't re-throw JSON parsing errors as they should be handled above
                if (error.message.includes('Unexpected end of JSON input') || error.message.includes('JSON')) {
                    console.warn(`JSON parsing error caught in outer handler: ${error.message}`);
                    return {};
                }
                throw new Error(`Failed to connect to n8n: ${error.message}`);
            }
            throw error;
        }
    }
    async listWorkflows() {
        return this.makeRequest('/workflows');
    }
    async getWorkflow(id) {
        return this.makeRequest(`/workflows/${id}`);
    }
    async createWorkflow(name, nodes = [], connections = {}) {
        return this.makeRequest('/workflows', {
            method: 'POST',
            body: JSON.stringify({
                name,
                nodes,
                connections,
                settings: {
                    saveManualExecutions: true,
                    saveExecutionProgress: true,
                },
            }),
        });
    }
    // Validate workflow data using Zod schemas
    validateWorkflow(workflowData) {
        try {
            const validatedData = WorkflowSchema.parse(workflowData);
            return { isValid: true, validatedData };
        }
        catch (error) {
            if (error instanceof z.ZodError) {
                const errors = error.errors.map(err => `${err.path.join('.')}: ${err.message}`);
                return { isValid: false, errors };
            }
            return { isValid: false, errors: ['Unknown validation error'] };
        }
    }
    // Validate individual node data
    validateNode(nodeData) {
        try {
            const validatedData = NodeSchema.parse(nodeData);
            return { isValid: true, validatedData };
        }
        catch (error) {
            if (error instanceof z.ZodError) {
                const errors = error.errors.map(err => `${err.path.join('.')}: ${err.message}`);
                return { isValid: false, errors };
            }
            return { isValid: false, errors: ['Unknown validation error'] };
        }
    }
    // Create workflow with validation
    async createValidatedWorkflow(workflowInput) {
        // Validate the input using schema
        const validationResult = CreateWorkflowInputSchema.safeParse(workflowInput);
        if (!validationResult.success) {
            const errors = validationResult.error.errors.map(err => `${err.path.join('.')}: ${err.message}`);
            throw new Error(`Workflow validation failed: ${errors.join(', ')}`);
        }
        const { workflow, activate = false } = validationResult.data;
        // Validate node types against n8n instance
        if (workflow.nodes && workflow.nodes.length > 0) {
            const nodeValidationErrors = await this.nodeValidator.validate_workflow_nodes(workflow.nodes);
            if (nodeValidationErrors.length > 0) {
                const errorMessages = nodeValidationErrors.map(error => error.suggestion
                    ? `Invalid node type "${error.node_type}". Did you mean "${error.suggestion}"?`
                    : `Invalid node type "${error.node_type}"`);
                throw new Error(`Node validation failed: ${errorMessages.join(', ')}`);
            }
        }
        // Create the workflow
        const createdWorkflow = await this.makeRequest('/workflows', {
            method: 'POST',
            body: JSON.stringify(workflow),
        });
        // Activate if requested
        if (activate && createdWorkflow.id) {
            await this.activateWorkflow(createdWorkflow.id.toString());
        }
        return createdWorkflow;
    }
    // Node validation methods
    async getAvailableNodes() {
        return this.nodeValidator.get_available_nodes();
    }
    async getAvailableNodeTypes() {
        return this.nodeValidator.get_available_node_types();
    }
    async validateNodeType(nodeType) {
        return this.nodeValidator.validate_node_type(nodeType);
    }
    async validateWorkflowNodes(nodes) {
        return this.nodeValidator.validate_workflow_nodes(nodes);
    }
    async updateWorkflow(id, workflow) {
        return this.makeRequest(`/workflows/${id}`, {
            method: 'PUT',
            body: JSON.stringify(workflow),
        });
    }
    async deleteWorkflow(id) {
        return this.makeRequest(`/workflows/${id}`, {
            method: 'DELETE',
        });
    }
    async activateWorkflow(id) {
        return this.makeRequest(`/workflows/${id}/activate`, {
            method: 'POST',
        });
    }
    async deactivateWorkflow(id) {
        return this.makeRequest(`/workflows/${id}/deactivate`, {
            method: 'POST',
        });
    }
    // Project management methods (requires n8n Enterprise license)
    async listProjects() {
        return this.makeRequest('/projects');
    }
    async createProject(name) {
        return this.makeRequest('/projects', {
            method: 'POST',
            body: JSON.stringify({ name }),
        });
    }
    async deleteProject(projectId) {
        return this.makeRequest(`/projects/${projectId}`, {
            method: 'DELETE',
        });
    }
    async updateProject(projectId, name) {
        return this.makeRequest(`/projects/${projectId}`, {
            method: 'PUT',
            body: JSON.stringify({ name }),
        });
    }
    // User management methods
    async listUsers() {
        return this.makeRequest('/users');
    }
    async createUsers(users) {
        return this.makeRequest('/users', {
            method: 'POST',
            body: JSON.stringify(users),
        });
    }
    async getUser(idOrEmail) {
        return this.makeRequest(`/users/${idOrEmail}`);
    }
    async deleteUser(idOrEmail) {
        return this.makeRequest(`/users/${idOrEmail}`, {
            method: 'DELETE',
        });
    }
    // Variable management methods
    async listVariables() {
        return this.makeRequest('/variables');
    }
    async createVariable(key, value) {
        return this.makeRequest('/variables', {
            method: 'POST',
            body: JSON.stringify({ key, value }),
        });
    }
    async deleteVariable(id) {
        return this.makeRequest(`/variables/${id}`, {
            method: 'DELETE',
        });
    }
    // Execution management methods
    async getExecutions(options = {}) {
        const params = new URLSearchParams();
        if (options.includeData !== undefined)
            params.append('includeData', String(options.includeData));
        if (options.status)
            params.append('status', options.status);
        if (options.workflowId)
            params.append('workflowId', options.workflowId);
        if (options.limit)
            params.append('limit', String(options.limit));
        return this.makeRequest(`/executions?${params.toString()}`);
    }
    async getExecution(id, includeData = false) {
        const params = new URLSearchParams();
        if (includeData)
            params.append('includeData', 'true');
        return this.makeRequest(`/executions/${id}?${params.toString()}`);
    }
    async deleteExecution(id) {
        return this.makeRequest(`/executions/${id}`, {
            method: 'DELETE',
        });
    }
    // Enhanced execution debugging methods
    async getExecutionDetails(id) {
        // Get full execution details with enhanced error handling
        try {
            const execution = await this.makeRequest(`/executions/${id}?includeData=true`);
            return execution;
        }
        catch (error) {
            // If full data fails due to size, get basic data and extract error info
            const basicExecution = await this.makeRequest(`/executions/${id}`);
            return {
                ...basicExecution,
                errorNote: "Full execution data too large to retrieve. Check n8n UI for complete details.",
                originalError: error instanceof Error ? error.message : String(error)
            };
        }
    }
    async getExecutionLogs(id) {
        // Extract error messages and logs from execution
        try {
            const execution = await this.makeRequest(`/executions/${id}?includeData=true`);
            // Extract error information from execution data
            const logs = {
                executionId: id,
                status: execution.status,
                error: execution.error || null,
                logs: [],
                nodeErrors: {},
                lastNodeExecuted: null
            };
            if (execution.data?.resultData?.runData) {
                logs.lastNodeExecuted = execution.data.resultData.lastNodeExecuted;
                // Extract node-specific errors
                for (const [nodeName, nodeData] of Object.entries(execution.data.resultData.runData)) {
                    if (Array.isArray(nodeData) && nodeData.length > 0) {
                        const nodeResult = nodeData[0];
                        if (nodeResult.error) {
                            logs.nodeErrors[nodeName] = nodeResult.error;
                        }
                    }
                }
            }
            return logs;
        }
        catch (error) {
            // Fallback to basic execution info
            const basicExecution = await this.makeRequest(`/executions/${id}`);
            return {
                executionId: id,
                status: basicExecution.status,
                error: basicExecution.error || null,
                note: "Unable to retrieve detailed logs due to data size constraints",
                fallbackError: error instanceof Error ? error.message : String(error)
            };
        }
    }
    async getWorkflowExecutions(workflowId, options = {}) {
        const params = new URLSearchParams();
        params.append('workflowId', workflowId);
        if (options.limit)
            params.append('limit', String(options.limit));
        if (options.status)
            params.append('status', options.status);
        if (options.includeData !== undefined)
            params.append('includeData', String(options.includeData));
        return this.makeRequest(`/executions?${params.toString()}`);
    }
    async retryExecution(id) {
        return this.makeRequest(`/executions/${id}/retry`, {
            method: 'POST',
        });
    }
    // Tag management methods
    async createTag(name) {
        return this.makeRequest('/tags', {
            method: 'POST',
            body: JSON.stringify({ name }),
        });
    }
    async getTags(options = {}) {
        const params = new URLSearchParams();
        if (options.limit)
            params.append('limit', String(options.limit));
        return this.makeRequest(`/tags?${params.toString()}`);
    }
    async getTag(id) {
        return this.makeRequest(`/tags/${id}`);
    }
    async updateTag(id, name) {
        return this.makeRequest(`/tags/${id}`, {
            method: 'PUT',
            body: JSON.stringify({ name }),
        });
    }
    async deleteTag(id) {
        return this.makeRequest(`/tags/${id}`, {
            method: 'DELETE',
        });
    }
    async getWorkflowTags(workflowId) {
        return this.makeRequest(`/workflows/${workflowId}/tags`);
    }
    async updateWorkflowTags(workflowId, tagIds) {
        return this.makeRequest(`/workflows/${workflowId}/tags`, {
            method: 'PUT',
            body: JSON.stringify(tagIds),
        });
    }
    // Security audit method
    async generateAudit(options = {}) {
        return this.makeRequest('/audit', {
            method: 'POST',
            body: JSON.stringify({
                additionalOptions: {
                    daysAbandonedWorkflow: options.daysAbandonedWorkflow,
                    categories: options.categories,
                },
            }),
        });
    }
    // Credential management methods
    async createCredential(name, type, data) {
        return this.makeRequest('/credentials', {
            method: 'POST',
            body: JSON.stringify({
                name,
                type,
                data
            }),
        });
    }
    async deleteCredential(id) {
        return this.makeRequest(`/credentials/${id}`, {
            method: 'DELETE',
        });
    }
    async getCredentialSchema(credentialTypeName) {
        return this.makeRequest(`/credentials/schema/${credentialTypeName}`);
    }
    // Source Control method
    async pullSourceControl(options = {}) {
        return this.makeRequest('/source-control/pull', {
            method: 'POST',
            body: JSON.stringify({
                force: options.force,
                variables: options.variables,
            }),
        });
    }
}
// Create an MCP server
const server = new Server({
    name: config.server_name,
    version: config.server_version
}, {
    capabilities: {
        tools: {},
        resources: {}
    }
});
// Store client instances
const clients = new Map();
// List tools handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "init-n8n",
                description: "🔗 Initialize connection to n8n automation platform. WHAT: Establishes secure API connection to n8n workflow server. WHEN: First step before any n8n operations - use when user provides n8n URL and API key. RETURNS: Client ID for subsequent operations. Triggers: 'connect to n8n', 'n8n login', 'set up n8n access'. Business context: Essential for workflow automation management in e-bike shops, inventory systems, and customer service workflows.",
                inputSchema: {
                    type: "object",
                    properties: {
                        url: { type: "string" },
                        apiKey: { type: "string" }
                    },
                    required: ["url", "apiKey"]
                }
            },
            {
                name: "list-workflows",
                description: "📋 Browse all automation workflows in n8n. WHAT: Retrieves comprehensive list of all workflows with status, names, and tags. WHEN: Use to discover available automations, check workflow status, or find specific workflows by name. RETURNS: Array of workflows with ID, name, active status, creation date, and tags. Triggers: 'show workflows', 'list automations', 'what workflows exist', 'workflow overview'.",
                inputSchema: {
                    type: "object",
                    properties: {
                        clientId: { type: "string" },
                        nameFilter: {
                            type: "string",
                            description: "Filter workflows by name (case-insensitive partial match)"
                        },
                        activeOnly: {
                            type: "boolean",
                            description: "If true, only return active workflows. If false, only inactive workflows. If not specified, return all workflows."
                        },
                        tags: {
                            type: "array",
                            items: { type: "string" },
                            description: "Filter workflows that have any of these tags"
                        }
                    },
                    required: ["clientId"]
                }
            },
            {
                name: "get-workflow",
                description: "🔍 Get detailed workflow configuration and structure. WHAT: Retrieves complete workflow definition including nodes, connections, settings, and triggers. WHEN: Use to inspect workflow logic, troubleshoot issues, or understand automation flow. RETURNS: Full workflow object with nodes array, connections map, and execution settings. Triggers: 'show workflow details', 'workflow configuration', 'how does this workflow work', 'workflow structure'.",
                inputSchema: {
                    type: "object",
                    properties: {
                        clientId: { type: "string" },
                        id: { type: "string" }
                    },
                    required: ["clientId", "id"]
                }
            },
            {
                name: "create-workflow",
                description: "✨ Build new automation workflow in n8n. WHAT: Creates empty workflow or with predefined nodes and connections for automation tasks. WHEN: Use to set up new business processes, customer service automations, or inventory sync workflows. RETURNS: New workflow object with assigned ID and default settings. Triggers: 'create new workflow', 'build automation', 'new process', 'automate task'. Business context: Essential for creating customer notification systems, inventory updates, and repair shop processes.",
                inputSchema: {
                    type: "object",
                    properties: {
                        clientId: { type: "string" },
                        name: { type: "string" },
                        nodes: { type: "array" },
                        connections: { type: "object" }
                    },
                    required: ["clientId", "name"]
                }
            },
            {
                name: "validate-workflow",
                description: "✅ Validate workflow structure and data using Zod schemas. WHAT: Validates workflow configuration including nodes, connections, and settings for compliance with n8n API requirements. WHEN: Use before creating or updating workflows to ensure data integrity and prevent API errors. RETURNS: Validation results with detailed error messages if validation fails. Triggers: 'validate workflow', 'check workflow structure', 'verify workflow data'.",
                inputSchema: {
                    type: "object",
                    properties: {
                        clientId: { type: "string" },
                        workflowData: { type: "object" }
                    },
                    required: ["clientId", "workflowData"]
                }
            },
            {
                name: "validate-node",
                description: "🔍 Validate individual node structure and configuration. WHAT: Validates single node data including type, position, parameters, and credentials against schema requirements. WHEN: Use when building workflows node by node or troubleshooting node configuration issues. RETURNS: Validation results with specific field errors if validation fails. Triggers: 'validate node', 'check node data', 'verify node configuration'.",
                inputSchema: {
                    type: "object",
                    properties: {
                        clientId: { type: "string" },
                        nodeData: { type: "object" }
                    },
                    required: ["clientId", "nodeData"]
                }
            },
            {
                name: "create-validated-workflow",
                description: "🛡️ Create workflow with comprehensive validation and optional activation. WHAT: Creates workflow using validated input schema with strict type checking and optional automatic activation. WHEN: Use for production workflow creation where data integrity is critical. RETURNS: Created workflow object with validation confirmation. Triggers: 'create validated workflow', 'build secure workflow', 'create production workflow'.",
                inputSchema: {
                    type: "object",
                    properties: {
                        clientId: { type: "string" },
                        workflowInput: { type: "object" }
                    },
                    required: ["clientId", "workflowInput"]
                }
            },
            {
                name: "list-available-nodes",
                description: "📋 List all available nodes in the n8n instance. WHAT: Retrieves comprehensive list of all node types available in the connected n8n instance with categorization and descriptions. WHEN: Use BEFORE creating workflows to ensure you only use valid node types. Essential for preventing workflow creation errors. RETURNS: Organized list of available nodes with display names, categories, and descriptions. Triggers: 'list nodes', 'available nodes', 'what nodes exist', 'node types'.",
                inputSchema: {
                    type: "object",
                    properties: {
                        clientId: { type: "string" },
                        verbosity: {
                            type: "string",
                            enum: ["concise", "summary", "full"],
                            description: "Output detail level (default: concise)"
                        },
                        category: {
                            type: "string",
                            description: "Filter by node category (e.g. 'n8n-nodes-base')"
                        }
                    },
                    required: ["clientId"]
                }
            },
            {
                name: "update-workflow",
                description: "⚙️ Modify existing workflow configuration and logic. WHAT: Updates workflow properties, adds/removes nodes, changes connections, or modifies settings. WHEN: Use to fix broken workflows, add new functionality, or update business logic. RETURNS: Updated workflow object with changes applied. Triggers: 'modify workflow', 'update automation', 'fix workflow', 'change process', 'workflow maintenance'.",
                inputSchema: {
                    type: "object",
                    properties: {
                        clientId: { type: "string" },
                        id: { type: "string" },
                        workflow: {
                            type: "object",
                            properties: {
                                name: { type: "string" },
                                active: { type: "boolean" },
                                nodes: { type: "array" },
                                connections: { type: "object" },
                                settings: { type: "object" }
                            }
                        }
                    },
                    required: ["clientId", "id", "workflow"]
                }
            },
            {
                name: "delete-workflow",
                description: "🗑️ Permanently remove workflow from n8n (DESTRUCTIVE). WHAT: Deletes workflow and all associated data - cannot be undone. WHEN: Use to clean up unused workflows or remove broken automations. RETURNS: Deleted workflow object for confirmation. Triggers: 'delete workflow', 'remove automation', 'cleanup workflows'. WARNING: Irreversible action.",
                inputSchema: {
                    type: "object",
                    properties: {
                        clientId: { type: "string" },
                        id: { type: "string" }
                    },
                    required: ["clientId", "id"]
                }
            },
            {
                name: "activate-workflow",
                description: "🚀 Start workflow automation and enable triggers. WHAT: Activates workflow to begin processing triggers and executing automatically. WHEN: Use to go live with new automations or restart paused workflows. RETURNS: Activated workflow with active status. Triggers: 'start workflow', 'enable automation', 'turn on workflow', 'activate process', 'go live'.",
                inputSchema: {
                    type: "object",
                    properties: {
                        clientId: { type: "string" },
                        id: { type: "string" }
                    },
                    required: ["clientId", "id"]
                }
            },
            {
                name: "deactivate-workflow",
                description: "📏 Pause workflow automation and disable triggers. WHAT: Stops workflow from processing new triggers while preserving configuration. WHEN: Use to temporarily pause automations, stop broken workflows, or during maintenance. RETURNS: Deactivated workflow with inactive status. Triggers: 'stop workflow', 'pause automation', 'disable workflow', 'turn off process'.",
                inputSchema: {
                    type: "object",
                    properties: {
                        clientId: { type: "string" },
                        id: { type: "string" }
                    },
                    required: ["clientId", "id"]
                }
            },
            {
                name: "list-projects",
                description: "List all projects from n8n. NOTE: Requires n8n Enterprise license with project management features enabled. IMPORTANT: Arguments must be provided as compact, single-line JSON without whitespace or newlines.",
                inputSchema: {
                    type: "object",
                    properties: {
                        clientId: { type: "string" }
                    },
                    required: ["clientId"]
                }
            },
            {
                name: "create-project",
                description: "Create a new project in n8n. NOTE: Requires n8n Enterprise license with project management features enabled. IMPORTANT: Arguments must be provided as compact, single-line JSON without whitespace or newlines.",
                inputSchema: {
                    type: "object",
                    properties: {
                        clientId: { type: "string" },
                        name: { type: "string" }
                    },
                    required: ["clientId", "name"]
                }
            },
            {
                name: "delete-project",
                description: "Delete a project by ID. NOTE: Requires n8n Enterprise license with project management features enabled. IMPORTANT: Arguments must be provided as compact, single-line JSON without whitespace or newlines.",
                inputSchema: {
                    type: "object",
                    properties: {
                        clientId: { type: "string" },
                        projectId: { type: "string" }
                    },
                    required: ["clientId", "projectId"]
                }
            },
            {
                name: "update-project",
                description: "Update a project's name. NOTE: Requires n8n Enterprise license with project management features enabled. IMPORTANT: Arguments must be provided as compact, single-line JSON without whitespace or newlines.",
                inputSchema: {
                    type: "object",
                    properties: {
                        clientId: { type: "string" },
                        projectId: { type: "string" },
                        name: { type: "string" }
                    },
                    required: ["clientId", "projectId", "name"]
                }
            },
            {
                name: "list-users",
                description: "Retrieve all users from your instance. Only available for the instance owner.",
                inputSchema: {
                    type: "object",
                    properties: {
                        clientId: { type: "string" }
                    },
                    required: ["clientId"]
                }
            },
            {
                name: "create-users",
                description: "Create one or more users in your instance.",
                inputSchema: {
                    type: "object",
                    properties: {
                        clientId: { type: "string" },
                        users: {
                            type: "array",
                            items: {
                                type: "object",
                                properties: {
                                    email: { type: "string" },
                                    role: {
                                        type: "string",
                                        enum: ["global:admin", "global:member"]
                                    }
                                },
                                required: ["email"]
                            }
                        }
                    },
                    required: ["clientId", "users"]
                }
            },
            {
                name: "get-user",
                description: "Get user by ID or email address.",
                inputSchema: {
                    type: "object",
                    properties: {
                        clientId: { type: "string" },
                        idOrEmail: { type: "string" }
                    },
                    required: ["clientId", "idOrEmail"]
                }
            },
            {
                name: "delete-user",
                description: "Delete a user from your instance.",
                inputSchema: {
                    type: "object",
                    properties: {
                        clientId: { type: "string" },
                        idOrEmail: { type: "string" }
                    },
                    required: ["clientId", "idOrEmail"]
                }
            },
            {
                name: "list-variables",
                description: "📋 View global variables for workflow configuration. WHAT: Retrieves all environment variables and configuration values shared across workflows. WHEN: Use to check available config values, API endpoints, or shared constants. RETURNS: Array of variables with keys and values. Triggers: 'show variables', 'config values', 'environment settings', 'global constants'. NOTE: Requires n8n Enterprise license.",
                inputSchema: {
                    type: "object",
                    properties: {
                        clientId: { type: "string" }
                    },
                    required: ["clientId"]
                }
            },
            {
                name: "create-variable",
                description: "✨ Create global variable for workflow configuration. WHAT: Creates reusable variable that can be referenced across all workflows. WHEN: Use to store API endpoints, configuration values, or shared constants. RETURNS: Success confirmation with variable key. Triggers: 'add variable', 'create config', 'set global value', 'shared constant'. Examples: API base URLs, shop settings, notification preferences. NOTE: Requires n8n Enterprise license.",
                inputSchema: {
                    type: "object",
                    properties: {
                        clientId: { type: "string" },
                        key: { type: "string" },
                        value: { type: "string" }
                    },
                    required: ["clientId", "key", "value"]
                }
            },
            {
                name: "delete-variable",
                description: "Delete a variable by ID. NOTE: Requires n8n Enterprise license with variable management features enabled. Use after list-variables to get the ID of the variable to delete. This action cannot be undone. IMPORTANT: Arguments must be provided as compact, single-line JSON without whitespace or newlines.",
                inputSchema: {
                    type: "object",
                    properties: {
                        clientId: { type: "string" },
                        id: { type: "string" }
                    },
                    required: ["clientId", "id"]
                }
            },
            {
                name: "create-credential",
                description: "🔐 Set up authentication credentials for external services. WHAT: Creates secure credential storage for APIs, databases, and integrations. WHEN: Use to connect workflows to external services like Square, Gmail, or databases. RETURNS: Created credential object with ID for node references. Triggers: 'add credentials', 'setup authentication', 'connect to service', 'API credentials'. Examples: Square payment processing, email authentication, database connections. Use get-credential-schema first to see required fields.",
                inputSchema: {
                    type: "object",
                    properties: {
                        clientId: { type: "string" },
                        name: { type: "string" },
                        type: { type: "string" },
                        data: { type: "object" }
                    },
                    required: ["clientId", "name", "type", "data"]
                }
            },
            {
                name: "delete-credential",
                description: "Delete a credential by ID. You must be the owner of the credentials.",
                inputSchema: {
                    type: "object",
                    properties: {
                        clientId: { type: "string" },
                        id: { type: "string" }
                    },
                    required: ["clientId", "id"]
                }
            },
            {
                name: "get-credential-schema",
                description: "📋 View required fields for credential setup. WHAT: Shows the data structure and required fields for specific credential types. WHEN: Use before creating credentials to understand what authentication data is needed. RETURNS: Schema object with field definitions, types, and requirements. Triggers: 'credential requirements', 'what fields needed', 'credential setup help', 'authentication schema'. Examples: 'squareOAuth2Api', 'googleOAuth2Api', 'microsoftOAuth2Api'.",
                inputSchema: {
                    type: "object",
                    properties: {
                        clientId: { type: "string" },
                        credentialTypeName: { type: "string" }
                    },
                    required: ["clientId", "credentialTypeName"]
                }
            },
            // Execution Management Tools
            {
                name: "list-executions",
                description: "📈 View workflow execution history and performance logs. WHAT: Retrieves execution records with status, timing, and optional data payload. WHEN: Use to monitor workflow performance, debug failures, or track automation activity. RETURNS: Array of executions with timestamps, status, and workflow info. Triggers: 'workflow history', 'execution logs', 'automation activity', 'workflow performance', 'debug failures'. Filter by status (error/success) or specific workflows.",
                inputSchema: {
                    type: "object",
                    properties: {
                        clientId: { type: "string" },
                        includeData: { type: "boolean" },
                        status: {
                            type: "string",
                            enum: ["error", "success", "waiting"]
                        },
                        workflowId: { type: "string" },
                        limit: { type: "number" }
                    },
                    required: ["clientId"]
                }
            },
            {
                name: "get-execution",
                description: "🔎 Inspect detailed execution data and node outputs. WHAT: Retrieves complete execution details including node data, errors, and execution flow. WHEN: Use to debug specific workflow runs, analyze failures, or verify automation results. RETURNS: Full execution object with node outputs and error details. Triggers: 'execution details', 'debug workflow run', 'check automation results', 'workflow troubleshooting'.",
                inputSchema: {
                    type: "object",
                    properties: {
                        clientId: { type: "string" },
                        id: { type: "number" },
                        includeData: { type: "boolean" }
                    },
                    required: ["clientId", "id"]
                }
            },
            {
                name: "get-execution-details",
                description: "🔍 Get comprehensive execution details with enhanced error handling. WHAT: Retrieves full execution data with better error handling for large datasets. WHEN: Use when standard get-execution fails or you need complete execution data. RETURNS: Full execution details or graceful fallback with error info. Triggers: 'execution details', 'full execution data', 'detailed workflow run'.",
                inputSchema: {
                    type: "object",
                    properties: {
                        clientId: { type: "string" },
                        id: { type: "number" }
                    },
                    required: ["clientId", "id"]
                }
            },
            {
                name: "get-execution-logs",
                description: "📋 Extract error messages and logs from workflow execution. WHAT: Retrieves only error messages, node failures, and execution logs without full data payload. WHEN: Use to debug failures quickly without downloading massive execution data. RETURNS: Structured error information and execution logs. Triggers: 'execution errors', 'workflow logs', 'debug failure', 'error messages'.",
                inputSchema: {
                    type: "object",
                    properties: {
                        clientId: { type: "string" },
                        id: { type: "number" }
                    },
                    required: ["clientId", "id"]
                }
            },
            {
                name: "get-workflow-executions",
                description: "📊 List executions for a specific workflow with filtering. WHAT: Retrieves execution history for a single workflow with status filtering and limits. WHEN: Use to see execution patterns, recent failures, or success rates for a specific workflow. RETURNS: Filtered list of executions for the workflow. Triggers: 'workflow history', 'workflow executions', 'execution list for workflow'.",
                inputSchema: {
                    type: "object",
                    properties: {
                        clientId: { type: "string" },
                        workflowId: { type: "string" },
                        limit: { type: "number" },
                        status: {
                            type: "string",
                            enum: ["error", "success", "waiting"]
                        },
                        includeData: { type: "boolean" }
                    },
                    required: ["clientId", "workflowId"]
                }
            },
            {
                name: "retry-execution",
                description: "🔄 Retry a failed workflow execution. WHAT: Retries a specific failed execution with the same input data. WHEN: Use to retry failed workflows after fixing issues or temporary failures. RETURNS: New execution details from the retry attempt. Triggers: 'retry execution', 'retry failed workflow', 'rerun execution'.",
                inputSchema: {
                    type: "object",
                    properties: {
                        clientId: { type: "string" },
                        id: { type: "number" }
                    },
                    required: ["clientId", "id"]
                }
            },
            {
                name: "delete-execution",
                description: "Delete a specific execution by ID.",
                inputSchema: {
                    type: "object",
                    properties: {
                        clientId: { type: "string" },
                        id: { type: "number" }
                    },
                    required: ["clientId", "id"]
                }
            },
            // Tag Management Tools
            {
                name: "create-tag",
                description: "Create a new tag in your instance.",
                inputSchema: {
                    type: "object",
                    properties: {
                        clientId: { type: "string" },
                        name: { type: "string" }
                    },
                    required: ["clientId", "name"]
                }
            },
            {
                name: "list-tags",
                description: "Retrieve all tags from your instance.",
                inputSchema: {
                    type: "object",
                    properties: {
                        clientId: { type: "string" },
                        limit: { type: "number" }
                    },
                    required: ["clientId"]
                }
            },
            {
                name: "get-tag",
                description: "Retrieve a specific tag by ID.",
                inputSchema: {
                    type: "object",
                    properties: {
                        clientId: { type: "string" },
                        id: { type: "string" }
                    },
                    required: ["clientId", "id"]
                }
            },
            {
                name: "update-tag",
                description: "Update a tag's name.",
                inputSchema: {
                    type: "object",
                    properties: {
                        clientId: { type: "string" },
                        id: { type: "string" },
                        name: { type: "string" }
                    },
                    required: ["clientId", "id", "name"]
                }
            },
            {
                name: "delete-tag",
                description: "Delete a tag by ID.",
                inputSchema: {
                    type: "object",
                    properties: {
                        clientId: { type: "string" },
                        id: { type: "string" }
                    },
                    required: ["clientId", "id"]
                }
            },
            {
                name: "get-workflow-tags",
                description: "Get tags associated with a workflow.",
                inputSchema: {
                    type: "object",
                    properties: {
                        clientId: { type: "string" },
                        workflowId: { type: "string" }
                    },
                    required: ["clientId", "workflowId"]
                }
            },
            {
                name: "update-workflow-tags",
                description: "Update tags associated with a workflow.",
                inputSchema: {
                    type: "object",
                    properties: {
                        clientId: { type: "string" },
                        workflowId: { type: "string" },
                        tagIds: {
                            type: "array",
                            items: {
                                type: "object",
                                properties: {
                                    id: { type: "string" }
                                },
                                required: ["id"]
                            }
                        }
                    },
                    required: ["clientId", "workflowId", "tagIds"]
                }
            },
            // Security Audit Tool
            {
                name: "generate-audit",
                description: "🔒 Generate comprehensive security audit report. WHAT: Analyzes n8n instance for security vulnerabilities, credential risks, and configuration issues. WHEN: Use for security reviews, compliance checks, or troubleshooting security concerns. RETURNS: Detailed audit report with risk assessments by category. Triggers: 'security audit', 'security check', 'compliance report', 'vulnerability scan'. Categories: credentials, database, nodes, filesystem, instance settings.",
                inputSchema: {
                    type: "object",
                    properties: {
                        clientId: { type: "string" },
                        daysAbandonedWorkflow: { type: "number" },
                        categories: {
                            type: "array",
                            items: {
                                type: "string",
                                enum: ["credentials", "database", "nodes", "filesystem", "instance"]
                            }
                        }
                    },
                    required: ["clientId"]
                }
            },
            // Source Control Tool
            {
                name: "source-control-pull",
                description: "🔄 Pull changes from remote repository to n8n instance. WHAT: Synchronizes workflows, credentials, variables, and tags from connected Git repository. WHEN: Use to deploy updates from version control or sync changes from remote repository. RETURNS: Detailed import results showing variables, credentials, workflows, and tags (added/changed/conflicted) with conflict status and resolution details. Triggers: 'pull from git', 'sync repository', 'deploy from source control', 'update from repo'. Prerequisites: Requires Source Control feature to be licensed and connected to a repository. Note: If conflicts are detected, the operation will fail. Use 'force: true' to override conflicts and apply remote changes.",
                inputSchema: {
                    type: "object",
                    properties: {
                        clientId: { type: "string" },
                        force: {
                            type: "boolean",
                            description: "Force pull even if there are conflicts"
                        },
                        variables: {
                            type: "object",
                            description: "Variables to set during the pull operation"
                        }
                    },
                    required: ["clientId"]
                }
            },
            // Documentation Tools
            {
                name: "search-docs",
                description: "📚 Search n8n documentation by keywords and topics. WHAT: Performs intelligent search across all n8n documentation sections. WHEN: Use to find specific documentation, troubleshoot issues, or learn about features. RETURNS: Ranked list of relevant documentation sections with excerpts. Triggers: 'search docs', 'find documentation', 'how to', 'documentation for', 'help with'.",
                inputSchema: {
                    type: "object",
                    properties: {
                        query: {
                            type: "string",
                            description: "Search query (keywords, topics, or questions)"
                        },
                        limit: {
                            type: "number",
                            description: "Maximum number of results (default: 10)"
                        }
                    },
                    required: ["query"]
                }
            },
            {
                name: "get-doc-section",
                description: "📖 Get specific documentation section content. WHAT: Retrieves complete content of a specific documentation file. WHEN: Use when you have a specific documentation path from search results. RETURNS: Full documentation content for the specified section. Triggers: 'get documentation', 'show doc section', 'read documentation'.",
                inputSchema: {
                    type: "object",
                    properties: {
                        docPath: {
                            type: "string",
                            description: "Documentation file path (from search results)"
                        }
                    },
                    required: ["docPath"]
                }
            },
            {
                name: "list-doc-categories",
                description: "📂 Browse available documentation categories. WHAT: Lists all available documentation categories and sections. WHEN: Use to explore documentation structure or find general topic areas. RETURNS: Organized list of documentation categories. Triggers: 'list documentation', 'browse docs', 'documentation categories'.",
                inputSchema: {
                    type: "object",
                    properties: {
                        category: {
                            type: "string",
                            description: "Optional: filter by specific category"
                        }
                    }
                }
            },
            {
                name: "get-node-docs",
                description: "🔧 Get documentation for specific n8n nodes. WHAT: Retrieves documentation for specific n8n nodes (integrations, core nodes, etc.). WHEN: Use to understand node configuration, parameters, or usage examples. RETURNS: Node-specific documentation and usage guidelines. Triggers: 'node documentation', 'how to use node', 'node help'.",
                inputSchema: {
                    type: "object",
                    properties: {
                        nodeName: {
                            type: "string",
                            description: "Name of the n8n node (e.g., 'HTTP Request', 'Gmail', 'Slack')"
                        }
                    },
                    required: ["nodeName"]
                }
            }
        ]
    };
});
// Tool execution handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    switch (name) {
        case "init-n8n": {
            const { url, apiKey } = args;
            try {
                const client = new N8nClient(url, apiKey);
                // Test connection by listing workflows
                await client.listWorkflows();
                // Generate a unique client ID
                const clientId = Buffer.from(url).toString('base64');
                clients.set(clientId, client);
                return {
                    content: [{
                            type: "text",
                            text: `Successfully connected to n8n at ${url}. Use this client ID for future operations: ${clientId}`,
                        }]
                };
            }
            catch (error) {
                return {
                    content: [{
                            type: "text",
                            text: error instanceof Error ? error.message : "Unknown error occurred",
                        }],
                    isError: true
                };
            }
        }
        case "list-workflows": {
            const { clientId, nameFilter, activeOnly, tags } = args;
            const client = clients.get(clientId);
            if (!client) {
                return {
                    content: [{
                            type: "text",
                            text: "Client not initialized. Please run init-n8n first.",
                        }],
                    isError: true
                };
            }
            try {
                const workflows = await client.listWorkflows();
                let filteredWorkflows = workflows.data;
                // Apply name filter (case-insensitive partial match)
                if (nameFilter) {
                    const lowerNameFilter = nameFilter.toLowerCase();
                    filteredWorkflows = filteredWorkflows.filter(wf => wf.name.toLowerCase().includes(lowerNameFilter));
                }
                // Apply active status filter
                if (activeOnly !== undefined) {
                    filteredWorkflows = filteredWorkflows.filter(wf => wf.active === activeOnly);
                }
                // Apply tags filter (workflow must have at least one of the specified tags)
                if (tags && tags.length > 0) {
                    filteredWorkflows = filteredWorkflows.filter(wf => wf.tags && wf.tags.some(tag => tags.includes(tag)));
                }
                const formattedWorkflows = filteredWorkflows.map(wf => ({
                    id: wf.id,
                    name: wf.name,
                    active: wf.active,
                    created: wf.createdAt,
                    updated: wf.updatedAt,
                    tags: wf.tags,
                }));
                const resultMessage = nameFilter || activeOnly !== undefined || (tags && tags.length > 0)
                    ? `Found ${formattedWorkflows.length} workflows matching filters`
                    : `Found ${formattedWorkflows.length} workflows`;
                return {
                    content: [{
                            type: "text",
                            text: `${resultMessage}:\n\n${formatOutput(formattedWorkflows, config.output_verbosity)}`,
                        }]
                };
            }
            catch (error) {
                return {
                    content: [{
                            type: "text",
                            text: error instanceof Error ? error.message : "Unknown error occurred",
                        }],
                    isError: true
                };
            }
        }
        case "get-workflow": {
            const { clientId, id } = args;
            const client = clients.get(clientId);
            if (!client) {
                return {
                    content: [{
                            type: "text",
                            text: "Client not initialized. Please run init-n8n first.",
                        }],
                    isError: true
                };
            }
            try {
                const workflow = await client.getWorkflow(id);
                return {
                    content: [{
                            type: "text",
                            text: JSON.stringify(workflow, null, 2),
                        }]
                };
            }
            catch (error) {
                return {
                    content: [{
                            type: "text",
                            text: error instanceof Error ? error.message : "Unknown error occurred",
                        }],
                    isError: true
                };
            }
        }
        case "update-workflow": {
            const { clientId, id, workflow } = args;
            const client = clients.get(clientId);
            if (!client) {
                return {
                    content: [{
                            type: "text",
                            text: "Client not initialized. Please run init-n8n first.",
                        }],
                    isError: true
                };
            }
            try {
                const updatedWorkflow = await client.updateWorkflow(id, workflow);
                return {
                    content: [{
                            type: "text",
                            text: `Successfully updated workflow:\n${JSON.stringify(updatedWorkflow, null, 2)}`,
                        }]
                };
            }
            catch (error) {
                return {
                    content: [{
                            type: "text",
                            text: error instanceof Error ? error.message : "Unknown error occurred",
                        }],
                    isError: true
                };
            }
        }
        case "create-workflow": {
            const { clientId, name, nodes = [], connections = {} } = args;
            const client = clients.get(clientId);
            if (!client) {
                return {
                    content: [{
                            type: "text",
                            text: "Client not initialized. Please run init-n8n first.",
                        }],
                    isError: true
                };
            }
            try {
                const workflow = await client.createWorkflow(name, nodes, connections);
                return {
                    content: [{
                            type: "text",
                            text: `Successfully created workflow:\n${JSON.stringify(workflow, null, 2)}`,
                        }]
                };
            }
            catch (error) {
                return {
                    content: [{
                            type: "text",
                            text: error instanceof Error ? error.message : "Unknown error occurred",
                        }],
                    isError: true
                };
            }
        }
        case "validate-workflow": {
            const { clientId, workflowData } = args;
            const client = clients.get(clientId);
            if (!client) {
                return {
                    content: [{
                            type: "text",
                            text: "Client not initialized. Please run init-n8n first.",
                        }],
                    isError: true
                };
            }
            try {
                const validationResult = client.validateWorkflow(workflowData);
                return {
                    content: [{
                            type: "text",
                            text: JSON.stringify({
                                isValid: validationResult.isValid,
                                ...(validationResult.errors && { errors: validationResult.errors }),
                                ...(validationResult.validatedData && { message: "Workflow structure is valid" })
                            }, null, 2),
                        }]
                };
            }
            catch (error) {
                return {
                    content: [{
                            type: "text",
                            text: error instanceof Error ? error.message : "Unknown error occurred",
                        }],
                    isError: true
                };
            }
        }
        case "validate-node": {
            const { clientId, nodeData } = args;
            const client = clients.get(clientId);
            if (!client) {
                return {
                    content: [{
                            type: "text",
                            text: "Client not initialized. Please run init-n8n first.",
                        }],
                    isError: true
                };
            }
            try {
                const validationResult = client.validateNode(nodeData);
                return {
                    content: [{
                            type: "text",
                            text: JSON.stringify({
                                isValid: validationResult.isValid,
                                ...(validationResult.errors && { errors: validationResult.errors }),
                                ...(validationResult.validatedData && { message: "Node structure is valid" })
                            }, null, 2),
                        }]
                };
            }
            catch (error) {
                return {
                    content: [{
                            type: "text",
                            text: error instanceof Error ? error.message : "Unknown error occurred",
                        }],
                    isError: true
                };
            }
        }
        case "create-validated-workflow": {
            const { clientId, workflowInput } = args;
            const client = clients.get(clientId);
            if (!client) {
                return {
                    content: [{
                            type: "text",
                            text: "Client not initialized. Please run init-n8n first.",
                        }],
                    isError: true
                };
            }
            try {
                const workflow = await client.createValidatedWorkflow(workflowInput);
                return {
                    content: [{
                            type: "text",
                            text: `Successfully created validated workflow:\n${JSON.stringify(workflow, null, 2)}`,
                        }]
                };
            }
            catch (error) {
                return {
                    content: [{
                            type: "text",
                            text: error instanceof Error ? error.message : "Unknown error occurred",
                        }],
                    isError: true
                };
            }
        }
        case "list-available-nodes": {
            const { clientId, verbosity = 'concise', category } = args;
            const client = clients.get(clientId);
            if (!client) {
                return {
                    content: [{
                            type: "text",
                            text: "Client not initialized. Please run init-n8n first.",
                        }],
                    isError: true
                };
            }
            try {
                const nodes = await client.getAvailableNodes();
                // Sort nodes by name for easier reading
                nodes.sort((a, b) => a.name.localeCompare(b.name));
                // Group nodes by category for better organization
                const groupedNodes = {};
                for (const node of nodes) {
                    // Extract category from node name (e.g., "n8n-nodes-base.httpRequest" -> "n8n-nodes-base")
                    const parts = node.name.split('.');
                    const nodeCategory = parts.length > 1 ? parts[0] : 'other';
                    if (!groupedNodes[nodeCategory]) {
                        groupedNodes[nodeCategory] = [];
                    }
                    groupedNodes[nodeCategory].push({
                        name: node.name,
                        display_name: node.display_name,
                        description: node.description,
                    });
                }
                // Filter by category if specified
                let filteredCategories = Object.entries(groupedNodes);
                if (category) {
                    filteredCategories = filteredCategories.filter(([cat]) => cat.toLowerCase() === category.toLowerCase());
                }
                let output = '';
                // Create header
                output += `Found ${nodes.length} available nodes in the n8n instance.\n\n`;
                output += `When creating workflows, use these exact node types to ensure compatibility.\n\n`;
                // For summary mode, just show counts by category
                if (verbosity === 'summary') {
                    output += `Node counts by category:\n\n`;
                    filteredCategories.forEach(([cat, categoryNodes]) => {
                        output += `- ${cat}: ${categoryNodes.length} nodes\n`;
                    });
                    return {
                        content: [{ type: 'text', text: output }],
                    };
                }
                // For concise or full mode, show nodes by category
                output += `Available nodes by category:\n\n`;
                output += filteredCategories
                    .map(([cat, categoryNodes]) => {
                    return (`## ${cat}\n\n` +
                        categoryNodes
                            .map((node) => {
                            if (verbosity === 'full') {
                                return `- \`${node.name}\`: ${node.display_name}${node.description ? ` - ${node.description}` : ''}`;
                            }
                            else {
                                // Concise mode - just show name and display name
                                return `- \`${node.name}\`: ${node.display_name}`;
                            }
                        })
                            .join('\n'));
                })
                    .join('\n\n');
                return {
                    content: [{
                            type: "text",
                            text: output,
                        }]
                };
            }
            catch (error) {
                return {
                    content: [{
                            type: "text",
                            text: error instanceof Error ? error.message : "Unknown error occurred",
                        }],
                    isError: true
                };
            }
        }
        case "delete-workflow": {
            const { clientId, id } = args;
            const client = clients.get(clientId);
            if (!client) {
                return {
                    content: [{
                            type: "text",
                            text: "Client not initialized. Please run init-n8n first.",
                        }],
                    isError: true
                };
            }
            try {
                const workflow = await client.deleteWorkflow(id);
                return {
                    content: [{
                            type: "text",
                            text: `Successfully deleted workflow:\n${JSON.stringify(workflow, null, 2)}`,
                        }]
                };
            }
            catch (error) {
                return {
                    content: [{
                            type: "text",
                            text: error instanceof Error ? error.message : "Unknown error occurred",
                        }],
                    isError: true
                };
            }
        }
        case "activate-workflow": {
            const { clientId, id } = args;
            const client = clients.get(clientId);
            if (!client) {
                return {
                    content: [{
                            type: "text",
                            text: "Client not initialized. Please run init-n8n first.",
                        }],
                    isError: true
                };
            }
            try {
                const workflow = await client.activateWorkflow(id);
                return {
                    content: [{
                            type: "text",
                            text: `Successfully activated workflow:\n${JSON.stringify(workflow, null, 2)}`,
                        }]
                };
            }
            catch (error) {
                return {
                    content: [{
                            type: "text",
                            text: error instanceof Error ? error.message : "Unknown error occurred",
                        }],
                    isError: true
                };
            }
        }
        case "deactivate-workflow": {
            const { clientId, id } = args;
            const client = clients.get(clientId);
            if (!client) {
                return {
                    content: [{
                            type: "text",
                            text: "Client not initialized. Please run init-n8n first.",
                        }],
                    isError: true
                };
            }
            try {
                const workflow = await client.deactivateWorkflow(id);
                return {
                    content: [{
                            type: "text",
                            text: `Successfully deactivated workflow:\n${JSON.stringify(workflow, null, 2)}`,
                        }]
                };
            }
            catch (error) {
                return {
                    content: [{
                            type: "text",
                            text: error instanceof Error ? error.message : "Unknown error occurred",
                        }],
                    isError: true
                };
            }
        }
        case "list-projects": {
            const { clientId } = args;
            const client = clients.get(clientId);
            if (!client) {
                return {
                    content: [{
                            type: "text",
                            text: "Client not initialized. Please run init-n8n first.",
                        }],
                    isError: true
                };
            }
            try {
                const projects = await client.listProjects();
                return {
                    content: [{
                            type: "text",
                            text: JSON.stringify(projects.data, null, 2),
                        }]
                };
            }
            catch (error) {
                return {
                    content: [{
                            type: "text",
                            text: error instanceof Error ? error.message : "Unknown error occurred",
                        }],
                    isError: true
                };
            }
        }
        case "create-project": {
            const { clientId, name } = args;
            const client = clients.get(clientId);
            if (!client) {
                return {
                    content: [{
                            type: "text",
                            text: "Client not initialized. Please run init-n8n first.",
                        }],
                    isError: true
                };
            }
            try {
                await client.createProject(name);
                return {
                    content: [{
                            type: "text",
                            text: `Successfully created project: ${name}`,
                        }]
                };
            }
            catch (error) {
                return {
                    content: [{
                            type: "text",
                            text: error instanceof Error ? error.message : "Unknown error occurred",
                        }],
                    isError: true
                };
            }
        }
        case "delete-project": {
            const { clientId, projectId } = args;
            const client = clients.get(clientId);
            if (!client) {
                return {
                    content: [{
                            type: "text",
                            text: "Client not initialized. Please run init-n8n first.",
                        }],
                    isError: true
                };
            }
            try {
                await client.deleteProject(projectId);
                return {
                    content: [{
                            type: "text",
                            text: `Successfully deleted project with ID: ${projectId}`,
                        }]
                };
            }
            catch (error) {
                return {
                    content: [{
                            type: "text",
                            text: error instanceof Error ? error.message : "Unknown error occurred",
                        }],
                    isError: true
                };
            }
        }
        case "update-project": {
            const { clientId, projectId, name } = args;
            const client = clients.get(clientId);
            if (!client) {
                return {
                    content: [{
                            type: "text",
                            text: "Client not initialized. Please run init-n8n first.",
                        }],
                    isError: true
                };
            }
            try {
                await client.updateProject(projectId, name);
                return {
                    content: [{
                            type: "text",
                            text: `Successfully updated project ${projectId} with new name: ${name}`,
                        }]
                };
            }
            catch (error) {
                return {
                    content: [{
                            type: "text",
                            text: error instanceof Error ? error.message : "Unknown error occurred",
                        }],
                    isError: true
                };
            }
        }
        case "list-users": {
            const { clientId } = args;
            const client = clients.get(clientId);
            if (!client) {
                return {
                    content: [{
                            type: "text",
                            text: "Client not initialized. Please run init-n8n first.",
                        }],
                    isError: true
                };
            }
            try {
                const users = await client.listUsers();
                return {
                    content: [{
                            type: "text",
                            text: JSON.stringify(users.data, null, 2),
                        }]
                };
            }
            catch (error) {
                return {
                    content: [{
                            type: "text",
                            text: error instanceof Error ? error.message : "Unknown error occurred",
                        }],
                    isError: true
                };
            }
        }
        case "create-users": {
            const { clientId, users } = args;
            const client = clients.get(clientId);
            if (!client) {
                return {
                    content: [{
                            type: "text",
                            text: "Client not initialized. Please run init-n8n first.",
                        }],
                    isError: true
                };
            }
            try {
                const result = await client.createUsers(users);
                return {
                    content: [{
                            type: "text",
                            text: JSON.stringify(result, null, 2),
                        }]
                };
            }
            catch (error) {
                return {
                    content: [{
                            type: "text",
                            text: error instanceof Error ? error.message : "Unknown error occurred",
                        }],
                    isError: true
                };
            }
        }
        case "get-user": {
            const { clientId, idOrEmail } = args;
            const client = clients.get(clientId);
            if (!client) {
                return {
                    content: [{
                            type: "text",
                            text: "Client not initialized. Please run init-n8n first.",
                        }],
                    isError: true
                };
            }
            try {
                const user = await client.getUser(idOrEmail);
                return {
                    content: [{
                            type: "text",
                            text: JSON.stringify(user, null, 2),
                        }]
                };
            }
            catch (error) {
                return {
                    content: [{
                            type: "text",
                            text: error instanceof Error ? error.message : "Unknown error occurred",
                        }],
                    isError: true
                };
            }
        }
        case "delete-user": {
            const { clientId, idOrEmail } = args;
            const client = clients.get(clientId);
            if (!client) {
                return {
                    content: [{
                            type: "text",
                            text: "Client not initialized. Please run init-n8n first.",
                        }],
                    isError: true
                };
            }
            try {
                await client.deleteUser(idOrEmail);
                return {
                    content: [{
                            type: "text",
                            text: `Successfully deleted user: ${idOrEmail}`,
                        }]
                };
            }
            catch (error) {
                return {
                    content: [{
                            type: "text",
                            text: error instanceof Error ? error.message : "Unknown error occurred",
                        }],
                    isError: true
                };
            }
        }
        case "list-variables": {
            const { clientId } = args;
            const client = clients.get(clientId);
            if (!client) {
                return {
                    content: [{
                            type: "text",
                            text: "Client not initialized. Please run init-n8n first.",
                        }],
                    isError: true
                };
            }
            try {
                const variables = await client.listVariables();
                return {
                    content: [{
                            type: "text",
                            text: JSON.stringify(variables.data, null, 2),
                        }]
                };
            }
            catch (error) {
                return {
                    content: [{
                            type: "text",
                            text: error instanceof Error ? error.message : "Unknown error occurred",
                        }],
                    isError: true
                };
            }
        }
        case "create-variable": {
            const { clientId, key, value } = args;
            const client = clients.get(clientId);
            if (!client) {
                return {
                    content: [{
                            type: "text",
                            text: "Client not initialized. Please run init-n8n first.",
                        }],
                    isError: true
                };
            }
            try {
                await client.createVariable(key, value);
                return {
                    content: [{
                            type: "text",
                            text: `Successfully created variable with key: ${key}`,
                        }]
                };
            }
            catch (error) {
                return {
                    content: [{
                            type: "text",
                            text: error instanceof Error ? error.message : "Unknown error occurred",
                        }],
                    isError: true
                };
            }
        }
        case "delete-variable": {
            const { clientId, id } = args;
            const client = clients.get(clientId);
            if (!client) {
                return {
                    content: [{
                            type: "text",
                            text: "Client not initialized. Please run init-n8n first.",
                        }],
                    isError: true
                };
            }
            try {
                await client.deleteVariable(id);
                return {
                    content: [{
                            type: "text",
                            text: `Successfully deleted variable with ID: ${id}`,
                        }]
                };
            }
            catch (error) {
                return {
                    content: [{
                            type: "text",
                            text: error instanceof Error ? error.message : "Unknown error occurred",
                        }],
                    isError: true
                };
            }
        }
        case "create-credential": {
            const { clientId, name, type, data } = args;
            const client = clients.get(clientId);
            if (!client) {
                return {
                    content: [{
                            type: "text",
                            text: "Client not initialized. Please run init-n8n first.",
                        }],
                    isError: true
                };
            }
            try {
                const credential = await client.createCredential(name, type, data);
                return {
                    content: [{
                            type: "text",
                            text: `Successfully created credential:\n${JSON.stringify(credential, null, 2)}`,
                        }]
                };
            }
            catch (error) {
                return {
                    content: [{
                            type: "text",
                            text: error instanceof Error ? error.message : "Unknown error occurred",
                        }],
                    isError: true
                };
            }
        }
        case "delete-credential": {
            const { clientId, id } = args;
            const client = clients.get(clientId);
            if (!client) {
                return {
                    content: [{
                            type: "text",
                            text: "Client not initialized. Please run init-n8n first.",
                        }],
                    isError: true
                };
            }
            try {
                const result = await client.deleteCredential(id);
                return {
                    content: [{
                            type: "text",
                            text: `Successfully deleted credential:\n${JSON.stringify(result, null, 2)}`,
                        }]
                };
            }
            catch (error) {
                return {
                    content: [{
                            type: "text",
                            text: error instanceof Error ? error.message : "Unknown error occurred",
                        }],
                    isError: true
                };
            }
        }
        case "get-credential-schema": {
            const { clientId, credentialTypeName } = args;
            const client = clients.get(clientId);
            if (!client) {
                return {
                    content: [{
                            type: "text",
                            text: "Client not initialized. Please run init-n8n first.",
                        }],
                    isError: true
                };
            }
            try {
                const schema = await client.getCredentialSchema(credentialTypeName);
                return {
                    content: [{
                            type: "text",
                            text: JSON.stringify(schema, null, 2),
                        }]
                };
            }
            catch (error) {
                return {
                    content: [{
                            type: "text",
                            text: error instanceof Error ? error.message : "Unknown error occurred",
                        }],
                    isError: true
                };
            }
        }
        // Execution Management Handlers
        case "list-executions": {
            const { clientId, includeData, status, workflowId, limit } = args;
            const client = clients.get(clientId);
            if (!client) {
                return {
                    content: [{
                            type: "text",
                            text: "Client not initialized. Please run init-n8n first.",
                        }],
                    isError: true
                };
            }
            try {
                const executions = await client.getExecutions({ includeData, status, workflowId, limit });
                // Use smart truncation based on response size
                let responseText;
                if (includeData) {
                    // When includeData is true, use truncation to prevent overflow
                    responseText = truncateResponse(executions);
                }
                else {
                    // When includeData is false, provide a summary view
                    responseText = createSummaryResponse(executions);
                }
                return {
                    content: [{
                            type: "text",
                            text: responseText,
                        }]
                };
            }
            catch (error) {
                return {
                    content: [{
                            type: "text",
                            text: error instanceof Error ? error.message : "Unknown error occurred",
                        }],
                    isError: true
                };
            }
        }
        case "get-execution": {
            const { clientId, id, includeData } = args;
            const client = clients.get(clientId);
            if (!client) {
                return {
                    content: [{
                            type: "text",
                            text: "Client not initialized. Please run init-n8n first.",
                        }],
                    isError: true
                };
            }
            try {
                // CRITICAL FIX: Never fetch full execution data due to massive size
                // Always fetch without data first, then provide summary
                const execution = await client.getExecution(id, false);
                let responseText;
                if (includeData) {
                    // Instead of fetching massive execution data, provide rich metadata summary
                    const summary = {
                        ...execution,
                        dataNote: "Full execution data not included due to size constraints. Use workflow analysis tools or n8n UI for detailed execution data.",
                        dataAvailable: "Use includeData: false for basic execution info, or check execution in n8n interface for full details"
                    };
                    responseText = JSON.stringify(summary, null, 2);
                }
                else {
                    responseText = JSON.stringify(execution, null, 2);
                }
                return {
                    content: [{
                            type: "text",
                            text: responseText,
                        }]
                };
            }
            catch (error) {
                return {
                    content: [{
                            type: "text",
                            text: error instanceof Error ? error.message : "Unknown error occurred",
                        }],
                    isError: true
                };
            }
        }
        case "get-execution-details": {
            const { clientId, id } = args;
            const client = clients.get(clientId);
            if (!client) {
                return {
                    content: [{
                            type: "text",
                            text: "Client not initialized. Please run init-n8n first.",
                        }],
                    isError: true
                };
            }
            try {
                const execution = await client.getExecutionDetails(id);
                return {
                    content: [{
                            type: "text",
                            text: truncateResponse(execution),
                        }]
                };
            }
            catch (error) {
                return {
                    content: [{
                            type: "text",
                            text: error instanceof Error ? error.message : "Unknown error occurred",
                        }],
                    isError: true
                };
            }
        }
        case "get-execution-logs": {
            const { clientId, id } = args;
            const client = clients.get(clientId);
            if (!client) {
                return {
                    content: [{
                            type: "text",
                            text: "Client not initialized. Please run init-n8n first.",
                        }],
                    isError: true
                };
            }
            try {
                const logs = await client.getExecutionLogs(id);
                return {
                    content: [{
                            type: "text",
                            text: JSON.stringify(logs, null, 2),
                        }]
                };
            }
            catch (error) {
                return {
                    content: [{
                            type: "text",
                            text: error instanceof Error ? error.message : "Unknown error occurred",
                        }],
                    isError: true
                };
            }
        }
        case "get-workflow-executions": {
            const { clientId, workflowId, limit, status, includeData } = args;
            const client = clients.get(clientId);
            if (!client) {
                return {
                    content: [{
                            type: "text",
                            text: "Client not initialized. Please run init-n8n first.",
                        }],
                    isError: true
                };
            }
            try {
                const executions = await client.getWorkflowExecutions(workflowId, { limit, status, includeData });
                return {
                    content: [{
                            type: "text",
                            text: includeData ? truncateResponse(executions) : createSummaryResponse(executions),
                        }]
                };
            }
            catch (error) {
                return {
                    content: [{
                            type: "text",
                            text: error instanceof Error ? error.message : "Unknown error occurred",
                        }],
                    isError: true
                };
            }
        }
        case "retry-execution": {
            const { clientId, id } = args;
            const client = clients.get(clientId);
            if (!client) {
                return {
                    content: [{
                            type: "text",
                            text: "Client not initialized. Please run init-n8n first.",
                        }],
                    isError: true
                };
            }
            try {
                const result = await client.retryExecution(id);
                return {
                    content: [{
                            type: "text",
                            text: `Successfully retried execution:\n${JSON.stringify(result, null, 2)}`,
                        }]
                };
            }
            catch (error) {
                return {
                    content: [{
                            type: "text",
                            text: error instanceof Error ? error.message : "Unknown error occurred",
                        }],
                    isError: true
                };
            }
        }
        case "delete-execution": {
            const { clientId, id } = args;
            const client = clients.get(clientId);
            if (!client) {
                return {
                    content: [{
                            type: "text",
                            text: "Client not initialized. Please run init-n8n first.",
                        }],
                    isError: true
                };
            }
            try {
                const execution = await client.deleteExecution(id);
                return {
                    content: [{
                            type: "text",
                            text: `Successfully deleted execution:\n${JSON.stringify(execution, null, 2)}`,
                        }]
                };
            }
            catch (error) {
                return {
                    content: [{
                            type: "text",
                            text: error instanceof Error ? error.message : "Unknown error occurred",
                        }],
                    isError: true
                };
            }
        }
        // Tag Management Handlers
        case "create-tag": {
            const { clientId, name } = args;
            const client = clients.get(clientId);
            if (!client) {
                return {
                    content: [{
                            type: "text",
                            text: "Client not initialized. Please run init-n8n first.",
                        }],
                    isError: true
                };
            }
            try {
                const tag = await client.createTag(name);
                return {
                    content: [{
                            type: "text",
                            text: `Successfully created tag:\n${JSON.stringify(tag, null, 2)}`,
                        }]
                };
            }
            catch (error) {
                return {
                    content: [{
                            type: "text",
                            text: error instanceof Error ? error.message : "Unknown error occurred",
                        }],
                    isError: true
                };
            }
        }
        case "list-tags": {
            const { clientId, limit } = args;
            const client = clients.get(clientId);
            if (!client) {
                return {
                    content: [{
                            type: "text",
                            text: "Client not initialized. Please run init-n8n first.",
                        }],
                    isError: true
                };
            }
            try {
                const tags = await client.getTags({ limit });
                return {
                    content: [{
                            type: "text",
                            text: JSON.stringify(tags.data, null, 2),
                        }]
                };
            }
            catch (error) {
                return {
                    content: [{
                            type: "text",
                            text: error instanceof Error ? error.message : "Unknown error occurred",
                        }],
                    isError: true
                };
            }
        }
        case "get-tag": {
            const { clientId, id } = args;
            const client = clients.get(clientId);
            if (!client) {
                return {
                    content: [{
                            type: "text",
                            text: "Client not initialized. Please run init-n8n first.",
                        }],
                    isError: true
                };
            }
            try {
                const tag = await client.getTag(id);
                return {
                    content: [{
                            type: "text",
                            text: JSON.stringify(tag, null, 2),
                        }]
                };
            }
            catch (error) {
                return {
                    content: [{
                            type: "text",
                            text: error instanceof Error ? error.message : "Unknown error occurred",
                        }],
                    isError: true
                };
            }
        }
        case "update-tag": {
            const { clientId, id, name } = args;
            const client = clients.get(clientId);
            if (!client) {
                return {
                    content: [{
                            type: "text",
                            text: "Client not initialized. Please run init-n8n first.",
                        }],
                    isError: true
                };
            }
            try {
                const tag = await client.updateTag(id, name);
                return {
                    content: [{
                            type: "text",
                            text: `Successfully updated tag:\n${JSON.stringify(tag, null, 2)}`,
                        }]
                };
            }
            catch (error) {
                return {
                    content: [{
                            type: "text",
                            text: error instanceof Error ? error.message : "Unknown error occurred",
                        }],
                    isError: true
                };
            }
        }
        case "delete-tag": {
            const { clientId, id } = args;
            const client = clients.get(clientId);
            if (!client) {
                return {
                    content: [{
                            type: "text",
                            text: "Client not initialized. Please run init-n8n first.",
                        }],
                    isError: true
                };
            }
            try {
                const tag = await client.deleteTag(id);
                return {
                    content: [{
                            type: "text",
                            text: `Successfully deleted tag:\n${JSON.stringify(tag, null, 2)}`,
                        }]
                };
            }
            catch (error) {
                return {
                    content: [{
                            type: "text",
                            text: error instanceof Error ? error.message : "Unknown error occurred",
                        }],
                    isError: true
                };
            }
        }
        case "get-workflow-tags": {
            const { clientId, workflowId } = args;
            const client = clients.get(clientId);
            if (!client) {
                return {
                    content: [{
                            type: "text",
                            text: "Client not initialized. Please run init-n8n first.",
                        }],
                    isError: true
                };
            }
            try {
                const tags = await client.getWorkflowTags(workflowId);
                return {
                    content: [{
                            type: "text",
                            text: JSON.stringify(tags, null, 2),
                        }]
                };
            }
            catch (error) {
                return {
                    content: [{
                            type: "text",
                            text: error instanceof Error ? error.message : "Unknown error occurred",
                        }],
                    isError: true
                };
            }
        }
        case "update-workflow-tags": {
            const { clientId, workflowId, tagIds } = args;
            const client = clients.get(clientId);
            if (!client) {
                return {
                    content: [{
                            type: "text",
                            text: "Client not initialized. Please run init-n8n first.",
                        }],
                    isError: true
                };
            }
            try {
                const tags = await client.updateWorkflowTags(workflowId, tagIds);
                return {
                    content: [{
                            type: "text",
                            text: `Successfully updated workflow tags:\n${JSON.stringify(tags, null, 2)}`,
                        }]
                };
            }
            catch (error) {
                return {
                    content: [{
                            type: "text",
                            text: error instanceof Error ? error.message : "Unknown error occurred",
                        }],
                    isError: true
                };
            }
        }
        case "generate-audit": {
            const { clientId, daysAbandonedWorkflow, categories } = args;
            const client = clients.get(clientId);
            if (!client) {
                return {
                    content: [{
                            type: "text",
                            text: "Client not initialized. Please run init-n8n first.",
                        }],
                    isError: true
                };
            }
            try {
                const audit = await client.generateAudit({ daysAbandonedWorkflow, categories });
                return {
                    content: [{
                            type: "text",
                            text: JSON.stringify(audit, null, 2),
                        }]
                };
            }
            catch (error) {
                return {
                    content: [{
                            type: "text",
                            text: error instanceof Error ? error.message : "Unknown error occurred",
                        }],
                    isError: true
                };
            }
        }
        case "source-control-pull": {
            const { clientId, force, variables } = args;
            const client = clients.get(clientId);
            if (!client) {
                return {
                    content: [{
                            type: "text",
                            text: "Client not initialized. Please run init-n8n first.",
                        }],
                    isError: true
                };
            }
            try {
                const result = await client.pullSourceControl({ force, variables });
                return {
                    content: [{
                            type: "text",
                            text: `Successfully pulled from source control:\n${JSON.stringify(result, null, 2)}`,
                        }]
                };
            }
            catch (error) {
                return {
                    content: [{
                            type: "text",
                            text: error instanceof Error ? error.message : "Unknown error occurred",
                        }],
                    isError: true
                };
            }
        }
        // Documentation Tool Handlers
        case "search-docs": {
            const { query, limit = 10 } = args;
            try {
                const results = docManager.searchDocuments(query, limit);
                return {
                    content: [{
                            type: "text",
                            text: JSON.stringify({
                                query,
                                totalResults: results.length,
                                results: results.map(result => ({
                                    path: result.path,
                                    title: result.title,
                                    category: result.category,
                                    excerpt: result.excerpt,
                                    relevanceScore: Math.round(result.relevanceScore * 100) / 100
                                }))
                            }, null, 2),
                        }]
                };
            }
            catch (error) {
                return {
                    content: [{
                            type: "text",
                            text: `Error searching documentation: ${error}`,
                        }],
                    isError: true
                };
            }
        }
        case "get-doc-section": {
            const { docPath } = args;
            try {
                const doc = docManager.getDocument(docPath);
                if (!doc) {
                    return {
                        content: [{
                                type: "text",
                                text: `Documentation not found: ${docPath}`,
                            }],
                        isError: true
                    };
                }
                return {
                    content: [{
                            type: "text",
                            text: JSON.stringify({
                                path: doc.path,
                                title: doc.title,
                                category: doc.category,
                                content: doc.content
                            }, null, 2),
                        }]
                };
            }
            catch (error) {
                return {
                    content: [{
                            type: "text",
                            text: `Error retrieving documentation: ${error}`,
                        }],
                    isError: true
                };
            }
        }
        case "list-doc-categories": {
            const { category } = args;
            try {
                if (category) {
                    const docs = docManager.getDocumentsByCategory(category);
                    return {
                        content: [{
                                type: "text",
                                text: JSON.stringify({
                                    category,
                                    documents: docs.map(doc => ({
                                        path: doc.path,
                                        title: doc.title
                                    }))
                                }, null, 2),
                            }]
                    };
                }
                else {
                    const categories = docManager.getCategories();
                    return {
                        content: [{
                                type: "text",
                                text: JSON.stringify({
                                    categories: categories.map(cat => ({
                                        name: cat,
                                        documentCount: docManager.getDocumentsByCategory(cat).length
                                    }))
                                }, null, 2),
                            }]
                    };
                }
            }
            catch (error) {
                return {
                    content: [{
                            type: "text",
                            text: `Error listing documentation categories: ${error}`,
                        }],
                    isError: true
                };
            }
        }
        case "get-node-docs": {
            const { nodeName } = args;
            try {
                const nodeDoc = docManager.getNodeDocumentation(nodeName);
                if (!nodeDoc) {
                    // Fallback to general search for the node name
                    const searchResults = docManager.searchDocuments(`${nodeName} node`, 3);
                    if (searchResults.length === 0) {
                        return {
                            content: [{
                                    type: "text",
                                    text: `No documentation found for node: ${nodeName}`,
                                }],
                            isError: true
                        };
                    }
                    return {
                        content: [{
                                type: "text",
                                text: JSON.stringify({
                                    nodeName,
                                    message: "Exact node documentation not found, showing related results:",
                                    relatedDocuments: searchResults.map(result => ({
                                        path: result.path,
                                        title: result.title,
                                        category: result.category,
                                        excerpt: result.excerpt
                                    }))
                                }, null, 2),
                            }]
                    };
                }
                return {
                    content: [{
                            type: "text",
                            text: JSON.stringify({
                                nodeName,
                                documentation: {
                                    path: nodeDoc.path,
                                    title: nodeDoc.title,
                                    category: nodeDoc.category,
                                    content: nodeDoc.content
                                }
                            }, null, 2),
                        }]
                };
            }
            catch (error) {
                return {
                    content: [{
                            type: "text",
                            text: `Error retrieving node documentation: ${error}`,
                        }],
                    isError: true
                };
            }
        }
        default:
            return {
                content: [{
                        type: "text",
                        text: `Unknown tool: ${name}`,
                    }],
                isError: true
            };
    }
});
// Setup resource handlers
setupResourceHandlers(server, clients);
// Start the server
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("N8N MCP Server running on stdio");
