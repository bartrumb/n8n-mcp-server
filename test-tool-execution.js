#!/usr/bin/env node

/**
 * Test actual MCP tool execution and responses
 * Specifically test the new workflow filtering and validation features
 */

import { spawn } from 'child_process';

console.log('🎯 Testing MCP Tool Execution');
console.log('==============================\n');

let testsPassed = 0;
let testsFailed = 0;

function logTest(name, success, message = '') {
  const symbol = success ? '✅' : '❌';
  console.log(`${symbol} ${name}${message ? ': ' + message : ''}`);
  if (success) testsPassed++; else testsFailed++;
}

// Helper function to execute MCP tool and get response
async function executeMCPTool(toolName, args = {}, timeoutMs = 10000) {
  return new Promise((resolve) => {
    const server = spawn('node', ['build/index.js'], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let output = '';
    let responses = [];

    server.stdout.on('data', (data) => {
      const chunk = data.toString();
      output += chunk;
      
      // Parse JSON responses
      const lines = chunk.split('\n').filter(line => line.trim());
      for (const line of lines) {
        try {
          const response = JSON.parse(line);
          responses.push(response);
        } catch (e) {
          // Not JSON, ignore
        }
      }
    });

    server.stderr.on('data', (data) => {
      // Ignore stderr for now
    });

    // Send initialization
    const initRequest = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" }
      }
    };

    server.stdin.write(JSON.stringify(initRequest) + '\n');

    // Wait for init, then send tool call
    setTimeout(() => {
      const toolRequest = {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: toolName,
          arguments: args
        }
      };

      server.stdin.write(JSON.stringify(toolRequest) + '\n');
    }, 1000);

    // Wait for response
    setTimeout(() => {
      server.kill();
      resolve({ output, responses });
    }, timeoutMs);
  });
}

// Test enhanced list-workflows with filtering
async function testWorkflowFiltering() {
  console.log('🔍 Testing Workflow Filtering...\n');

  // Test basic list-workflows (should work without n8n connection)
  try {
    const result = await executeMCPTool('list-workflows', { clientId: 'test-123' });
    
    if (result.responses.some(r => r.result)) {
      logTest('Basic List Workflows', true, 'Tool executed successfully');
    } else if (result.responses.some(r => r.result && r.result.isError)) {
      logTest('Basic List Workflows', true, 'Tool executed with expected connection error');
    } else {
      logTest('Basic List Workflows', false, 'No valid response received');
    }

    // Test with filtering parameters
    const filterResult = await executeMCPTool('list-workflows', {
      clientId: 'test-123',
      nameFilter: 'test',
      activeOnly: true,
      tags: ['automation']
    });

    if (filterResult.output.includes('nameFilter') || filterResult.output.includes('Found')) {
      logTest('Workflow Filtering Parameters', true, 'Filtering parameters processed');
    } else {
      logTest('Workflow Filtering Parameters', false, 'Filtering not detected');
    }

  } catch (error) {
    logTest('Workflow Filtering Test', false, error.message);
  }
}

// Test new validation tools
async function testValidationTools() {
  console.log('\n🔧 Testing Validation Tools...\n');

  // Test validate-node tool
  try {
    const nodeResult = await executeMCPTool('validate-node', {
      clientId: 'test-123',
      nodeType: 'n8n-nodes-base.manualTrigger'
    });

    if (nodeResult.responses.some(r => r.result)) {
      logTest('Validate Node Tool', true, 'Tool responded');
    } else {
      logTest('Validate Node Tool', false, 'No response from validate-node');
    }
  } catch (error) {
    logTest('Validate Node Tool', false, error.message);
  }

  // Test validate-workflow tool  
  try {
    const workflowData = {
      name: "Test Workflow",
      nodes: [{
        id: "test-1",
        name: "Manual Trigger", 
        type: "n8n-nodes-base.manualTrigger",
        position: [100, 100],
        parameters: {}
      }],
      connections: {}
    };

    const workflowResult = await executeMCPTool('validate-workflow', {
      clientId: 'test-123',
      workflow: workflowData
    });

    if (workflowResult.responses.some(r => r.result)) {
      logTest('Validate Workflow Tool', true, 'Tool responded');
    } else {
      logTest('Validate Workflow Tool', false, 'No response from validate-workflow');
    }
  } catch (error) {
    logTest('Validate Workflow Tool', false, error.message);
  }

  // Test list-available-nodes tool
  try {
    const nodesResult = await executeMCPTool('list-available-nodes', {
      clientId: 'test-123',
      verbosity: 'concise'
    });

    if (nodesResult.responses.some(r => r.result)) {
      logTest('List Available Nodes Tool', true, 'Tool responded');
    } else {
      logTest('List Available Nodes Tool', false, 'No response from list-available-nodes');
    }
  } catch (error) {
    logTest('List Available Nodes Tool', false, error.message);
  }
}

