# Secret Protection Custom Pattern Automation

A Playwright-based CLI tool that automates GitHub secret scanning custom pattern management through browser automation.

Provides a command-line interface for uploading, testing, and managing secret scanning patterns with automated dry runs and interactive confirmations.

> [!NOTE]
> This is an _unofficial_ tool created by Field Security Specialists, and is not officially supported by GitHub.

> [!NOTE]
> This tool requires valid GitHub credentials and appropriate permissions to manage secret scanning settings in the target repository, organization, or enterprise.

## 🚀 Features

### Core Functionality

- **Pattern Upload**: Upload one or more YAML pattern files to repositories, organizations, or enterprises
- **Pattern Testing**: Automated testing against provided test data with match validation
- **Dry Run Execution**: Execute patterns against repositories to preview potential matches before publishing
- **Pattern Publishing**: Publish patterns with automated confirmation prompts
- **Pattern Validation**: Pattern structure validation
- **Existing Pattern Download**: Export current patterns to YAML format for backup/review
- **Pattern Updates**: Detect and update existing patterns when re-running with same pattern names
- **Push Protection Management**: Configure push protection at repository and organization levels

## 📦 Installation

```bash
# Clone the repository
gh repo clone advanced-security/secret-protection-custom-pattern-automation
cd secret-protection-custom-pattern-automation

# Install dependencies
npm install

# Build the project
npm run build
```

## 🛠️ Usage

### Basic Usage

```bash
# Upload patterns to a repository
npm start -- --pattern example-patterns.yml owner/repo

# Upload multiple pattern files
npm start -- --pattern generic.yml --pattern vendor.yml owner/repo

# Enable push protection for uploaded patterns
npm start -- --pattern patterns.yml --enable-push-protection owner/repo
```

### Advanced Usage

```bash
# Upload with custom dry-run threshold
npm start -- --pattern patterns.yml --dry-run-threshold 100 owner/repo

# Run with visible browser (non-headless)
npm start -- --pattern patterns.yml --no-headless owner/repo

# Download existing patterns to YAML format
npm start -- --download-existing owner/repo

# Validate patterns without uploading (no authentication required)
npm start -- --pattern patterns.yml --validate-only

# Work with organizations (auto-detected from target format)
npm start -- --pattern patterns.yml myorg

# Work with organizations explicitly
npm start -- --pattern patterns.yml --scope org myorg

# Work with GitHub Enterprise Server
npm start -- --server https://github.example.com --pattern patterns.yml owner/repo

# Debug mode with visible browser and screenshots
npm start -- --pattern patterns.yml --debug --no-headless owner/repo

# Dry-run on all repositories in an organization
npm start -- --pattern patterns.yml --dry-run-all-repos myorg

# Dry-run on specific repositories only  
npm start -- --pattern patterns.yml --dry-run-repo-list repo1 --dry-run-repo-list repo2 myorg

# Disable push protection for patterns
npm start -- --pattern patterns.yml --disable-push-protection owner/repo

# Upload without changing existing push protection settings
npm start -- --pattern patterns.yml --no-change-push-protection owner/repo
```

### Command Line Options

| Option | Description | Default |
|--------|-------------|---------|
| `--pattern <file>` | Pattern file(s) to upload (repeatable) | - |
| `--server <url>` | GitHub server URL | `https://github.com` |
| `--scope <scope>` | Target scope: repo, org, enterprise | Auto-detected |
| `--dry-run-threshold <n>` | Max allowed dry-run results before requiring confirmation | 50 |
| `--enable-push-protection` | Enable push protection for all uploaded/changed patterns | false |
| `--no-change-push-protection` | Do not change push protection settings for patterns | false |
| `--disable-push-protection` | Disable push protection for all uploaded/changed patterns | false |
| `--download-existing` | Download existing patterns to `existing-patterns.yml` | false |
| `--validate-only` | Validate patterns without uploading (no auth required) | false |
| `--validate` / `--no-validate` | Pattern validation before upload | true |
| `--headless` / `--no-headless` | Browser visibility | true |
| `--debug` | Enable debug mode with screenshots and verbose logging | false |
| `--dry-run-all-repos` | Run dry-run on all repositories in organization (org scope only) | false |
| `--dry-run-repo-list <repo>` | Specific repositories for dry-run (repeatable) | - |
| `--help` | Show help message | - |

