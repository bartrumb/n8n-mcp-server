#!/usr/bin/env node

// Test script to verify our fix works with real n8n execution data
import fetch from 'node-fetch';

// Copy our truncation functions
const MAX_RESPONSE_TOKENS = 20000;
const TRUNCATION_MESSAGE = "\n\n[Response truncated due to size limits. Use more specific filtering or pagination to get complete data.]";

function estimateTokenCount(text) {
  return Math.ceil(text.length / 4);
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
  const maxLength = MAX_RESPONSE_TOKENS * 4;
  return jsonString.substring(0, maxLength) + TRUNCATION_MESSAGE;
}

function truncateExecutionItem(execution) {
  if (!execution) return execution;
  
  const truncated = {
    id: execution.id,
    mode: execution.mode,
    status: execution.status,
    startedAt: execution.startedAt,
    stoppedAt: execution.stoppedAt,
    workflowId: execution.workflowId,
    waitTill: execution.waitTill
  };
  
  if (execution.data && typeof execution.data === 'object') {
    truncated.data = {
      ...execution.data,
      executionData: execution.data.executionData ? {
        ...execution.data.executionData,
        nodeExecutionStack: execution.data.executionData.nodeExecutionStack ? 
          `[${execution.data.executionData.nodeExecutionStack.length} items - truncated]` : undefined,
        contextNodeName: execution.data.executionData.contextNodeName
      } : undefined
    };
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

// Test with real n8n API
const baseUrl = 'https://n8n.shopdawg.io';
const apiKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIwMDMzNGYxYi1hZDcxLTQzYmItYmI5MC0zNGE1ZmFjYjk0NjkiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwiaWF0IjoxNzQxNzE1MjU3fQ.0pGLo6PKCofSOm28vj1i6S0OR91I4nBsi7ePC3AbLAM';

async function testRealExecution() {
  console.log('=== Testing Real N8N Execution Data ===\n');
  
  try {
    // Test the problematic execution 375 with includeData
    console.log('Fetching execution 375 with data...');
    const response = await fetch(`${baseUrl}/api/v1/executions/375?includeData=true`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const execution = await response.json();
    console.log(`✓ Fetched execution data`);
    
    // Test our truncation function
    const originalSize = estimateTokenCount(JSON.stringify(execution, null, 2));
    console.log(`Original size: ${originalSize} tokens`);
    
    const truncatedResult = truncateResponse(execution);
    const truncatedSize = estimateTokenCount(truncatedResult);
    
    console.log(`Truncated size: ${truncatedSize} tokens`);
    console.log(`Reduction: ${((originalSize - truncatedSize) / originalSize * 100).toFixed(1)}%`);
    
    if (truncatedSize <= 25000) {
      console.log('✅ SUCCESS: Truncated response is within token limits!');
      
      // Show a sample of the truncated response
      console.log('\nSample of truncated response:');
      console.log(truncatedResult.substring(0, 500) + '...');
      
    } else {
      console.log('❌ FAILED: Truncated response still exceeds limits');
    }
    
  } catch (error) {
    console.error('Error testing real execution:', error.message);
  }
}

await testRealExecution();