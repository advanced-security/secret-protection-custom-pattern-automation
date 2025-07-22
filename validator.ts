import chalk from 'chalk';
import Table from 'cli-table3';
import { Pattern, PatternFile } from './secret_protection.js';

export interface ValidationResult {
    isValid: boolean;
    errors: string[];
    warnings: string[];
    suggestions: string[];
}

export class PatternValidator {
    private static readonly COMMON_REGEX_ISSUES = [
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

    private static readonly SECURITY_PATTERNS = [
        {
            pattern: /password|secret|key|token/i,
            context: "variable names",
            suggestion: "Ensure the pattern captures actual secrets, not just variable names"
        }
    ];

    public static validatePattern(pattern: Pattern): ValidationResult {
        const result: ValidationResult = {
            isValid: true,
            errors: [],
            warnings: [],
            suggestions: []
        };

        // Basic validation
        this.validateBasicStructure(pattern, result);

        result.isValid = result.errors.length === 0;
        return result;
    }

    public static validatePatternFile(patternFile: PatternFile): ValidationResult {
        const aggregateResult: ValidationResult = {
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

        const patternNames = new Set<string>();
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

    private static validateBasicStructure(pattern: Pattern, result: ValidationResult): void {
        if (!pattern.name?.trim()) {
            result.errors.push("Pattern name is required");
        } else if (pattern.name.length > 100) {
            result.warnings.push("Pattern name is very long (>100 characters)");
        }

        if (!pattern.regex?.pattern?.trim()) {
            result.errors.push("Pattern regex is required");
        }

        if (pattern.regex?.version === undefined) {
            result.warnings.push("Pattern version is not specified");
        }

        if (pattern.regex?.start && !pattern.regex.start.trim()) {
            result.warnings.push("Pattern start regex is empty");
        }

        if (pattern.regex?.end && !pattern.regex.end.trim()) {
            result.warnings.push("Pattern end regex is empty");
        }

        // check that additional_match and additional_not_match are arrays
        if (pattern.regex?.additional_match && !Array.isArray(pattern.regex.additional_match)) {
            result.errors.push("Pattern additional_match must be an array");
        } else if (pattern.regex?.additional_match) {
            for (const rule of pattern.regex.additional_match) {
                if (typeof rule !== 'string' || !rule.trim()) {
                    result.errors.push("Each additional_match rule must be a non-empty string");
                }
            }
        }

        if (pattern.regex?.additional_not_match && !Array.isArray(pattern.regex.additional_not_match)) {
            result.errors.push("Pattern additional_not_match must be an array");
        } else if (pattern.regex?.additional_not_match) {
            for (const rule of pattern.regex.additional_not_match) {
                if (typeof rule !== 'string' || !rule.trim()) {
                    result.errors.push("Each additional_not_match rule must be a non-empty string");
                }
            }
        }
    }

    public static printValidationReport(result: ValidationResult, patternName?: string): void {
        const title = patternName ? `Validation Report for "${patternName}"` : 'Validation Report';
        
        console.log(chalk.bold.underline(`\n${title}`));

        if (result.isValid) {
            console.log(chalk.green('✓ Pattern is valid'));
        } else {
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

    public static createSummaryTable(results: Array<{ name: string; result: ValidationResult }>): string {
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