## 📁 Pattern File Format

Patterns must be in YAML format following this structure:

```yaml
name: Example Patterns

patterns:
  - name: Generic API Key
    regex:
      version: 1
      pattern: |
        [a-zA-Z0-9+/_-]{32,64}={0,2}
      start: |
        (?i)(?:api[_-]?key|apikey|access[_-]?token|auth[_-]?token)[_\s]*[=:]\s*['"]*
      end: |
        ['"]*(?:\s|$|[,\]}])
      additional_match:
        - "[A-Z]"
        - "[0-9]"
      additional_not_match:
        - "^(?i)(test|example|demo|sample|dummy|fake|placeholder)$"
        - "^[0]{8,}$"
        - "^[1]{8,}$"
    test:
      data: 'api_key = "abc123DEF456ghi789jkl012MNO345pqr567stu890"'
      start_offset: 11
      end_offset: -2
    comments:
      - "Matches 32-64 character alphanumeric API keys"
      - "Includes common variable names for API keys"
      - "Excludes common test/placeholder values"
    push_protection: true

  - name: Simple Test Pattern
    regex:
      pattern: 'test[0-9]{1,2}'
      start: '\A|[^0-9A-Za-z]'
      end: '\z|[^0-9A-Za-z]'
    test:
      data: 'test123'
```

### Required Fields

- `name`: Unique pattern name  
- `patterns`: Array of pattern objects
- `patterns[].name`: Pattern name
- `patterns[].regex.pattern`: Main regex pattern

### Optional Fields

- `patterns[].regex.version`: Pattern version (defaults to 1)
- `patterns[].regex.start`: Before-secret regex pattern
- `patterns[].regex.end`: After-secret regex pattern  
- `patterns[].regex.additional_match`: Array of must-match rules
- `patterns[].regex.additional_not_match`: Array of must-not-match rules
- `patterns[].test.data`: Test string for validation
- `patterns[].test.start_offset`: Expected match start position
- `patterns[].test.end_offset`: Expected match end position
- `patterns[].push_protection`: Enable push protection for this pattern
- `patterns[].comments`: Array of descriptive comments

## 🔍 Pattern Validation

The tool includes comprehensive pattern validation:

### Basic Validation

- Required fields (name, regex pattern)
- Valid regex syntax
- Test data validation

### Validation Report Example

```text
🔍 Running validation-only mode (no upload)

📁 Loading pattern file: example-patterns.yml
✔ All patterns passed validation

📊 Validation Summary:
┌──────────────────────────────┬────────────┬────────┬──────────┬─────────────┐
│ Pattern Name                 │ Status     │ Errors │ Warnings │ Suggestions │
├──────────────────────────────┼────────────┼────────┼──────────┼─────────────┤
│ Generic API Key              │ ✓ Valid    │ 0      │ 0        │ 0           │
│ Test123                      │ ✓ Valid    │ 0      │ 1        │ 0           │
└──────────────────────────────┴────────────┴────────┴──────────┴─────────────┘
```

## 🧪 Dry Run Results

When a dry-run finds matches, the tool displays detailed results and prompts for confirmation:

```text
🧪 Starting dry run for pattern: Generic API Key
Pattern ID: 12345
Waiting for dry run to complete.....
✓ Dry run completed successfully

📊 Dry run completed: 23 potential matches found

⚠️  Found 23 potential matches:
┌───┬──────────────────────────────┬────────────────────────────────────────────────────────────┬────────────────────────────────────────────────────────────┐
│ # │ Repository location          │ Match                                                      │ URL                                                        │
├───┼──────────────────────────────┼────────────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────┤
│ 1 │ owner/repo1:config/db.yml     │ api_key: "sk_live_51H8q2jKl3mN4oP5qR6sT7uV8wX9yZ0A..."     │ /owner/repo1/blob/main/config/db.yml#L15                    │
│ 2 │ owner/repo2:src/constants.js │ const API_KEY = "ak_BmV3cDe4fGh5iJk6lMn7oPq8rSt9uVw..."    │ /owner/repo2/blob/main/src/constants.js#L8                 │
...
└───┴──────────────────────────────┴────────────────────────────────────────────────────────────┴────────────────────────────────────────────────────────────┘

💡 Review these results to ensure they represent actual secrets, not false positives.

? Pattern "Generic API Key" found 23 matches. What would you like to do? (Use arrow keys)
❯ Proceed with publishing
  Skip this pattern
```

