import chalk from 'chalk';
import Table from 'cli-table3';
export class PatternValidator {
    static validatePattern(pattern) {
        const result = {
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
        for (const pattern of (patternFile.patterns || [])) {
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
        if (pattern.regex?.pattern?.trim() === '' || !pattern.regex?.pattern) {
            result.errors.push("Pattern regex is required");
        }
        if (pattern.regex?.pattern.length === 1) {
            result.errors.push("Pattern regex is very short (1 character)");
        }
        if (pattern.regex?.pattern.length < 5) {
            result.errors.push("Pattern regex is very short (less than 5 characters)");
        }
        if (pattern.regex?.version === undefined) {
            result.suggestions.push("Pattern version is not specified. Consider adding a version to track changes more precisely.");
        }
        if (pattern.regex?.start && !pattern.regex.start.trim()) {
            result.suggestions.push("Pattern start regex is empty, so this will use the default start regex. Consider specifying a start regex for better accuracy.");
        }
        if (pattern.regex?.end && !pattern.regex.end.trim()) {
            result.suggestions.push("Pattern end regex is empty, so this will use the default end regex. Consider specifying an end regex for better accuracy.");
        }
        // check that additional_match and additional_not_match are arrays
        if (pattern.regex?.additional_match && !Array.isArray(pattern.regex.additional_match)) {
            result.errors.push("Pattern additional_match must be an array");
        }
        else if (pattern.regex?.additional_match) {
            for (const rule of pattern.regex.additional_match) {
                if (typeof rule !== 'string' || !rule.trim()) {
                    result.errors.push("Each additional_match rule must be a non-empty string");
                }
            }
        }
        if (pattern.regex?.additional_not_match && !Array.isArray(pattern.regex.additional_not_match)) {
            result.errors.push("Pattern additional_not_match must be an array");
        }
        else if (pattern.regex?.additional_not_match) {
            for (const rule of pattern.regex.additional_not_match) {
                if (typeof rule !== 'string' || !rule.trim()) {
                    result.errors.push("Each additional_not_match rule must be a non-empty string");
                }
            }
        }
        if (!pattern.test?.data) {
            result.suggestions.push("Pattern test data is missing. Having test data helps ensure the pattern works as expected.");
        }
    }
    static printValidationReport(result, patternName) {
        const title = patternName ? `Validation Report for "${patternName}"` : 'Validation Report';
        console.log(chalk.bold.underline(`\n${title}`));
        if (patternName) {
            if (result.isValid) {
                console.log(chalk.green('✓ Pattern is valid'));
            }
            else {
                console.log(chalk.red('✗ Pattern has errors'));
            }
        }
        else {
            if (result.isValid) {
                console.log(chalk.green('✓ All patterns are valid'));
            }
            else {
                console.log(chalk.red('✗ Some patterns have errors'));
            }
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
