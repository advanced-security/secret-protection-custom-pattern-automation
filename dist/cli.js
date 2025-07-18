#!/usr/bin/env node
// Help text
const HELP_TEXT = `
Secret Scanning Custom Pattern Automation Tool

Usage: npm start -- [options] <target>

Arguments:
  target                Target repository (owner/repo), organization, or enterprise

Options:
  --server <url>        GitHub server URL (default: https://github.com)
  --scope <scope>       Target scope: repo, org, enterprise (auto-detected from target)
  --pattern <file>      Pattern file(s) to upload (can be specified multiple times)
  --dry-run-threshold <n>  Maximum allowed dry-run results before skipping (default: 50)
  --enable-push-protection  Enable push protection for uploaded patterns
  --download-existing   Download existing patterns to existing-patterns.json
  --validate-only      Validate patterns without uploading (no authentication required)
  --validate           Validate patterns before upload (default: true)
  --no-validate        Skip pattern validation
  --headless           Run in headless mode (default: true)
  --no-headless        Run with visible browser
  --help               Show this help message

Examples:
  # Upload patterns to a repository
  npm start -- --pattern patterns.yml owner/repo

  # Upload multiple pattern files with push protection
  npm start -- --pattern generic.yml --pattern vendor.yml --enable-push-protection owner/repo

  # Download existing patterns from an organization
  npm start -- --download-existing --scope org myorg

  # Upload patterns with custom threshold and visible browser
  npm start -- --pattern patterns.yml --dry-run-threshold 100 --no-headless owner/repo

  # Upload to GitHub Enterprise Server
  npm start -- --server https://github.example.com --pattern patterns.yml owner/repo
`;
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
