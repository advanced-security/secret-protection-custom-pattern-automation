# Secret Protection Custom Pattern Automation

Automate GitHub secret protection custom pattern management through browser automation.

Provides a Playwright-based command-line interface for uploading, testing, and managing secret protection patterns with automated tests and dry runs.

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
- **Pattern Deletion**: Remove existing patterns from the target
- **Push Protection Management**: Configure push protection at repository, organization and enterprise levels
- **Pattern Filtering**: Include or exclude specific patterns by name during upload
- **Force Submission**: Override test failures and submit patterns anyway

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

### Basic Syntax

```bash
npm start -- [options] <target>
```

Where `<target>` is a repository (owner/repo), organization, or enterprise.

### Basic Usage

```bash
# Upload patterns to a repository
npm start -- owner/repo --pattern example-patterns.yml

# Download existing patterns to YAML format
npm start -- owner/repo --download-existing

# Delete existing patterns from a repository
npm start -- owner/repo --delete-existing

# Upload multiple pattern files
npm start -- owner/repo --pattern generic.yml --pattern vendor.yml

# Enable push protection for uploaded patterns
npm start -- owner/repo --pattern patterns.yml --enable-push-protection
```

### Advanced Usage

```bash
# Upload with custom dry-run threshold
npm start -- owner/repo --pattern patterns.yml --dry-run-threshold 100

# Run with visible browser (non-headless)
npm start -- owner/repo --pattern patterns.yml --no-headless

# Validate patterns without uploading (no authentication required)
npm start -- --pattern patterns.yml --validate-only

# Work with organizations (auto-detected from target format)
npm start -- myorg --pattern patterns.yml

# Work with organizations explicitly
npm start -- myorg --pattern patterns.yml --scope org

# Work with GitHub Enterprise Server
npm start -- owner/repo --server https://github.example.com --pattern patterns.yml

# Debug mode with visible browser and screenshots
npm start -- owner/repo --pattern patterns.yml --debug --no-headless

# Dry-run on all repositories in an organization
npm start --  myorg --pattern patterns.yml --dry-run-all-repos

# Dry-run on specific repositories only  
npm start --  myorg --pattern patterns.yml --dry-run-repo-list repo1 --dry-run-repo-list repo2

# Disable push protection for patterns
npm start -- owner/repo --pattern patterns.yml --disable-push-protection 

# Force submission even if tests fail
npm start -- --pattern patterns.yml --force-submission owner/repo
```

### Command Line Options

| Option | Description | Default |
|--------|-------------|---------|
| `--server <url>` | GitHub server URL | `https://github.com` |
| `--scope <scope>` | Target scope: repo, org, enterprise | Auto-detected |
| `--pattern <file>` | Pattern file(s) to upload (repeatable) | - |
| `--include-pattern-name <pattern>` | Patterns to include in upload (repeatable) | - |
| `--exclude-pattern-name <pattern>` | Patterns to exclude from upload (repeatable) | - |
| `--dry-run-threshold <n>` | Max allowed dry-run results before skipping | 0 |
| `--enable-push-protection` | Enable push protection for uploaded patterns | false |
| `--keep-push-protection` | Do not change push protection settings for patterns | false |
| `--disable-push-protection` | Disable push protection for uploaded patterns | false |
| `--download-existing` | Download existing patterns to `existing-patterns.yml` | false |
| `--delete-existing` | Delete existing patterns | false |
| `--validate-only` | Validate patterns without uploading (no auth required) | false |
| `--validate` / `--no-validate` | Pattern validation before upload | true |
| `--headless` / `--no-headless` | Browser visibility | true |
| `--force-submission` | Force submission even if tests fail | false |
| `--debug` | Enable debug mode with screenshots and verbose logging | false |
| `--dry-run-all-repos` | Run dry-run on all repositories in organization (org scope only) | false |
| `--dry-run-repo <repo>` | Specific repositories for dry-run (repeatable) | - |
| `--max-test-tries` | Maximum number of 0.1s to wait for the test to complete | 25 |
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
- `patterns[].regex.additional_match[]`: Array of must-match rules
- `patterns[].regex.additional_not_match[]`: Array of must-not-match rules
- `patterns[].test.data`: Test string for validation
- `patterns[].test.start_offset`: Expected match start position
- `patterns[].test.end_offset`: Expected match end position
- `patterns[].push_protection`: Enable push protection for this pattern
- `patterns[].comments[]`: Array of descriptive comments

