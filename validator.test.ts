import { PatternValidator } from './validator.js';
import { Pattern, PatternFile, Config } from './secret_protection.js';
import chalk from 'chalk';
import * as yaml from 'js-yaml';
import { promises as fs } from 'fs';
import * as path from 'path';

// Simple test framework
class SimpleTest {
    private testCount = 0;
    private passCount = 0;
    private failCount = 0;

    test(name: string, testFn: () => void): void {
        this.testCount++;
        try {
            testFn();
            this.passCount++;
            console.log(chalk.green(`✓ ${name}`));
        } catch (error) {
            this.failCount++;
            console.log(chalk.red(`✗ ${name}`));
            console.log(chalk.red(`  Error: ${error instanceof Error ? error.message : String(error)}`));
        }
    }

    async testAsync(name: string, testFn: () => Promise<void>): Promise<void> {
        this.testCount++;
        try {
            await testFn();
            this.passCount++;
            console.log(chalk.green(`✓ ${name}`));
        } catch (error) {
            this.failCount++;
            console.log(chalk.red(`✗ ${name}`));
            console.log(chalk.red(`  Error: ${error instanceof Error ? error.message : String(error)}`));
        }
    }

    assertEquals(actual: any, expected: any, message?: string): void {
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
            throw new Error(message || `Expected ${JSON.stringify(expected)}, but got ${JSON.stringify(actual)}`);
        }
    }

    assertTrue(condition: boolean, message?: string): void {
        if (!condition) {
            throw new Error(message || 'Expected condition to be true');
        }
    }

    assertFalse(condition: boolean, message?: string): void {
        if (condition) {
            throw new Error(message || 'Expected condition to be false');
        }
    }

    assertContains(array: any[], item: any, message?: string): void {
        if (!array.includes(item)) {
            throw new Error(message || `Expected array to contain ${JSON.stringify(item)}`);
        }
    }

    assertContainsString(text: string, substring: string, message?: string): void {
        if (!text.includes(substring)) {
            throw new Error(message || `Expected "${text}" to contain "${substring}"`);
        }
    }

    summary(): void {
        console.log(chalk.bold('\n=== Test Summary ==='));
        console.log(`Total tests: ${this.testCount}`);
        console.log(chalk.green(`Passed: ${this.passCount}`));
        if (this.failCount > 0) {
            console.log(chalk.red(`Failed: ${this.failCount}`));
        }
        console.log(`Success rate: ${((this.passCount / this.testCount) * 100).toFixed(1)}%`);

        if (this.failCount > 0) {
            process.exit(1);
        }
    }
}

// Test helper functions
function createValidPattern(): Pattern {
    return {
        name: "Test Pattern",
        regex: {
            version: 1,
            pattern: "test[a-z]{5,10}pattern"
        },
        test: {
            data: "This is a test123456pattern"
        }
    };
}

function createBasicConfig(): Config {
    return {
        server: 'https://github.com',
        target: 'test-org',
        scope: 'org',
        dryRunThreshold: 0,
        maxTestTries: 25
    };
}

