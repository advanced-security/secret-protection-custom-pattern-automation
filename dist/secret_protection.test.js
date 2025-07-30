import { loadPatternFile, buildUrl, comparePatterns } from './secret_protection.js';
import chalk from 'chalk';
import * as yaml from 'js-yaml';
import { promises as fs } from 'fs';
import * as path from 'path';
// Simple test framework (reusing from validator.test.ts)
class SimpleTest {
    testCount = 0;
    passCount = 0;
    failCount = 0;
    test(name, testFn) {
        this.testCount++;
        try {
            testFn();
            this.passCount++;
            console.log(chalk.green(`✓ ${name}`));
        }
        catch (error) {
            this.failCount++;
            console.log(chalk.red(`✗ ${name}`));
            console.log(chalk.red(`  Error: ${error instanceof Error ? error.message : String(error)}`));
        }
    }
    async testAsync(name, testFn) {
        this.testCount++;
        try {
            await testFn();
            this.passCount++;
            console.log(chalk.green(`✓ ${name}`));
        }
        catch (error) {
            this.failCount++;
            console.log(chalk.red(`✗ ${name}`));
            console.log(chalk.red(`  Error: ${error instanceof Error ? error.message : String(error)}`));
        }
    }
    assertEquals(actual, expected, message) {
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
            throw new Error(message || `Expected ${JSON.stringify(expected)}, but got ${JSON.stringify(actual)}`);
        }
    }
    assertTrue(condition, message) {
        if (!condition) {
            throw new Error(message || 'Expected condition to be true');
        }
    }
    assertFalse(condition, message) {
        if (condition) {
            throw new Error(message || 'Expected condition to be false');
        }
    }
    assertContainsString(actual, expected, message) {
        if (!actual.includes(expected)) {
            throw new Error(message || `Expected string to contain "${expected}", but got "${actual}"`);
        }
    }
    assertThrows(fn, expectedError, message) {
        try {
            fn();
            throw new Error(message || 'Expected function to throw an error');
        }
        catch (error) {
            if (expectedError && !(error instanceof Error && error.message.includes(expectedError))) {
                throw new Error(message || `Expected error containing "${expectedError}", but got "${error}"`);
            }
        }
    }
    summary() {
        console.log(chalk.bold(`\n📊 Test Summary:`));
        console.log(chalk.green(`✓ Passed: ${this.passCount}`));
        console.log(chalk.red(`✗ Failed: ${this.failCount}`));
        console.log(chalk.blue(`📝 Total: ${this.testCount}`));
        if (this.failCount === 0) {
            console.log(chalk.green.bold('\n🎉 All tests passed!'));
        }
        else {
            console.log(chalk.red.bold('\n❌ Some tests failed!'));
            process.exit(1);
        }
    }
}
async function runMainFunctionalityTests() {
    console.log(chalk.bold.blue('\n🧪 Running Main Functionality Tests\n'));
    const test = new SimpleTest();
    // Test buildUrl function
    test.test('buildUrl should build correct repo URLs', () => {
        const config = {
            server: 'https://github.com',
            target: 'owner/repo',
            scope: 'repo',
            dryRunThreshold: 0,
            maxTestTries: 25
        };
        const url = buildUrl(config, 'settings', 'security_analysis');
        test.assertEquals(url, 'https://github.com/owner/repo/settings/security_analysis');
    });
    test.test('buildUrl should build correct org URLs', () => {
        const config = {
            server: 'https://github.com',
            target: 'myorg',
            scope: 'org',
            dryRunThreshold: 0,
            maxTestTries: 25
        };
        const url = buildUrl(config, 'settings', 'security_analysis');
        test.assertEquals(url, 'https://github.com/organizations/myorg/settings/security_analysis');
    });
    test.test('buildUrl should build correct enterprise URLs', () => {
        const config = {
            server: 'https://github.enterprise.com',
            target: 'myenterprise',
            scope: 'enterprise',
            dryRunThreshold: 0,
            maxTestTries: 25
        };
        const url = buildUrl(config, 'settings', 'security_analysis_policies', 'security_features');
        test.assertEquals(url, 'https://github.enterprise.com/enterprises/myenterprise/settings/security_analysis_policies/security_features');
    });
    test.test('buildUrl should throw error for invalid repo format', () => {
        const config = {
            server: 'https://github.com',
            target: 'invalid-repo-format',
            scope: 'repo',
            dryRunThreshold: 0,
            maxTestTries: 25
        };
        test.assertThrows(() => buildUrl(config, 'settings'), 'Invalid repository format');
    });
    // Test comparePatterns function
    test.test('comparePatterns should return true for identical patterns', () => {
        test.assertTrue(comparePatterns('test-pattern', 'test-pattern'));
    });
    test.test('comparePatterns should return true for patterns with different whitespace', () => {
        test.assertTrue(comparePatterns('  test-pattern  ', 'test-pattern'));
        test.assertTrue(comparePatterns('test-pattern\n', '  test-pattern  '));
    });
    test.test('comparePatterns should return false for different patterns', () => {
        test.assertFalse(comparePatterns('pattern1', 'pattern2'));
    });
    test.test('comparePatterns should handle null/undefined values', () => {
        test.assertFalse(comparePatterns(null, 'pattern'));
        test.assertFalse(comparePatterns('pattern', undefined));
        test.assertFalse(comparePatterns(null, undefined));
        test.assertFalse(comparePatterns(undefined, null));
    });
    // Test loadPatternFile function
    await test.testAsync('loadPatternFile should load valid YAML files', async () => {
        const tempFile = path.join(process.cwd(), 'temp-test-pattern.yml');
        const testPattern = {
            name: 'Test Patterns',
            patterns: [{
                    name: 'Test Pattern',
                    regex: {
                        version: 1,
                        pattern: 'test.*pattern'
                    }
                }]
        };
        try {
            await fs.writeFile(tempFile, yaml.dump(testPattern));
            const loaded = await loadPatternFile(tempFile);
            test.assertEquals(loaded.name, 'Test Patterns');
            test.assertEquals(loaded.patterns.length, 1);
            test.assertEquals(loaded.patterns[0].name, 'Test Pattern');
            test.assertEquals(loaded.patterns[0].regex.pattern, 'test.*pattern');
        }
        finally {
            try {
                await fs.unlink(tempFile);
            }
            catch {
                // Ignore cleanup errors
            }
        }
    });
    await test.testAsync('loadPatternFile should load valid JSON files', async () => {
        const tempFile = path.join(process.cwd(), 'temp-test-pattern.json');
        const testPattern = {
            name: 'Test JSON Patterns',
            patterns: [{
                    name: 'JSON Test Pattern',
                    regex: {
                        version: 1,
                        pattern: 'json.*pattern'
                    }
                }]
        };
        try {
            await fs.writeFile(tempFile, JSON.stringify(testPattern, null, 2));
            const loaded = await loadPatternFile(tempFile);
            test.assertEquals(loaded.name, 'Test JSON Patterns');
            test.assertEquals(loaded.patterns.length, 1);
            test.assertEquals(loaded.patterns[0].name, 'JSON Test Pattern');
        }
        finally {
            try {
                await fs.unlink(tempFile);
            }
            catch {
                // Ignore cleanup errors
            }
        }
    });
    await test.testAsync('loadPatternFile should throw error for invalid files', async () => {
        const tempFile = path.join(process.cwd(), 'temp-invalid-pattern.txt');
        try {
            await fs.writeFile(tempFile, '{{{{');
            let threwError = false;
            try {
                await loadPatternFile(tempFile);
            }
            catch {
                threwError = true;
            }
            test.assertTrue(threwError, 'Should have thrown an error for invalid file');
        }
        finally {
            try {
                await fs.unlink(tempFile);
            }
            catch {
                // Ignore cleanup errors
            }
        }
    });
    // Test pattern filtering logic (simulating the logic from uploadPatterns)
    test.test('pattern filtering should work with include patterns', () => {
        const patterns = [
            { name: 'Pattern A', regex: { version: 1, pattern: 'a' } },
            { name: 'Pattern B', regex: { version: 1, pattern: 'b' } },
            { name: 'Pattern C', regex: { version: 1, pattern: 'c' } }
        ];
        const config = {
            server: 'https://github.com',
            target: 'test/repo',
            scope: 'repo',
            patternsToInclude: ['Pattern A', 'Pattern C'],
            dryRunThreshold: 0,
            maxTestTries: 25
        };
        const filtered = patterns.filter(pattern => {
            if (config.patternsToInclude && !config.patternsToInclude.includes(pattern.name)) {
                return false;
            }
            if (config.patternsToExclude && config.patternsToExclude.includes(pattern.name)) {
                return false;
            }
            return true;
        });
        test.assertEquals(filtered.length, 2);
        test.assertEquals(filtered[0].name, 'Pattern A');
        test.assertEquals(filtered[1].name, 'Pattern C');
    });
    test.test('pattern filtering should work with exclude patterns', () => {
        const patterns = [
            { name: 'Pattern A', regex: { version: 1, pattern: 'a' } },
            { name: 'Pattern B', regex: { version: 1, pattern: 'b' } },
            { name: 'Pattern C', regex: { version: 1, pattern: 'c' } }
        ];
        const config = {
            server: 'https://github.com',
            target: 'test/repo',
            scope: 'repo',
            patternsToExclude: ['Pattern B'],
            dryRunThreshold: 0,
            maxTestTries: 25
        };
        const filtered = patterns.filter(pattern => {
            if (config.patternsToInclude && !config.patternsToInclude.includes(pattern.name)) {
                return false;
            }
            if (config.patternsToExclude && config.patternsToExclude.includes(pattern.name)) {
                return false;
            }
            return true;
        });
        test.assertEquals(filtered.length, 2);
        test.assertEquals(filtered[0].name, 'Pattern A');
        test.assertEquals(filtered[1].name, 'Pattern C');
    });
    // Test configuration validation logic
    test.test('config validation should detect conflicting push protection flags', () => {
        // Simulate the validation logic from parseArgs
        const testValidation = (enablePushProtection, noChangePushProtection, disablePushProtection) => {
            if (enablePushProtection && noChangePushProtection) {
                return 'Both --enable-push-protection and --no-change-push-protection are set';
            }
            if (enablePushProtection && disablePushProtection) {
                return 'Both --enable-push-protection and --disable-push-protection are set';
            }
            if (disablePushProtection && noChangePushProtection) {
                return 'Both --disable-push-protection and --no-change-push-protection are set';
            }
            return null;
        };
        test.assertContainsString(testValidation(true, true, false) || '', 'enable-push-protection and --no-change-push-protection');
        test.assertContainsString(testValidation(true, false, true) || '', 'enable-push-protection and --disable-push-protection');
        test.assertContainsString(testValidation(false, true, true) || '', 'disable-push-protection and --no-change-push-protection');
        test.assertEquals(testValidation(true, false, false), null);
        test.assertEquals(testValidation(false, false, false), null);
    });
    // Test scope detection logic
    test.test('scope detection should work correctly', () => {
        const detectScope = (target, argScope) => {
            if (target.includes('/')) {
                return 'repo';
            }
            else if (argScope === undefined) {
                return 'org';
            }
            else {
                return argScope;
            }
        };
        test.assertEquals(detectScope('owner/repo'), 'repo');
        test.assertEquals(detectScope('myorg'), 'org');
        test.assertEquals(detectScope('myenterprise', 'enterprise'), 'enterprise');
        test.assertEquals(detectScope('myorg', 'org'), 'org');
    });
    test.summary();
}
// Export for use in other test files or standalone execution
export { runMainFunctionalityTests };
// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    runMainFunctionalityTests();
}