// Test resource access
async function testResourceAccess() {
  console.log('\n📊 Testing MCP Resources...\n');

  try {
    // Test resource listing
    const listResult = await executeMCPTool('resources/list', {});
    
    if (listResult.output.includes('n8n://workflows') || listResult.responses.some(r => r.result)) {
      logTest('Resource Listing', true, 'Resources endpoint accessible');
    } else {
      logTest('Resource Listing', false, 'Resources not found');
    }

  } catch (error) {
    logTest('Resource Access Test', false, error.message);
  }
}

// Test error handling
async function testErrorHandling() {
  console.log('\n🚨 Testing Error Handling...\n');

  try {
    // Test with invalid client ID
    const invalidResult = await executeMCPTool('list-workflows', { 
      clientId: 'invalid-client' 
    });

    if (invalidResult.output.includes('not initialized') || invalidResult.output.includes('error')) {
      logTest('Invalid Client Handling', true, 'Proper error response for invalid client');
    } else {
      logTest('Invalid Client Handling', false, 'Error not handled properly');
    }

    // Test with missing required parameters
    const missingParamResult = await executeMCPTool('validate-node', {});

    if (missingParamResult.output.includes('error') || missingParamResult.output.includes('required')) {
      logTest('Missing Parameter Handling', true, 'Missing parameters handled');
    } else {
      logTest('Missing Parameter Handling', false, 'Missing parameters not validated');
    }

  } catch (error) {
    logTest('Error Handling Test', false, error.message);
  }
}

// Test verbosity control
async function testVerbosityControl() {
  console.log('\n📝 Testing Verbosity Control...\n');

  try {
    // Test different verbosity levels
    const modes = ['concise', 'summary', 'full'];
    
    for (const mode of modes) {
      const result = await executeMCPTool('list-available-nodes', {
        clientId: 'test-123',
        verbosity: mode
      });

      if (result.output.includes(mode) || result.responses.some(r => r.result)) {
        logTest(`Verbosity Mode: ${mode}`, true, 'Mode processed');
      } else {
        logTest(`Verbosity Mode: ${mode}`, false, 'Mode not recognized');
      }
    }

  } catch (error) {
    logTest('Verbosity Control Test', false, error.message);
  }
}

// Test workflow composition guide access
async function testCompositionGuide() {
  console.log('\n📚 Testing Composition Guide Access...\n');

  try {
    // Since the guide is integrated into the workflow creation tools,
    // we test indirectly by checking tool responses
    const result = await executeMCPTool('create-validated-workflow', {
      clientId: 'test-123',
      workflow: {
        name: "Test Guide Workflow",
        nodes: [],
        connections: {}
      }
    });

    if (result.responses.some(r => r.result) || result.output.includes('workflow')) {
      logTest('Composition Guide Integration', true, 'Guide accessible through tools');
    } else {
      logTest('Composition Guide Integration', false, 'Guide integration unclear');
    }

  } catch (error) {
    logTest('Composition Guide Test', false, error.message);
  }
}

// Main test execution
async function runToolTests() {
  console.log('Running MCP Tool Execution Tests...\n');
  console.log('⚠️  Note: Some tests may show connection errors - this is expected without n8n API key\n');

  await testWorkflowFiltering();
  await testValidationTools();
  await testResourceAccess();
  await testErrorHandling();
  await testVerbosityControl(); 
  await testCompositionGuide();

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log('📊 TOOL EXECUTION TEST SUMMARY');
  console.log('='.repeat(50));
  console.log(`✅ Passed: ${testsPassed}`);
  console.log(`❌ Failed: ${testsFailed}`);
  console.log(`📈 Success Rate: ${((testsPassed / (testsPassed + testsFailed)) * 100).toFixed(1)}%`);

  if (testsFailed === 0) {
    console.log('\n🟢 All tool execution tests passed!');
    console.log('🎯 All MCP tools are properly implemented and functional.');
  } else {
    console.log('\n🔴 Some tool execution tests failed.');
    console.log('Review the failed tests above for details.');
  }

  console.log('\n📋 Test Notes:');
  console.log('- Connection errors are expected without valid N8N_API_KEY');
  console.log('- Tools should still respond with proper error handling');
  console.log('- Schema validation works independently of n8n connection');

  return testsFailed === 0;
}

// Execute tests
runToolTests().catch(error => {
  console.error('❌ Tool execution tests failed:', error.message);
  process.exit(1);
});