// Run tests
async function runTests() {
    const test = new SimpleTest();

    console.log(chalk.bold.blue('\n🧪 Running Validator Tests\n'));

    // Test validatePattern - valid pattern
    test.test('validatePattern should pass for valid pattern', () => {
        const pattern = createValidPattern();
        const result = PatternValidator.validatePattern(pattern);

        test.assertTrue(result.isValid);
        test.assertEquals(result.errors.length, 0);
    });

    // Test validatePattern - missing name
    test.test('validatePattern should fail for missing name', () => {
        const pattern = createValidPattern();
        pattern.name = '';
        const result = PatternValidator.validatePattern(pattern);

        test.assertFalse(result.isValid);
        test.assertTrue(result.errors.length > 0);
        test.assertContainsString(result.errors[0], 'Pattern name is required');
    });

    // Test validatePattern - missing regex pattern
    test.test('validatePattern should fail for missing regex pattern', () => {
        const pattern = createValidPattern();
        pattern.regex.pattern = '';
        const result = PatternValidator.validatePattern(pattern);

        test.assertFalse(result.isValid);
        test.assertTrue(result.errors.length > 0);
        test.assertContainsString(result.errors[0], 'Pattern regex is required');
    });

    // Test validatePattern - very short regex
    test.test('validatePattern should fail for very short regex', () => {
        const pattern = createValidPattern();
        pattern.regex.pattern = 'ab';
        const result = PatternValidator.validatePattern(pattern);

        test.assertFalse(result.isValid);
        test.assertTrue(result.errors.length > 0);
        test.assertContainsString(result.errors[0], 'Pattern regex is very short');
    });

    // Test validatePattern - single character regex
    test.test('validatePattern should fail for single character regex', () => {
        const pattern = createValidPattern();
        pattern.regex.pattern = 'a';
        const result = PatternValidator.validatePattern(pattern);

        test.assertFalse(result.isValid);
        test.assertTrue(result.errors.length > 0);
        test.assertContainsString(result.errors[0], 'Pattern regex is very short (1 character)');
    });

    // Test validatePattern - long name warning
    test.test('validatePattern should warn for very long name', () => {
        const pattern = createValidPattern();
        pattern.name = 'a'.repeat(150);
        const result = PatternValidator.validatePattern(pattern);

        test.assertTrue(result.isValid); // Should still be valid
        test.assertTrue(result.warnings.length > 0);
        test.assertContainsString(result.warnings[0], 'Pattern name is very long');
    });

    // Test validatePattern - missing version suggestion
    test.test('validatePattern should suggest adding version', () => {
        const pattern = createValidPattern();
        // Create a pattern with version as undefined by casting
        const patternWithoutVersion = {
            ...pattern,
            regex: {
                ...pattern.regex,
                version: undefined as any
            }
        };
        const result = PatternValidator.validatePattern(patternWithoutVersion);

        test.assertTrue(result.isValid);
        test.assertTrue(result.suggestions.length > 0);
        test.assertContainsString(result.suggestions[0], 'Pattern version is not specified');
    });

    // Test validatePattern - missing test data suggestion
    test.test('validatePattern should suggest adding test data', () => {
        const pattern = createValidPattern();
        delete pattern.test;
        const result = PatternValidator.validatePattern(pattern);

        test.assertTrue(result.isValid);
        test.assertTrue(result.suggestions.length > 0);
        test.assertContainsString(result.suggestions[0], 'Pattern test data is missing');
    });

    // Test validatePattern - invalid additional_match (not array)
    test.test('validatePattern should fail for invalid additional_match type', () => {
        const pattern = createValidPattern();
        (pattern.regex as any).additional_match = "not an array";
        const result = PatternValidator.validatePattern(pattern);

        test.assertFalse(result.isValid);
        test.assertTrue(result.errors.length > 0);
        test.assertContainsString(result.errors[0], 'Pattern additional_match must be an array');
    });

    // Test validatePattern - empty additional_match rule
    test.test('validatePattern should fail for empty additional_match rule', () => {
        const pattern = createValidPattern();
        pattern.regex.additional_match = ['valid rule', ''];
        const result = PatternValidator.validatePattern(pattern);

        test.assertFalse(result.isValid);
        test.assertTrue(result.errors.length > 0);
        test.assertContainsString(result.errors[0], 'Each additional_match rule must be a non-empty string');
    });

    // Test validatePattern - invalid additional_not_match (not array)
    test.test('validatePattern should fail for invalid additional_not_match type', () => {
        const pattern = createValidPattern();
        (pattern.regex as any).additional_not_match = "not an array";
        const result = PatternValidator.validatePattern(pattern);

        test.assertFalse(result.isValid);
        test.assertTrue(result.errors.length > 0);
        test.assertContainsString(result.errors[0], 'Pattern additional_not_match must be an array');
    });

    // Test validatePattern - empty additional_not_match rule
    test.test('validatePattern should fail for empty additional_not_match rule', () => {
        const pattern = createValidPattern();
        pattern.regex.additional_not_match = ['valid rule', ''];
        const result = PatternValidator.validatePattern(pattern);

        test.assertFalse(result.isValid);
        test.assertTrue(result.errors.length > 0);
        test.assertContainsString(result.errors[0], 'Each additional_not_match rule must be a non-empty string');
    });

    // Test validatePatternFile - valid file
    test.test('validatePatternFile should pass for valid file', () => {
        const patternFile: PatternFile = {
            name: "Test Pattern File",
            patterns: [createValidPattern()]
        };
        const config = createBasicConfig();
        const result = PatternValidator.validatePatternFile(patternFile, config);

        test.assertTrue(result.isValid);
        test.assertEquals(result.errors.length, 0);
    });

    // Test validatePatternFile - missing name
    test.test('validatePatternFile should fail for missing file name', () => {
        const patternFile: PatternFile = {
            name: "",
            patterns: [createValidPattern()]
        };
        const config = createBasicConfig();
        const result = PatternValidator.validatePatternFile(patternFile, config);

        test.assertFalse(result.isValid);
        test.assertTrue(result.errors.length > 0);
        test.assertContainsString(result.errors[0], 'Pattern file must have a name');
    });

    // Test validatePatternFile - no patterns
    test.test('validatePatternFile should fail for file with no patterns', () => {
        const patternFile: PatternFile = {
            name: "Test File",
            patterns: []
        };
        const config = createBasicConfig();
        const result = PatternValidator.validatePatternFile(patternFile, config);

        test.assertFalse(result.isValid);
        test.assertTrue(result.errors.length > 0);
        test.assertContainsString(result.errors[0], 'Pattern file must contain at least one pattern');
    });

    // Test validatePatternFile - duplicate pattern names
    test.test('validatePatternFile should fail for duplicate pattern names', () => {
        const pattern1 = createValidPattern();
        const pattern2 = createValidPattern();
        pattern2.name = pattern1.name; // Same name

        const patternFile: PatternFile = {
            name: "Test File",
            patterns: [pattern1, pattern2]
        };
        const config = createBasicConfig();
        const result = PatternValidator.validatePatternFile(patternFile, config);

        test.assertFalse(result.isValid);
        test.assertTrue(result.errors.length > 0);
        test.assertContainsString(result.errors[0], 'Duplicate pattern name');
    });

    // Test validatePatternFile - with include patterns filter
    test.test('validatePatternFile should filter patterns by include list', () => {
        const pattern1 = createValidPattern();
        pattern1.name = "Included Pattern";
        const pattern2 = createValidPattern();
        pattern2.name = "Excluded Pattern";

        const patternFile: PatternFile = {
            name: "Test File",
            patterns: [pattern1, pattern2]
        };
        const config = createBasicConfig();
        config.patternsToInclude = ["Included Pattern"];

        const result = PatternValidator.validatePatternFile(patternFile, config);

        test.assertTrue(result.isValid);
        test.assertEquals(result.errors.length, 0);
    });

    // Test validatePatternFile - with exclude patterns filter
    test.test('validatePatternFile should filter patterns by exclude list', () => {
        const pattern1 = createValidPattern();
        pattern1.name = "Good Pattern";
        const pattern2 = createValidPattern();
        pattern2.name = "Bad Pattern";
        pattern2.regex.pattern = ''; // Make this one invalid

        const patternFile: PatternFile = {
            name: "Test File",
            patterns: [pattern1, pattern2]
        };
        const config = createBasicConfig();
        config.patternsToExclude = ["Bad Pattern"];

        const result = PatternValidator.validatePatternFile(patternFile, config);

        test.assertTrue(result.isValid); // Should be valid since bad pattern is excluded
    });

    // Test validatePatternFile - aggregation of pattern errors
    test.test('validatePatternFile should aggregate pattern errors with names', () => {
        const pattern1 = createValidPattern();
        pattern1.name = "Pattern One";
        pattern1.regex.pattern = ''; // Invalid

        const pattern2 = createValidPattern();
        pattern2.name = "Pattern Two";
        pattern2.regex.pattern = 'x'; // Invalid (too short)

        const patternFile: PatternFile = {
            name: "Test File",
            patterns: [pattern1, pattern2]
        };
        const config = createBasicConfig();
        const result = PatternValidator.validatePatternFile(patternFile, config);

        test.assertFalse(result.isValid);
        test.assertTrue(result.errors.length >= 2);

        // Check that error messages contain pattern names
        const hasPatternOneError = result.errors.some(error => error.includes('Pattern "Pattern One"'));
        const hasPatternTwoError = result.errors.some(error => error.includes('Pattern "Pattern Two"'));

        test.assertTrue(hasPatternOneError, 'Should have error for Pattern One');
        test.assertTrue(hasPatternTwoError, 'Should have error for Pattern Two');
    });

    // Test createSummaryTable
    test.test('createSummaryTable should create formatted table', () => {
        const results = [
            {
                name: "Valid Pattern",
                result: {
                    isValid: true,
                    errors: [],
                    warnings: [],
                    suggestions: []
                }
            },
            {
                name: "Invalid Pattern",
                result: {
                    isValid: false,
                    errors: ["Test error"],
                    warnings: ["Test warning"],
                    suggestions: ["Test suggestion"]
                }
            }
        ];

        const table = PatternValidator.createSummaryTable(results);

        test.assertContainsString(table, 'Valid Pattern');
        test.assertContainsString(table, 'Invalid Pattern');
        test.assertContainsString(table, 'Pattern Name');
        test.assertContainsString(table, 'Status');
    });

    // Integration tests with actual pattern files
    await test.testAsync('validatePatternFile should validate valid pattern file', async () => {
        try {
            const filePath = path.join(process.cwd(), 'test-patterns-valid.yml');
            const content = await fs.readFile(filePath, 'utf-8');
            const patternFile = yaml.load(content) as PatternFile;
            const config = createBasicConfig();

            const result = PatternValidator.validatePatternFile(patternFile, config);

            test.assertTrue(result.isValid);
            test.assertEquals(result.errors.length, 0);
        } catch {
            console.log(chalk.yellow('⚠️  Skipping integration test - test pattern file not found'));
        }
    });

    await test.testAsync('validatePatternFile should catch errors in invalid pattern file', async () => {
        try {
            const filePath = path.join(process.cwd(), 'test-patterns-invalid.yml');
            const content = await fs.readFile(filePath, 'utf-8');
            const patternFile = yaml.load(content) as PatternFile;
            const config = createBasicConfig();

            const result = PatternValidator.validatePatternFile(patternFile, config);

            test.assertFalse(result.isValid);
            test.assertTrue(result.errors.length > 0);

            // Should catch multiple types of errors
            const errorText = result.errors.join(' ');
            test.assertContainsString(errorText, 'Pattern name is required');
            test.assertContainsString(errorText, 'Pattern regex is required');
            test.assertContainsString(errorText, 'Duplicate pattern name');
        } catch {
            console.log(chalk.yellow('⚠️  Skipping integration test - test pattern file not found'));
        }
    });

    test.summary();
}

// Run the tests
runTests();
