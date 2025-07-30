#!/usr/bin/env node

import { HELP_TEXT } from './help.js';

// Check for help flag first, before importing main
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(HELP_TEXT);
  process.exit(0);
}

// Import and run the main function
import { main } from './secret_protection.js';

// Run the main function
main().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
