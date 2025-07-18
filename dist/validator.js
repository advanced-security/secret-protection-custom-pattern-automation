import chalk from 'chalk';
import Table from 'cli-table3';
export class PatternValidator {
    static COMMON_REGEX_ISSUES = [
        {
            pattern: /\.\*/g,
            issue: "Overly broad '.*' quantifier",
            suggestion: "Consider using more specific patterns or bounded quantifiers like '.{1,50}'"
        },
        {
            pattern: /\[0-9\]\+/g,
            issue: "Inefficient character class",
            suggestion: "Use '\\d+' instead of '[0-9]+'"
        },
        {
            pattern: /\(\?\!/g,
            issue: "Negative lookahead",
            suggestion: "Consider using additional_not_match instead for better performance"
        },
        {
            pattern: /\{\d+,\}/g,
            issue: "Unbounded quantifier",
            suggestion: "Consider setting an upper bound for performance: {n,m}"
        }
    ];
    static SECURITY_PATTERNS = [
        {
            pattern: /password|secret|key|token/i,
            context: "variable names",
            suggestion: "Ensure the pattern captures actual secrets, not just variable names"
        }
    ];
    static validatePattern(pattern) {
        const result = {
            isValid: true,
            errors: [],
            warnings: [],
            suggestions: []
        };
        // Basic validation
        this.validateBasicStructure(pattern, result);
        // Regex validation
        this.validateRegex(pattern, result);
        // Performance analysis
        this.analyzePerformance(pattern, result);
        // Security analysis
        this.analyzeSecurityImplications(pattern, result);
        // Test data validation
        this.validateTestData(pattern, result);
        result.isValid = result.errors.length === 0;
        return result;
    }
    static validatePatternFile(patternFile) {
        const aggregateResult = {
            isValid: true,
            errors: [],
            warnings: [],
            suggestions: []
        };
        if (!patternFile.name?.trim()) {
            aggregateResult.errors.push("Pattern file must have a name");
        }
        if (!patternFile.patterns || patternFile.patterns.length === 0) {
            aggregateResult.errors.push("Pattern file must contain at least one pattern");
        }
        const patternNames = new Set();
        for (const [index, pattern] of (patternFile.patterns || []).entries()) {
            const patternResult = this.validatePattern(pattern);
            // Check for duplicate names
            if (patternNames.has(pattern.name)) {
                aggregateResult.errors.push(`Duplicate pattern name: "${pattern.name}"`);
            }
            patternNames.add(pattern.name);
            // Aggregate results
            aggregateResult.errors.push(...patternResult.errors.map(e => `Pattern "${pattern.name}": ${e}`));
            aggregateResult.warnings.push(...patternResult.warnings.map(w => `Pattern "${pattern.name}": ${w}`));
            aggregateResult.suggestions.push(...patternResult.suggestions.map(s => `Pattern "${pattern.name}": ${s}`));
        }
        aggregateResult.isValid = aggregateResult.errors.length === 0;
        return aggregateResult;
    }
    static validateBasicStructure(pattern, result) {
        if (!pattern.name?.trim()) {
            result.errors.push("Pattern name is required");
        }
        else if (pattern.name.length > 100) {
            result.warnings.push("Pattern name is very long (>100 characters)");
        }
        if (!pattern.regex?.pattern?.trim()) {
            result.errors.push("Pattern regex is required");
        }
        if (pattern.regex?.version === undefined) {
            result.warnings.push("Pattern version is not specified");
        }
    }
    static validateRegex(pattern, result) {
        if (!pattern.regex?.pattern)
            return;
        try {
            // Test if regex is valid
            new RegExp(pattern.regex.pattern);
        }
        catch (error) {
            result.errors.push(`Invalid regex pattern: ${error}`);
            return;
        }
        // Test start and end patterns if present
        if (pattern.regex.start) {
            try {
                new RegExp(pattern.regex.start);
            }
            catch (error) {
                result.errors.push(`Invalid start pattern: ${error}`);
            }
        }
        if (pattern.regex.end) {
            try {
                new RegExp(pattern.regex.end);
            }
            catch (error) {
                result.errors.push(`Invalid end pattern: ${error}`);
            }
        }
        // Test additional match patterns
        if (pattern.regex.additional_match) {
            for (const [index, rule] of pattern.regex.additional_match.entries()) {
                try {
                    new RegExp(rule);
                }
                catch (error) {
                    result.errors.push(`Invalid additional_match[${index}]: ${error}`);
                }
            }
        }
        if (pattern.regex.additional_not_match) {
            for (const [index, rule] of pattern.regex.additional_not_match.entries()) {
                try {
                    new RegExp(rule);
                }
                catch (error) {
                    result.errors.push(`Invalid additional_not_match[${index}]: ${error}`);
                }
            }
        }
    }
    static analyzePerformance(pattern, result) {
        if (!pattern.regex?.pattern)
            return;
        const regex = pattern.regex.pattern;
        // Check for common performance issues
        for (const issue of this.COMMON_REGEX_ISSUES) {
            if (issue.pattern.test(regex)) {
                result.warnings.push(`${issue.issue}: ${issue.suggestion}`);
            }
        }
        // Check pattern length
        if (regex.length > 500) {
            result.warnings.push("Pattern is very long (>500 characters). Consider breaking it down.");
        }
        // Check for catastrophic backtracking patterns
        const backtrackingPatterns = [
            /\([^)]*\+[^)]*\)\+/g,
            /\([^)]*\*[^)]*\)\*/g, // Nested star quantifiers
        ];
        for (const btPattern of backtrackingPatterns) {
            if (btPattern.test(regex)) {
                result.warnings.push("Potential catastrophic backtracking detected. Test performance carefully.");
            }
        }
    }
    static analyzeSecurityImplications(pattern, result) {
        if (!pattern.regex?.pattern)
            return;
        const regex = pattern.regex.pattern;
        // Check if pattern might match non-secrets
        for (const security of this.SECURITY_PATTERNS) {
            if (security.pattern.test(regex)) {
                result.suggestions.push(`Pattern contains ${security.context}: ${security.suggestion}`);
            }
        }
        // Check for overly permissive patterns
        if (regex.includes('.*') && !pattern.regex.additional_not_match?.length) {
            result.warnings.push("Pattern uses '.*' without exclusion rules. Consider adding additional_not_match rules to reduce false positives.");
        }
        // Check minimum length requirements
        const minLengthMatch = regex.match(/\{(\d+),/);
        if (minLengthMatch) {
            const minLength = parseInt(minLengthMatch[1], 10);
            if (minLength < 8) {
                result.warnings.push(`Minimum match length is ${minLength}. Consider requiring longer matches to reduce false positives.`);
            }
        }
    }
    static validateTestData(pattern, result) {
        if (!pattern.test?.data) {
            result.suggestions.push("Consider adding test data to verify pattern behavior");
            return;
        }
        if (!pattern.regex?.pattern)
            return;
        try {
            const regex = new RegExp(pattern.regex.pattern);
            const matches = pattern.test.data.match(regex);
            if (!matches) {
                result.errors.push("Test data does not match the pattern");
            }
            else if (pattern.test.start_offset !== undefined || pattern.test.end_offset !== undefined) {
                // Validate expected offsets if provided
                const match = matches[0];
                const actualStart = pattern.test.data.indexOf(match);
                const actualEnd = actualStart + match.length;
                if (pattern.test.start_offset !== undefined && actualStart !== pattern.test.start_offset) {
                    result.warnings.push(`Expected start offset ${pattern.test.start_offset}, but found ${actualStart}`);
                }
                if (pattern.test.end_offset !== undefined) {
                    const expectedEnd = pattern.test.end_offset === -1
                        ? pattern.test.data.length
                        : pattern.test.end_offset;
                    if (actualEnd !== expectedEnd) {
                        result.warnings.push(`Expected end offset ${expectedEnd}, but found ${actualEnd}`);
                    }
                }
            }
        }
        catch (error) {
            result.errors.push(`Failed to test pattern against test data: ${error}`);
        }
    }
    static printValidationReport(result, patternName) {
        const title = patternName ? `Validation Report for "${patternName}"` : 'Validation Report';
        console.log(chalk.bold.underline(`\n${title}`));
        if (result.isValid) {
            console.log(chalk.green('✓ Pattern is valid'));
        }
        else {
            console.log(chalk.red('✗ Pattern has errors'));
        }
        if (result.errors.length > 0) {
            console.log(chalk.red.bold('\nErrors:'));
            for (const error of result.errors) {
                console.log(chalk.red(`  ✗ ${error}`));
            }
        }
        if (result.warnings.length > 0) {
            console.log(chalk.yellow.bold('\nWarnings:'));
            for (const warning of result.warnings) {
                console.log(chalk.yellow(`  ⚠ ${warning}`));
            }
        }
        if (result.suggestions.length > 0) {
            console.log(chalk.blue.bold('\nSuggestions:'));
            for (const suggestion of result.suggestions) {
                console.log(chalk.blue(`  💡 ${suggestion}`));
            }
        }
        console.log(); // Empty line
    }
    static createSummaryTable(results) {
        const table = new Table({
            head: ['Pattern Name', 'Status', 'Errors', 'Warnings', 'Suggestions'],
            colWidths: [30, 10, 10, 12, 15]
        });
        for (const { name, result } of results) {
            const status = result.isValid ? chalk.green('✓ Valid') : chalk.red('✗ Invalid');
            const errors = result.errors.length > 0 ? chalk.red(result.errors.length.toString()) : '0';
            const warnings = result.warnings.length > 0 ? chalk.yellow(result.warnings.length.toString()) : '0';
            const suggestions = result.suggestions.length > 0 ? chalk.blue(result.suggestions.length.toString()) : '0';
            table.push([name, status, errors, warnings, suggestions]);
        }
        return table.toString();
    }
}