### Dry Run Threshold

When results exceed the configured threshold (default: 50), the tool will prompt for confirmation:

```text
✖ Pattern "Overly Broad Pattern" exceeds dry run threshold (127 > 50)
? Do you want to proceed anyway? (y/N)
```

## 🔧 Configuration

### Authentication

The tool uses interactive browser-based authentication with session persistence:

1. On first run, the browser opens to the GitHub login page
2. Complete authentication manually in the browser
3. Session state is automatically saved to the `.state` file
4. Subsequent runs reuse the saved authentication

### Scope Detection

The tool automatically detects the target scope based on the target format:

- `owner/repo` → Repository scope
- `organization-name` → Organization scope (can be overridden with `--scope`)
- Use `--scope enterprise` for enterprise targets

### Environment Variables

```bash
# Optional: Set default server for GitHub Enterprise
export GITHUB_SERVER=https://github.example.com

# Optional: Set default dry-run threshold  
export DRY_RUN_THRESHOLD=25
```

### File Outputs

- **Authentication**: `.state` (session storage)
- **Downloaded patterns**: `existing-patterns.yml`
- **Debug screenshots**: `debug-*.png` (when `--debug` enabled)

## 📋 Examples

### Example Pattern Files

See `example-patterns.yml` for a complete example including:

- Simple test patterns for validation
- Generic API key patterns with comprehensive rules
- Various regex patterns with start/end anchors and additional match rules

### Integration with Existing Patterns

The tool can work with patterns from the [secret-scanning-custom-patterns](https://github.com/advanced-security/secret-scanning-custom-patterns) repository:

```bash
# Upload patterns from the community repository
npm start -- --pattern ../secret-scanning-custom-patterns/generic/patterns.yml owner/repo
```

### Working with Organizations

```bash
# Upload to all repositories in an organization
npm start -- --pattern patterns.yml myorg

# Upload with dry-run on all repositories in the organization
npm start -- --pattern patterns.yml --dry-run-all-repos myorg

# Upload with dry-run on specific repositories only
npm start -- --pattern patterns.yml --dry-run-repo-list repo1 --dry-run-repo-list repo2 myorg

# Upload with explicit organization scope
npm start -- --pattern patterns.yml --scope org myorg
```

### Pattern Updates

The tool automatically detects existing patterns by name and updates them:

```bash
# First run - creates new patterns
npm start -- --pattern patterns.yml owner/repo

# Second run - updates existing patterns if changes detected
npm start -- --pattern patterns.yml owner/repo
```

## 🛡️ Security and Quality Considerations

- **Pattern Review**: Always review dry-run results carefully before publishing patterns
- **Threshold Management**: Set appropriate thresholds to prevent noisy patterns from being published
- **Push Protection Options**:
  - Use `--enable-push-protection` for high-confidence patterns to prevent secret commits
  - Use `--disable-push-protection` to explicitly disable push protection
  - Use `--no-change-push-protection` to preserve existing push protection settings
- **Repository Selection**: Use `--dry-run-repo-list` to limit dry-run scope to specific repositories
- **Regular Audits**: Download and review existing patterns periodically with `--download-existing`
- **Test Data**: Provide realistic test data to validate pattern behavior before the dry-run
- **Incremental Deployment**: Start with repository-level testing before organization-wide rollout
- **Authentication State**: Ensure that the `.state` file is secure and not shared

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make changes with tests
4. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details

## 🆘 Support

- **Issues**: Report bugs and feature requests via GitHub Issues
- **Documentation**: Check the inline help with `npm start -- --help`
- **Examples**: See the `example-patterns.yml` file for pattern format reference
- **Validation**: Use `--validate-only` to test pattern files without authentication
- **Debug Mode**: Use `--debug --no-headless` for troubleshooting browser automation issues
