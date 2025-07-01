// Example usage of the new schema validation functionality
// This file demonstrates how to use the new validation features

import { NodeSchema, WorkflowSchema, CreateWorkflowInputSchema } from './build/schemas.js';

// Example valid node
const validNode = {
  id: "node1",
  name: "HTTP Request",
  type: "n8n-nodes-base.httpRequest",
  position: [100, 200],
  parameters: {
    url: "https://api.example.com",
    method: "GET"
  },
  typeVersion: 1
};

// Example valid workflow
const validWorkflow = {
  name: "Example Workflow",
  nodes: [validNode],
  connections: {},
  settings: {
    saveExecutionProgress: true,
    saveManualExecutions: true
  }
};

// Example workflow input for creation
const createWorkflowInput = {
  workflow: validWorkflow,
  activate: false
};

// Validation examples
console.log('Testing schema validation:');

try {
  const validatedNode = NodeSchema.parse(validNode);
  console.log('✅ Node validation passed');
} catch (error) {
  console.log('❌ Node validation failed:', error.errors);
}

try {
  const validatedWorkflow = WorkflowSchema.parse(validWorkflow);
  console.log('✅ Workflow validation passed');
} catch (error) {
  console.log('❌ Workflow validation failed:', error.errors);
}

try {
  const validatedInput = CreateWorkflowInputSchema.parse(createWorkflowInput);
  console.log('✅ Create workflow input validation passed');
} catch (error) {
  console.log('❌ Create workflow input validation failed:', error.errors);
}

// Example invalid node (missing required fields)
const invalidNode = {
  name: "Invalid Node"
  // Missing id, type, position
};

try {
  const validatedInvalidNode = NodeSchema.parse(invalidNode);
  console.log('✅ Invalid node validation passed (unexpected!)');
} catch (error) {
  console.log('❌ Invalid node validation failed as expected:', error.errors.map(e => e.message));
}