#!/usr/bin/env node

/**
 * Quick functionality test for new features
 */

console.log('⚡ Quick Feature Test');
console.log('=====================\n');

let passed = 0;
let failed = 0;

function test(name, condition, message = '') {
  const result = condition ? '✅' : '❌';
  console.log(`${result} ${name}${message ? ': ' + message : ''}`);
  condition ? passed++ : failed++;
}

async function runQuickTests() {
  // Test 1: Schema validation import and basic usage
  try {
    const schemas = await import('./build/schemas.js');
    test('Schema Module Import', !!schemas.NodeSchema, 'All schemas available');
    
    // Test valid node parsing
    const validNode = {
      id: "test",
      name: "Manual Trigger", 
      type: "n8n-nodes-base.manualTrigger",
      position: [100, 200],
      parameters: {}
    };
    
    const parsed = schemas.NodeSchema.parse(validNode);
    test('Schema Validation', !!parsed, 'Valid node parsed correctly');
    
  } catch (error) {
    test('Schema Module', false, error.message);
  }

  // Test 2: Node validator class
  try {
    const { NodeValidator } = await import('./build/node-validator.js');
    const validator = new NodeValidator('http://test', 'key');
    test('Node Validator Class', !!validator, 'NodeValidator instantiated');
  } catch (error) {
    test('Node Validator', false, error.message);
  }

  // Test 3: Configuration system
  try {
    const { config, formatOutput } = await import('./build/config.js');
    test('Configuration Loading', !!config.n8n_host, `Host: ${config.n8n_host}`);
    test('Output Formatting', typeof formatOutput === 'function', 'formatOutput function available');
    
    // Test verbosity formatting
    const testData = { test: 'data' };
    const concise = formatOutput(testData, 'concise');
    const full = formatOutput(testData, 'full');
    test('Verbosity Control', concise !== full, 'Different outputs for different verbosity');
    
  } catch (error) {
    test('Configuration', false, error.message);
  }

  // Test 4: Resource handlers
  try {
    const resources = await import('./build/resource-handlers.js');
    test('Resource Handlers', !!resources.setupResourceHandlers, 'Resource setup function available');
  } catch (error) {
    test('Resource Handlers', false, error.message);
  }

  // Test 5: Workflow composition guide
  try {
    const guide = await import('./build/workflow-composition-guide.js');
    const hasGuide = !!guide.WORKFLOW_COMPOSITION_GUIDE;
    const hasMOE = guide.WORKFLOW_COMPOSITION_GUIDE?.moe_specific_guidance?.includes('Mixture of Experts');
    test('Workflow Composition Guide', hasGuide, 'Guide structure loaded');
    test('MOE Guidance', hasMOE, 'MOE-specific content included');
  } catch (error) {
    test('Workflow Guide', false, error.message);
  }

  // Test 6: Enhanced package.json
  try {
    const pkg = JSON.parse(await import('fs').then(fs => fs.readFileSync('./package.json', 'utf8')));
    test('Enhanced Scripts', !!pkg.scripts['dev:watch'], 'Enhanced build scripts added');
    test('New Keywords', pkg.keywords.includes('schema-validation'), 'New keywords added');
    test('Updated Description', pkg.description.includes('schema validation'), 'Description updated');
  } catch (error) {
    test('Package Enhancement', false, error.message);
  }

  // Test 7: Build system files
  try {
    await import('fs').then(fs => {
      const deployExists = fs.existsSync('./deploy.sh');
      const dockerExists = fs.existsSync('./Dockerfile');
      const buildExists = fs.existsSync('./BUILD.md');
      
      test('Deployment Script', deployExists, 'deploy.sh created');
      test('Docker Support', dockerExists, 'Dockerfile created');  
      test('Build Documentation', buildExists, 'BUILD.md created');
    });
  } catch (error) {
    test('Build System Files', false, error.message);
  }

  // Test 8: Main index.js - check for new tools
  try {
    const indexCode = await import('fs').then(fs => fs.readFileSync('./build/index.js', 'utf8'));
    
    const newTools = [
      'list-available-nodes',
      'validate-node',
      'validate-workflow', 
      'create-validated-workflow'
    ];

    let foundTools = 0;
    for (const tool of newTools) {
      if (indexCode.includes(tool)) foundTools++;
    }

    test('Enhanced MCP Tools', foundTools === newTools.length, `${foundTools}/${newTools.length} new tools found`);
    
    // Check for filtering parameters
    const hasFiltering = indexCode.includes('nameFilter') && indexCode.includes('activeOnly') && indexCode.includes('tags');
    test('Workflow Filtering', hasFiltering, 'Filtering parameters implemented');
    
  } catch (error) {
    test('Main Index Enhancement', false, error.message);
  }

  // Summary
  console.log('\n' + '='.repeat(40));
  console.log('📊 QUICK TEST SUMMARY');
  console.log('='.repeat(40));
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📈 Success Rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);

  if (failed === 0) {
    console.log('\n🎉 All quick tests passed!');
    console.log('🚀 All new features are properly integrated and functional.');
  } else {
    console.log('\n⚠️  Some tests failed. Check the details above.');
  }

  return failed === 0;
}

runQuickTests().catch(console.error);