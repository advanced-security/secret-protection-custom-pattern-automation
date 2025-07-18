# Secret Protection Custom Pattern Automation

A CLI tool that automates GitHub secret protection custom pattern management.

Provides a command-line interface for uploading, testing, and managing secret protection patterns.

> [!NOTE]
> This is an _unofficial_ tool created by Field Security Specialists, and is not officially supported by GitHub.

> [!NOTE]
> This tool requires valid GitHub credentials and appropriate permissions to manage secret scanning settings in the target

## 🚀 Features

### Core Functionality

- **Pattern Upload**: Upload one or more YAML/JSON pattern files
- **Pattern Testing**: Automated testing against provided test data
- **Dry Run Execution**: Execute patterns against repositories to preview results
- **Pattern Publishing**: Publish patterns with optional push protection
- **Pattern Validation**: Advanced regex and structure validation
- **Existing Pattern Download**: Export current patterns for backup/review

### Enhanced Capabilities

- **Interactive CLI**: User-friendly command-line interface with colored output
- **Advanced Validation**: Regex analysis for common issues
- **Threshold Management**: Set limits for dry-run results for auto-approval
- **Detailed Reporting**: Comprehensive tables and summaries
- **Multi-target Support**: Works with repositories, organizations, and enterprises
- **Progress Tracking**: Real-time feedback during long-running operations

## 📦 Installation

```bash
# Clone the repository
git clone <repository-url>
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

# Download existing patterns
npm start -- --download-existing owner/repo

# Validate patterns without uploading
npm start -- --pattern patterns.yml --validate-only owner/repo

# Work with organizations
npm start -- --pattern patterns.yml --scope org myorg

# Work with GitHub Enterprise Server
npm start -- --server https://github.example.com --pattern patterns.yml owner/repo
```

### Command Line Options

| Option | Description | Default |
|--------|-------------|---------|
| `--pattern <file>` | Pattern file(s) to upload (repeatable) | - |
| `--server <url>` | GitHub server URL | `https://github.com` |
| `--scope <scope>` | Target scope: repo, org, enterprise | Auto-detected |
| `--dry-run-threshold <n>` | Max allowed dry-run results | 50 |
| `--enable-push-protection` | Enable push protection | false |
| `--download-existing` | Download existing patterns | false |
| `--validate` / `--no-validate` | Pattern validation | true |
| `--headless` / `--no-headless` | Browser visibility | true |
| `--help` | Show help message | - |

## 📁 Pattern File Format

Patterns should be in YAML format following this structure:

```yaml
name: Example Patterns

patterns:
  - name: Generic API Key
    type: generic_api_key
    regex:
      version: 0.1
      pattern: |
        [a-zA-Z0-9]{32,64}
      start: |
        (?i)(?:api[_-]?key|apikey)[_\s]*[=:]\s*['"]*
      end: |
        ['"]*(?:\s|$|[,\]}])
      additional_match:
        - "[A-Z]"
        - "[0-9]"
      additional_not_match:
        - "^(?i)(test|example|demo)$"
    test:
      data: 'api_key = "abc123DEF456ghi789jkl012MNO345pqr"'
      start_offset: 11
      end_offset: -2
    comments:
      - "Matches 32-64 character alphanumeric API keys"
```

## 🔍 Pattern Validation

The tool includes comprehensive pattern validation:

### Basic Validation

- Required fields (name, regex pattern)
- Valid regex syntax
- Test data validation

### Advanced Analysis

- Performance issue detection (catastrophic backtracking, etc.)
- Security implication analysis
- Common regex pattern suggestions
- Test data match verification

### Validation Report Example

```text
🔍 Validating patterns in: Example Patterns

✓ Pattern "Generic API Key" validation passed
⚠ Pattern "Overly Broad Pattern": Pattern uses '.*' without exclusion rules
💡 Pattern "Database String": Consider using additional_not_match instead for better performance

📊 Validation Summary:
┌──────────────────────────────┬────────────┬────────┬──────────┬─────────────┐
│ Pattern Name                 │ Status     │ Errors │ Warnings │ Suggestions │
├──────────────────────────────┼────────────┼────────┼──────────┼─────────────┤
│ Generic API Key              │ ✓ Valid    │ 0      │ 0        │ 1           │
│ Overly Broad Pattern         │ ✓ Valid    │ 0      │ 1        │ 0           │
└──────────────────────────────┴────────────┴────────┴──────────┴─────────────┘
```

## 🧪 Dry Run Results

When patterns find potential matches, the tool displays:

```text
🧪 Starting dry run for pattern: Generic API Key
Waiting for dry run to complete ✓

📊 Dry run completed: 23 potential matches found

⚠️  Found 23 potential matches:
┌──────────────────────────────┬──────────────────────────────────────────────────┬────────────────────────────────────────────────────────────┐
│ Repository                   │ File                                             │ Match Preview                                              │
├──────────────────────────────┼──────────────────────────────────────────────────┼────────────────────────────────────────────────────────────┤
│ owner/repo1                  │ config/database.yml                             │ api_key: "sk_live_51H8q2jKl3mN4oP5qR6sT7uV8wX9yZ0A..."   │
│ owner/repo2                  │ src/constants.js                                │ const API_KEY = "ak_BmV3cDe4fGh5iJk6lMn7oPq8rSt9uVw..."     │
└──────────────────────────────┴──────────────────────────────────────────────────┴────────────────────────────────────────────────────────────┘

? Pattern "Generic API Key" found 23 matches. What would you like to do? (Use arrow keys)
❯ Proceed with publishing
  Skip this pattern
  View detailed results
```

## 🔧 Configuration

### Authentication

The tool uses interactive browser-based authentication. On first run:

1. Browser opens to GitHub login page
2. Complete authentication manually
3. Session state is saved for subsequent runs

### Environment Variables

```bash
# Optional: Set default server
export GITHUB_SERVER=https://github.example.com

# Optional: Set default dry-run threshold
export DRY_RUN_THRESHOLD=25
```

## 📋 Examples

### Example Pattern Files

See `example-patterns.yml` for a complete example including:
- Generic API keys
- JWT tokens
- Database connection strings
- Various regex patterns with validation

### Integration with Existing Patterns

The tool can work with patterns from the [secret-scanning-custom-patterns](https://github.com/advanced-security/secret-scanning-custom-patterns) repository:

```bash
# Upload patterns from the community repository
npm start -- --pattern ../secret-scanning-custom-patterns/generic/patterns.yml owner/repo
```

## 🛡️ Security Considerations

- **Pattern Review**: Always review dry-run results before publishing
- **Threshold Management**: Set appropriate thresholds to prevent noise
- **Push Protection**: Enable selectively for high-confidence patterns
- **Regular Audits**: Download and review existing patterns periodically

## 🔄 Migration from Web Extension

This tool provides all functionality of the GHAS Field Extension plus:

| Web Extension Feature | CLI Tool Equivalent |
|-----------------------|-------------------|
| Pattern upload | `--pattern` option |
| Interactive testing | Automated testing |
| Dry run | Enhanced dry run with results table |
| Push protection toggle | `--enable-push-protection` |
| Manual review | Interactive confirmation prompts |

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make changes with tests
4. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details

## 🆘 Support

- **Issues**: Report bugs and feature requests via GitHub Issues
- **Documentation**: Check the inline help with `--help`
- **Examples**: See the `example-patterns.yml` file
