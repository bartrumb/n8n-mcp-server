import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ErrorCode,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { config, formatOutput } from './config.js';

/**
 * Sets up MCP resource handlers for the n8n workflow builder server
 */
export function setupResourceHandlers(
  server: Server,
  clients: Map<string, any>, // N8nClient instances
) {
  // List available resources
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      {
        uri: `n8n://workflows`,
        name: `n8n Workflows`,
        mimeType: 'application/json',
        description: 'List of all workflows in n8n',
      },
    ],
  }));

  // List resource templates
  server.setRequestHandler(
    ListResourceTemplatesRequestSchema,
    async () => ({
      resourceTemplates: [
        {
          uriTemplate: 'n8n://workflows/{id}',
          name: 'n8n Workflow',
          mimeType: 'application/json',
          description: 'Details of a specific n8n workflow',
        },
        {
          uriTemplate: 'n8n://executions/{id}',
          name: 'n8n Execution',
          mimeType: 'application/json',
          description: 'Details of a specific n8n workflow execution',
        },
      ],
    }),
  );

  // Read resource handler
  server.setRequestHandler(
    ReadResourceRequestSchema,
    async (request) => {
      const { uri } = request.params;

      // Handle workflows list
      if (uri === 'n8n://workflows') {
        try {
          // Get the first available client (in a real implementation, you might want to specify which client)
          const client = clients.values().next().value;
          if (!client) {
            throw new McpError(
              ErrorCode.InternalError,
              'No n8n client available. Please initialize a client first.',
            );
          }

          const workflows = await client.listWorkflows();
          return {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: formatOutput(workflows.data, config.output_verbosity),
              },
            ],
          };
        } catch (error: any) {
          throw new McpError(
            ErrorCode.InternalError,
            `Failed to fetch workflows: ${
              error.message || String(error)
            }`,
          );
        }
      }

      // Handle specific workflow
      const workflowMatch = uri.match(/^n8n:\/\/workflows\/(.+)$/);
      if (workflowMatch) {
        const workflowId = workflowMatch[1];
        try {
          const client = clients.values().next().value;
          if (!client) {
            throw new McpError(
              ErrorCode.InternalError,
              'No n8n client available. Please initialize a client first.',
            );
          }

          const workflow = await client.getWorkflow(workflowId);
          return {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: formatOutput(workflow, config.output_verbosity),
              },
            ],
          };
        } catch (error: any) {
          throw new McpError(
            ErrorCode.InternalError,
            `Failed to fetch workflow ${workflowId}: ${
              error.message || String(error)
            }`,
          );
        }
      }

      // Handle specific execution
      const executionMatch = uri.match(/^n8n:\/\/executions\/(.+)$/);
      if (executionMatch) {
        const executionId = parseInt(executionMatch[1], 10);
        try {
          const client = clients.values().next().value;
          if (!client) {
            throw new McpError(
              ErrorCode.InternalError,
              'No n8n client available. Please initialize a client first.',
            );
          }

          const execution = await client.getExecution(executionId, false); // Don't include data to avoid token overflow
          return {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: formatOutput(execution, config.output_verbosity),
              },
            ],
          };
        } catch (error: any) {
          throw new McpError(
            ErrorCode.InternalError,
            `Failed to fetch execution ${executionId}: ${
              error.message || String(error)
            }`,
          );
        }
      }

      throw new McpError(
        ErrorCode.InvalidRequest,
        `Invalid URI format: ${uri}. Supported formats: n8n://workflows, n8n://workflows/{id}, n8n://executions/{id}`,
      );
    },
  );
}