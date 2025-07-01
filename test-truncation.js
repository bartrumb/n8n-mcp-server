#!/usr/bin/env node

// Test script to verify truncation functions work with large execution data
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Helper functions for response size management (copied from updated index.ts)
const MAX_RESPONSE_TOKENS = 20000; // Conservative limit to avoid overflow
const TRUNCATION_MESSAGE = "\n\n[Response truncated due to size limits. Use more specific filtering or pagination to get complete data.]";

function estimateTokenCount(text) {
  // Rough estimate: 1 token ≈ 4 characters
  return Math.ceil(text.length / 4);
}

function truncateResponse(obj) {
  const jsonString = JSON.stringify(obj, null, 2);
  const tokenCount = estimateTokenCount(jsonString);
  
  console.log(`Original response: ${tokenCount} tokens (${jsonString.length} chars)`);
  
  if (tokenCount <= MAX_RESPONSE_TOKENS) {
    console.log('✓ Response within limits, no truncation needed');
    return jsonString;
  }
  
  // Try to truncate execution data if present
  if (obj.data && Array.isArray(obj.data)) {
    const truncatedObj = {
      ...obj,
      data: obj.data.map((item) => truncateExecutionItem(item))
    };
    const truncatedString = JSON.stringify(truncatedObj, null, 2);
    const truncatedTokens = estimateTokenCount(truncatedString);
    
    console.log(`After execution truncation: ${truncatedTokens} tokens`);
    
    if (truncatedTokens <= MAX_RESPONSE_TOKENS) {
      console.log('✓ Execution truncation successful');
      return truncatedString + TRUNCATION_MESSAGE;
    }
  }
  
  // If still too large, truncate more aggressively
  const maxLength = MAX_RESPONSE_TOKENS * 4; // Convert back to characters
  const aggressiveTruncated = jsonString.substring(0, maxLength) + TRUNCATION_MESSAGE;
  console.log(`After aggressive truncation: ${estimateTokenCount(aggressiveTruncated)} tokens`);
  return aggressiveTruncated;
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
  
  // Include limited data if present
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

// Test with simulated large execution data
console.log('=== Testing Truncation Functions ===\n');

// Test 1: Small response (should pass through)
console.log('Test 1: Small response');
const smallResponse = { id: 1, status: 'success', data: [{ simple: 'data' }] };
const result1 = truncateResponse(smallResponse);
console.log(`Result: ${estimateTokenCount(result1)} tokens\n`);

// Test 2: Large execution with massive node stack
console.log('Test 2: Large execution data');
const largeExecution = {
  id: 375,
  mode: 'manual',
  status: 'success',
  data: {
    executionData: {
      nodeExecutionStack: new Array(1000).fill(0).map((_, i) => ({
        node: { name: `Node${i}`, type: 'webhook' },
        data: { main: [new Array(100).fill({ massiveData: 'x'.repeat(1000) })] }
      })),
      contextNodeName: 'webhook'
    }
  }
};

const result2 = truncateResponse(largeExecution);
console.log(`Final result: ${estimateTokenCount(result2)} tokens\n`);

// Test 3: Summary response
console.log('Test 3: Summary response for executions list');
const executionsList = {
  data: [
    { id: 1, status: 'success', startedAt: '2023-01-01', mode: 'manual', data: { large: 'data' } },
    { id: 2, status: 'error', startedAt: '2023-01-02', mode: 'trigger', data: null }
  ]
};

const summary = createSummaryResponse(executionsList);
console.log(`Summary: ${estimateTokenCount(summary)} tokens`);
console.log('Summary content:', summary);

console.log('\n✓ All truncation tests completed successfully!');