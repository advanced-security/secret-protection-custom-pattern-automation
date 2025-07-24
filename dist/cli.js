#!/usr/bin/env node
// Help text
export const HELP_TEXT = `
Secret Scanning Custom Pattern Automation Tool

Usage: npm start -- [options] <target>

Arguments:
  target                Target repository (owner/repo), organization, or enterprise

Options:
  --server <url>        GitHub server URL (default: https://github.com)
  --scope <scope>       Target scope: repo, org, enterprise (auto-detected for repos, and assumed to be org if not a repository)
  --pattern <file>      Pattern file(s) to upload (can be specified multiple times)
  --patterns-to-include <pattern>  Patterns to include in upload (can be specified multiple times)
  --patterns-to-exclude <pattern>  Patterns to exclude from upload (can be specified multiple times)
  --dry-run-threshold <n>  Maximum allowed dry-run results before skipping (default: 50)
  --enable-push-protection  Enable push protection for uploaded patterns
  --no-change-push-protection  Do not change push protection settings for patterns
  --disable-push-protection  Disable push protection for uploaded patterns
  --download-existing   Download existing patterns to existing-patterns.yml
  --validate-only      Validate patterns without uploading (no authentication required)
  --validate           Validate patterns before upload (default: true)
  --no-validate        Skip pattern validation
  --headless           Run in headless mode (default: true)
  --no-headless        Run with visible browser
  --debug              Enable debug mode with screenshots and verbose logging
  --dry-run-all-repos  Run dry-run on all repositories in organization (org scope only)
  --dry-run-repo-list <repo>  Specific repositories for dry-run (can be specified multiple times)
  --help               Show this help message

# Optional: Set default server for GitHub Enterprise
export GITHUB_SERVER=https://github.example.com

# Optional: Set default dry-run threshold  
export DRY_RUN_THRESHOLD=25

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

  # Dry-run on all repositories in an organization
  npm start -- --pattern patterns.yml --dry-run-all-repos myorg

  # Dry-run on specific repositories only
  npm start -- --pattern patterns.yml --dry-run-repo-list repo1 --dry-run-repo-list repo2 myorg
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
