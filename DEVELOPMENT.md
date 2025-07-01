# Development Guide

## Core Principles

1. **Keep It Simple**
   - Expand src/index.ts as needed - avoid complex directory structures
   - Focus on core functionality first
   - Use built-in Node.js features when possible
   - Check N8N_API.yml for correct endpoints/methods

2. **Document Only What Works**
   - No *public* "roadmap" or planned features
   - Only document implemented functionality
   - Keep documentation clear and focused

3. **JSON Requirements**
   - All tool arguments must be compact, single-line JSON
   - Example: `{"clientId":"abc123","id":"workflow123"}`

4. **Workflow Creation**
   - Include nodes and connections arrays (even if empty)
   - 'active' property is read-only
   ```json
   {
     "clientId": "abc123",
     "name": "My Workflow",
     "nodes": [],
     "connections": {}
   }
   ```

5. **Enterprise Features**
   - Project/variable management require Enterprise license
   - Base workflow features work without license
   - Clear error messages for license requirements

## What Not To Do

1. **No Overcomplication**
   - Don't create complex directory structures
   - Don't add unnecessary dependencies
   - Use built-in fetch instead of importing it
   - Check if functionality exists before adding imports

2. **No Speculative Documentation**
   - Don't document unimplemented features
   - Don't maintain *public* planning documents
   - Don't commit planning docs as implementation

3. **No Feature Creep**
   - Add features only when fully designed
   - Follow github repo's simple approach
   - Focus on core functionality first

4. **No Roadmaps**
   - Document only what exists
   - Keep focus on current functionality
   - Clear, concise documentation