## 🔍 Pattern Validation

The tool includes basic pattern validation.

### Basic Validation

- Required fields (name, regex pattern)

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
│ 1 │ owner/repo1:config/db.yml    │ api_key: "sk_live_51H8q2jKl3mN4oP5qR6sT7uV8wX9yZ0A..."     │ /owner/repo1/blob/main/config/db.yml#L15                   │
│ 2 │ owner/repo2:src/constants.js │ const API_KEY = "ak_BmV3cDe4fGh5iJk6lMn7oPq8rSt9uVw..."    │ /owner/repo2/blob/main/src/constants.js#L8                 │
...
└───┴──────────────────────────────┴────────────────────────────────────────────────────────────┴────────────────────────────────────────────────────────────┘

💡 Review these results to ensure they represent actual secrets, not false positives.

? Pattern "Generic API Key" found 23 matches. What would you like to do? (Use arrow keys)
❯ Proceed with publishing
  Skip this pattern
```

### Dry Run Threshold

The `--dry-run-threshold` option controls when patterns are automatically skipped due to too many matches. The default value is 0, meaning any dry-run results will require manual confirmation:

```text
✖ Pattern "Overly Broad Pattern" exceeds dry run threshold (127 > 0)
? Do you want to proceed anyway? (y/N)
```

You can set a higher threshold to automatically proceed with patterns that have fewer matches:

```bash
# Allow up to 25 matches before requiring confirmation
npm start -- --pattern patterns.yml --dry-run-threshold 25 owner/repo
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

### Pattern Updates

The tool automatically detects existing patterns by name and updates them.

### Pattern Filtering

You can selectively include or exclude patterns by name:

```bash
# Upload only specific patterns by name
npm start -- --pattern patterns.yml --include-pattern-name "API Key Pattern" --include-pattern-name "Database Token" owner/repo

# Upload all patterns except specific ones
npm start -- --pattern patterns.yml --exclude-pattern-name "Test Pattern" --exclude-pattern-name "Development Key" owner/repo

# Combine filtering with other options
npm start -- --pattern patterns.yml --include-pattern-name "Production" --enable-push-protection owner/repo
```

### Pattern Deletion

Remove existing patterns from the target:

```bash
# Delete all existing patterns from a repository
npm start -- owner/repo --delete-existing

# Delete existing patterns from an organization
npm start -- myorg --delete-existing --scope org

# Delete existing patterns from an organization, filtered by name
npm start -- myorg --delete-existing --scope org --include-pattern-name "API Key Pattern" --include-pattern-name "Database Token"
```

Deletions are confirmed with a prompt.

## 🛡️ Security and Quality Considerations

- **Check dry-run results**: Always review dry-run results carefully before publishing patterns
- **Threshold management**: Set appropriate thresholds to prevent noisy patterns from being published automatically
- **Regular audits**: Download and review existing patterns periodically with `--download-existing`
- **Test data**: Provide realistic test data to validate pattern behavior before the dry-run
- **Incremental deployment**: Start with repository-level testing before organization-wide rollout
- **Authentication state**: Ensure that your `.state` file is secure and not shared
- **Offline testing**: Consider also testing with the [offline custom pattern testing](https://github.com/advanced-security/secret-scanning-tools?tab=readme-ov-file#offline-testing-of-secret-scanning-custom-patterns)

See also [SECURITY.md](SECURITY.md) for security reporting guidelines.

## 🤝 Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for details on how to contribute to this project.

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details

## 🆘 Support

> [!NOTE]
> This is an _unofficial_ tool created by Field Security Specialists, and is not officially supported by GitHub.

See [SUPPORT.md](SUPPORT.md) for support options.

## 📜 Code of Conduct

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for our Code of Conduct.

## 🛡️ Privacy

See [PRIVACY.md](PRIVACY.md) for the privacy notice.
