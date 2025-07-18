import { chromium, BrowserContext, Page, Locator } from 'playwright';
import minimist from 'minimist';
import { promises as fs } from 'fs';
import * as yaml from 'js-yaml';
import * as path from 'path';
import chalk from 'chalk';
import Table from 'cli-table3';
import inquirer from 'inquirer';
import { PatternValidator } from './validator.js';

export interface Pattern {
    name: string;
    type?: string;
    experimental?: boolean;
    regex: {
        version: number;
        pattern: string;
        start?: string;
        end?: string;
        additional_match?: string[];
        additional_not_match?: string[];
    };
    test?: {
        data: string;
        start_offset?: number;
        end_offset?: number;
    };
    expected?: Array<{
        name: string;
        start_offset: number;
        end_offset: number;
    }>;
    comments?: string[];
}

export interface PatternFile {
    name: string;
    patterns: Pattern[];
}

interface DryRunResult {
    id: string;
    name: string;
    hits: number;
    results: any[];
    completed: boolean;
}

interface Config {
    server: string;
    target: string;
    scope: 'repo' | 'org' | 'enterprise';
    patterns?: string[];
    dryRunThreshold?: number;
    enablePushProtection?: boolean;
    headless?: boolean;
    downloadExisting?: boolean;
    validate?: boolean;
    validateOnly?: boolean;
    debug?: boolean;
}

let state: any = null;

export async function main() {
    const config = parseArgs();
    
    console.log(chalk.bold.blue(`🔐 Secret Scanning Custom Pattern Automation Tool`));
    console.log(chalk.gray(`Using server: ${config.server}`));
    console.log(chalk.gray(`Target: ${config.target}`));
    console.log(chalk.gray(`Scope: ${config.scope}\n`));

    // Handle validation-only mode
    if (config.validateOnly) {
        if (!config.patterns || config.patterns.length === 0) {
            console.error(chalk.red('❌ No pattern files specified for validation'));
            process.exit(1);
        }
        
        console.log(chalk.yellow('🔍 Running validation-only mode (no upload)'));
        
        for (const patternPath of config.patterns) {
            try {
                console.log(chalk.blue(`\n📁 Loading pattern file: ${patternPath}`));
                const patternFile = await loadPatternFile(patternPath);
                validatePatterns(patternFile);
            } catch (error) {
                console.error(chalk.red(`❌ Validation failed for ${patternPath}:`), error);
                process.exit(1);
            }
        }
        
        console.log(chalk.green('\n✅ All pattern files passed validation!'));
        process.exit(0);
    }

    try {
        await login(config.server);
    } catch (error) {
        console.error(chalk.red('❌ Login failed:'), error);
        process.exit(1);
    }

    if (state === null) {
        console.error(chalk.red('❌ Authentication error.'));
        process.exit(1);
    }

    const browser = await chromium.launch({ headless: config.headless });
    const context = await browser.newContext({ storageState: state });
    
    try {
        if (config.downloadExisting) {
            await downloadExistingPatterns(context, config);
        }

        if (config.patterns && config.patterns.length > 0) {
            await uploadPatterns(context, config);
        }
        
        console.log(chalk.green('\n🎉 All operations completed successfully!'));
    } finally {
        browser.close();
    }
}

function parseArgs(): Config {
    const args = minimist(process.argv.slice(2));

    const target: string | undefined = args._.pop();
    
    // For validate-only mode, target can be a placeholder
    if (args['validate-only'] && !target) {
        console.log(chalk.yellow('ℹ️  Running validation-only mode without target specification'));
        return {
            server: 'https://github.com',
            target: 'validation-only',
            scope: 'repo',
            patterns: args.pattern ? (Array.isArray(args.pattern) ? args.pattern : [args.pattern]) : undefined,
            validateOnly: true,
            validate: true
        };
    }
    
    if (!target) {
        console.error(chalk.red('❌ Please provide a target repository, organization, or enterprise.'));
        process.exit(1);
    }

    // auto-detect scope based on target
    let scope: 'repo' | 'org' | 'enterprise';
    if (target.includes('/')) {
        scope = 'repo';
    } else if (args.scope === undefined) {
        scope = 'org';
    } else {
        scope = args.scope;
    }

    // check scope is valid
    const validScopes = ['repo', 'org', 'enterprise'];
    if (!validScopes.includes(scope)) {
        console.error(chalk.red(`❌ Invalid scope: ${scope}. Valid scopes are: ${validScopes.join(', ')}`));
        process.exit(1);
    }

    return {
        server: args.server ?? 'https://github.com',
        target,
        scope,
        patterns: args.pattern ? (Array.isArray(args.pattern) ? args.pattern : [args.pattern]) : undefined,
        dryRunThreshold: args['dry-run-threshold'] ? parseInt(args['dry-run-threshold'], 10) : 50,
        enablePushProtection: args['enable-push-protection'] ?? false,
        headless: args.headless ?? true,
        downloadExisting: args['download-existing'] ?? false,
        validateOnly: args['validate-only'] ?? false,
        validate: args.validate ?? true,
        debug: args.debug ?? false
    };
}

async function login(server: string) {
    // look for existing state stored in .state file locally
    const stateFilePath = path.join(process.cwd(), '.state');
    try {
        state = JSON.parse(await fs.readFile(stateFilePath, 'utf-8'));
        console.log('Using existing authentication state from .state file');
        return;
    } catch (error) {
        console.warn('No existing authentication state found, proceeding with manual login');
    }

    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();

    // Wait for user to log in
    await page.goto(`${server}/login`);
    console.log(`Please log in manually to GitHub on ${server}`);
    
    console.log('Waiting for manual login... Press Enter once logged in.');
    // Wait for user input
    await new Promise<void>((resolve) => {
        process.stdin.once('data', () => resolve());
    });

    // Save browser state
    state = await context.storageState();

    await fs.writeFile(stateFilePath, JSON.stringify(state, null, 2));

    console.log('Login successful, state saved.');
    await browser.close();
}

async function downloadExistingPatterns(context: BrowserContext, config: Config): Promise<void> {
    console.log('Downloading existing patterns...');
    const page = await context.newPage();
    
    try {
        const url = buildUrl(config, 'settings/security_analysis');

        console.log(`Navigating to: ${url}`);

        const result = await page.goto(url);

        if (!result || !result.ok()) {
            console.error(`Failed to load page: ${result?.status() || 'unknown error'}`);
            return;
        }

        let keepGoing = true;
        const extractedPatterns: any[] = [];
        let count = 0;
        let firstPage = true;

        while(keepGoing) {

            console.log('Waiting for page to load...');

            await page.waitForLoadState('load');

            const customPatternList = page.locator('.js-custom-pattern-list').first();

            let busy = true;

            while (busy) {
                busy = await customPatternList.getAttribute('busy') !== null;
            }

            // wait a little longer to ensure the table is fully loaded
            await page.waitForTimeout(200);

            if (!customPatternList) {
                console.warn('No custom patterns found on the page');
                return;
            }

            const customPatternCount = await customPatternList.locator('.js-custom-pattern-total-count').first().textContent();

            if (!customPatternCount) {
                console.warn('No custom patterns found on the page');
                return;
            }

            // put out value from text
            if (firstPage) {
                firstPage = false;
                count = parseInt(customPatternCount.match(/\d+/)?.[0] ?? '0', 10);
                console.log(`Found ${count} existing patterns`);
            }

            const patternRows = await customPatternList.locator('li[class="Box-row"]').all();

            if (!patternRows || patternRows.length === 0) {
                console.warn('No existing patterns found');
                return;
            }

            for (const row of patternRows) {
                const link = row.locator('.js-navigation-open').first();

                if (link) {
                    const name = await link.textContent();
                    const url = await link.getAttribute('href');
                    const id = url?.split('/').pop() || '';

                    console.log(`Found pattern: ${name} (ID: ${id})`);

                    // now get the content of the URL, by loading it and extracting it from the page
                    const patternPage = await context.newPage();
                    const result = await patternPage.goto(`${config.server}${url}`);
                    if (!result || !result.ok()) {
                        console.warn(`Failed to load pattern page: ${result?.status() || 'unknown error'}`);
                        continue;
                    }

                    await patternPage.waitForLoadState('load');

                    // the data is in HTML content of the page, so we need to use the right locators to get it out
                    const patternName = await patternPage.locator('#display_name').getAttribute('value');
                    const secretFormat = await patternPage.locator('#secret_format').getAttribute('value');
                    const beforeSecret = await patternPage.locator('#before_secret').getAttribute('value');
                    const afterSecret = await patternPage.locator('#after_secret').getAttribute('value');
                    const additionalMatches = await patternPage.locator('.js-additional-secret-format').all();

                    // record if it is published or not
                    const subHead = await patternPage.locator('h1.Subhead-heading').textContent();
                    const isPublished = subHead?.includes('Update pattern');

                    console.log(`Found pattern: ${patternName}`);
                    console.log(`Secret format: ${secretFormat}`);
                    console.log(`Before secret: ${beforeSecret}`);
                    console.log(`After secret: ${afterSecret}`);

                    // pull out additional matches, and if they are Must match or Must not Match
                    const additionalMatchRules: Map<string, Array<string>> = new Map();

                    for await (const match of additionalMatches) {
                        // skip if it has 'has-removed-contents' set in the class
                        const className = await match.getAttribute('class');
                        if (className?.includes('has-removed-contents')) {
                            continue;
                        }

                        console.log("Processing additional match");

                        const additionalSecretFormat = await match.locator('input[type="text"]').getAttribute('value');

                        console.log(`Additional secret format: ${additionalSecretFormat}`);

                        if (!additionalSecretFormat) {
                            console.warn('No additional secret format found, skipping this match');
                            continue;
                        }

                        // Get the radio button with value='must_match'
                        const mustMatchRadio = match.locator('input[type="radio"][value="must_match"]');

                        if (!mustMatchRadio) {
                            console.warn('No must match radio button found, skipping this match');
                            continue;
                        }

                        const isMustMatch = await mustMatchRadio.isChecked();

                        // the matchType is a radio button with value 'must_match' or 'must_not_match'
                        const matchType = isMustMatch ? 'must_match' : 'must_not_match';

                        console.log(`Match type: ${matchType}`);

                        if (!additionalMatchRules.has(matchType)) {
                            additionalMatchRules.set(matchType, []);
                        }
                        additionalMatchRules.get(matchType)?.push(additionalSecretFormat);
                    }

                    // reprocess additional matches so we can serialize as JSON - so in a plain JS object, not a Map
                    const additionalMatchesObject = Object.fromEntries(additionalMatchRules.entries());

                    extractedPatterns.push({
                        id: id,
                        name: name,
                        secret_format: secretFormat,
                        before_secret: beforeSecret,
                        after_secret: afterSecret,
                        additional_matches: additionalMatchesObject,
                        is_published: isPublished
                    });
                }
            }

            // record how many we found on the page
            count -= patternRows.length;

            if (count > 0) {
                console.warn(`⚠️  Found ${count} more patterns, but only processed the first ${patternRows.length} on this page.`);
            }

            // find the Next> button
            const nextButton = customPatternList.locator('button[id="next_cursor_button_udp"]');
            if (await nextButton.isVisible() && await nextButton.isEnabled()) {
                await nextButton.click();
                console.log('Clicked Next button to load more patterns');
            } else {
                console.log('No more patterns to load, stopping pagination');
                keepGoing = false;
            }
        }

        console.log(`Found ${extractedPatterns.length} existing patterns`);
        
        // Save patterns to file
        const outputPath = path.join(process.cwd(), 'existing-patterns.json');
        await fs.writeFile(outputPath, JSON.stringify(extractedPatterns, null, 2));
        console.log(`Existing patterns saved to: ${outputPath}`);

    } finally {
        await page.close();
    }
}

async function uploadPatterns(context: BrowserContext, config: Config): Promise<void> {
    if (!config.patterns || config.patterns.length === 0) {
        console.log('No patterns specified for upload');
        return;
    }

    console.log(`Uploading ${config.patterns.length} pattern file(s)...`);

    for (const patternPath of config.patterns) {
        try {
            console.log(`Processing pattern file: ${patternPath}`);
            const patternFile = await loadPatternFile(patternPath);
            
            if (config.validate) {
                validatePatterns(patternFile);
            }

            for (const pattern of patternFile.patterns) {
                await processPattern(context, config, pattern);
            }
        } catch (error) {
            console.error(`Failed to process pattern file ${patternPath}:`, error);
        }
    }
}

async function loadPatternFile(filePath: string): Promise<PatternFile> {
    const content = await fs.readFile(filePath, 'utf-8');
    
    try {
        return yaml.load(content) as PatternFile;
    } catch (yamlError) {
        try {
            return JSON.parse(content) as PatternFile;
        } catch (jsonError) {
            throw new Error(`Failed to parse file as YAML or JSON: ${yamlError}`);
        }
    }
}

function validatePatterns(patternFile: PatternFile): void {
    console.log(chalk.bold(`\n🔍 Validating patterns in: ${patternFile.name}`));
    
    const fileResult = PatternValidator.validatePatternFile(patternFile);
    
    if (fileResult.isValid) {
        console.log(chalk.green('✓ All patterns passed validation'));
    } else {
        PatternValidator.printValidationReport(fileResult);
        throw new Error('Pattern validation failed');
    }
    
    // Individual pattern validation for detailed reporting
    const patternResults = patternFile.patterns.map(pattern => ({
        name: pattern.name,
        result: PatternValidator.validatePattern(pattern)
    }));

    // Print summary table
    const summaryTable = PatternValidator.createSummaryTable(patternResults);
    console.log('\n📊 Validation Summary:');
    console.log(summaryTable);
    
    console.log(chalk.green('✅ Pattern validation completed successfully\n'));
}

async function fillInPattern(page: Page, pattern: Pattern): Promise<void> {
    console.log(chalk.blue(`Filling in basic pattern information...`));
    
    await page.fill('input[name="display_name"]', pattern.name);
    await page.fill('input[name="secret_format"]', pattern.regex.pattern);

    if (pattern.regex.start || pattern.regex.end || pattern.regex.additional_match || pattern.regex.additional_not_match) {

        // Check if "more options" section exists and expand it
        const moreOptions = page.locator('div.js-more-options').first();
        if (await moreOptions.isVisible()) {
            const detailsButton = moreOptions.locator('button.js-details-target.Details-content--shown');
            if (await detailsButton.isVisible()) {
                const isExpanded = await detailsButton.getAttribute('aria-expanded');
                if (isExpanded !== 'true') {
                    console.log(chalk.blue(`Expanding more options section...`));
                    await detailsButton.click();
                    await page.waitForTimeout(500); // Wait for expansion animation
                }
            }
        }
    }
    
    if (pattern.regex.start) {
        console.log(chalk.blue(`Setting before secret pattern...`));
        const beforeSecretInput = page.locator('input[name="before_secret"]');
        await beforeSecretInput.click();
        await beforeSecretInput.fill(pattern.regex.start);
    }
    
    if (pattern.regex.end) {
        console.log(chalk.blue(`Setting after secret pattern...`));
        const afterSecretInput = page.locator('input[name="after_secret"]');
        await afterSecretInput.click();
        await afterSecretInput.fill(pattern.regex.end);
    }
    
    if (pattern.regex.additional_match) {
        console.log(chalk.blue(`Adding ${pattern.regex.additional_match.length} additional match rules...`));
        for (const [index, rule] of pattern.regex.additional_match.entries()) {
            await addAdditionalRule(page, rule, 'must_match', index);
        }
    }
    
    if (pattern.regex.additional_not_match) {
        console.log(chalk.blue(`Adding ${pattern.regex.additional_not_match.length} additional not-match rules...`));
        for (const [index, rule] of pattern.regex.additional_not_match.entries()) {
            const offset = pattern.regex.additional_match?.length || 0;
            await addAdditionalRule(page, rule, 'must_not_match', index + offset);
        }
    }
    
    console.log(chalk.green(`✅ Pattern information filled successfully`));
}

async function processPattern(context: BrowserContext, config: Config, pattern: Pattern): Promise<void> {
    console.log(chalk.bold(`\n🔄 Processing pattern: ${pattern.name}`));
    
    const page = await context.newPage();
    
    try {
        // Navigate to new pattern page
        const url = buildUrl(config, 'settings/security_analysis/custom_patterns/new');
        await page.goto(url);
        await page.waitForLoadState('load');

        console.log(chalk.blue(`📝 Filling in pattern details for: ${pattern.name}`));
        await fillInPattern(page, pattern);

        // Test the pattern
        console.log(chalk.blue(`🧪 Testing pattern: ${pattern.name}`));
        await testPattern(page, pattern);

        // Perform dry run
        const dryRunResult = await performDryRun(page, pattern, config);

        // Interactive confirmation based on results
        const shouldProceed = await confirmPatternAction(pattern, dryRunResult, config);
        
        if (!shouldProceed) {
            console.log(chalk.yellow(`⏭️  Skipped pattern: ${pattern.name}`));
            return;
        }

        // Publish the pattern
        console.log(chalk.green(`📤 Publishing pattern: ${pattern.name}`));
        await publishPattern(page, pattern);

        // Enable push protection if requested
        if (config.enablePushProtection) {
            console.log(chalk.blue(`🛡️  Enabling push protection for pattern: ${pattern.name}`));
            await enablePushProtection(page, pattern);
        }

        console.log(chalk.green(`✅ Successfully processed pattern: ${pattern.name}`));
        
    } catch (error) {
        console.error(chalk.red(`❌ Failed to process pattern "${pattern.name}":`, error));
        throw error;
    } finally {
        await page.close();
    }
}

async function testPattern(page: Page, pattern: Pattern): Promise<void> {
    // Add test data
    if (!pattern.test?.data) {
        console.warn(chalk.yellow(`⚠️  No test data found for pattern: ${pattern.name}`));
        return;
    }
    
    await page.fill('div.CodeMirror-code', pattern.test.data);

    let waiting = true;
    let testSuccess: string | null = null;

    // Check for test results
    while (waiting) {
        testSuccess = await page.locator('div.js-test-pattern-matches').textContent();

        if (!testSuccess?.match(/ match$/) && !testSuccess?.includes(' - No matches')) {
            continue;
        };

        waiting = false;

        if (testSuccess?.includes('No matches')) {
            console.warn(chalk.red(`❌ Pattern test failed for: ${pattern.name}`));
            throw new Error(`Pattern test failed for: ${pattern.name}`);
        }
    }
    
    console.log(chalk.green(`✅ Pattern test passed: ${pattern.name}`));
    console.log(chalk.blue(`${testSuccess}`));
}

async function addAdditionalRule(page: Page, rule: string, type: 'must_match' | 'must_not_match', index: number): Promise<void> {
    console.log(chalk.gray(`  Adding additional rule ${index + 1}: ${type} - ${rule.substring(0, 50)}...`));
    
    // Click add button to create new additional rule
    const addButton = page.locator('.js-add-secret-format-button');
    await addButton.click();
    
    // Wait for the new rule input to appear
    await page.waitForSelector(`input[name="post_processing_${index}"]`, { timeout: 5000 });
    
    // Fill in the rule
    await page.fill(`input[name="post_processing_${index}"]`, rule);
    
    // Select the appropriate radio button
    await page.check(`input[name="post_processing_rule_${index}"][value="${type}"]`);
    
    // Small delay to ensure the change is registered
    await page.waitForTimeout(200);
}

async function performDryRun(page: Page, pattern: Pattern, config?: Config): Promise<DryRunResult> {
    console.log(chalk.yellow(`🧪 Starting dry run for pattern: ${pattern.name}`));
    
    // Wait for the dry run button to be enabled
    const dryRunButton = page.locator('button[form="custom-pattern-form"]');
    await dryRunButton.waitFor({ state: 'visible' });
    
    while (!await dryRunButton.isEnabled()) {
        console.log(chalk.gray('Waiting for dry run button to be enabled...'));
        await page.waitForTimeout(1000);
    }
    
    console.log(chalk.blue(`Current URL before click: ${page.url()}`));
    
    // Take a screenshot in debug mode
    if (config?.debug) {
        await page.screenshot({ path: `debug-before-dryrun-${Date.now()}.png`, fullPage: true });
        console.log(chalk.gray('Debug screenshot taken: before dry run click'));
    }
    
    // Click the dry run button and wait for navigation
    const [response] = await Promise.all([
        page.waitForResponse(response => response.url().includes('custom_patterns') && response.status() < 400),
        dryRunButton.click()
    ]);
    
    console.log(chalk.blue(`Clicked dry run button, response: ${response.status()}`));

    console.log(response.url());

    // Check if the response indicates a redirect
    if (response.status() >= 300 && response.status() < 400) {
        const redirectUrl = response.headers()['location'];
        console.log(chalk.blue(`Redirecting to: ${redirectUrl}`));
        await page.goto(redirectUrl);
    }
    
    // Wait for the page to fully load after redirect
    await page.waitForLoadState('load');
    console.log(chalk.blue(`New URL after redirect: ${page.url()}`));

    // Take another screenshot in debug mode
    if (config?.debug) {
        await page.screenshot({ path: `debug-after-dryrun-${Date.now()}.png`, fullPage: true });
        console.log(chalk.gray('Debug screenshot taken: after dry run redirect'));
    }

    // Extract pattern ID from the URL for tracking
    const urlParts = page.url().split('/');
    const patternId = urlParts[urlParts.length - 1];
    console.log(chalk.blue(`Pattern ID: ${patternId}`));

    // Wait for dry run to complete with progress indicator
    let attempts = 0;
    const maxAttempts = 60; // Wait up to 5 minutes - TODO: make configurable, or just remove
    
    process.stdout.write(chalk.yellow('Waiting for dry run to complete'));
    
    while (attempts < maxAttempts) {
        try {
            // Look for the dry run status section
            const statusSection = page.locator('div.js-dry-run-results, .js-custom-pattern-dry-run');
            
            if (await statusSection.isVisible()) {
                // Check for status indicators
                const statusText = await statusSection.textContent() || '';
                
                if (statusText.includes('Completed') || statusText.includes('Complete')) {
                    process.stdout.write(chalk.green(' ✓\n'));
                    break;
                } else if (statusText.includes('Failed') || statusText.includes('Error')) {
                    process.stdout.write(chalk.red(' ✗\n'));
                    throw new Error('Dry run failed');
                } else if (statusText.includes('Queued') || statusText.includes('Running')) {
                    // Still in progress
                    process.stdout.write('.');
                } else {
                    // Check if results are already available (sometimes the status changes quickly)
                    const resultsContainer = page.locator('div.js-dry-run-results-container, .js-custom-pattern-dry-run-results');
                    if (await resultsContainer.isVisible()) {
                        const resultsText = await resultsContainer.textContent() || '';
                        if (resultsText.trim().length > 0 && !resultsText.includes('Queued')) {
                            process.stdout.write(chalk.green(' ✓\n'));
                            break;
                        }
                    }
                    process.stdout.write('.');
                }
            } else {
                // Try alternative selectors for the dry run section
                const alternativeStatus = page.locator('h5.mt-1, .dry-run-status, [data-testid*="dry-run"]');
                if (await alternativeStatus.first().isVisible()) {
                    const status = await alternativeStatus.first().textContent();
                    if (status?.includes('Completed')) {
                        process.stdout.write(chalk.green(' ✓\n'));
                        break;
                    } else if (status?.includes('Failed')) {
                        process.stdout.write(chalk.red(' ✗\n'));
                        throw new Error('Dry run failed');
                    }
                }
                process.stdout.write('.');
            }
        } catch (error) {
            console.log(chalk.gray(`\nDebug: Attempt ${attempts + 1}, error checking status: ${error}`));
            process.stdout.write('.');
        }
        
        await page.waitForTimeout(5000); // Wait 5 seconds
        
        await page.reload();
        await page.waitForLoadState('load');
        
        attempts++;
    }

    if (attempts >= maxAttempts) {
        process.stdout.write(chalk.red(' ✗\n'));
        throw new Error('Dry run timed out');
    }

    // Get dry run results
    const results = await getDryRunResults(page);
    
    console.log(chalk.blue(`📊 Dry run completed: ${results.hits} potential matches found`));
    
    // Display results summary
    if (results.hits > 0) {
        await displayDryRunResults(results);
    }
    
    return {
        id: patternId,
        name: pattern.name,
        hits: results.hits,
        results: results.results,
        completed: true
    };
}

async function getDryRunResults(page: Page): Promise<{ hits: number; results: any[] }> {
    const results: any[] = [];
    let hits = 0;

    try {
        // Wait a moment for the results to load
        await page.waitForTimeout(2000);

        // Look for the dry run results container
        const resultsContainer = page.locator('div.js-dry-run-results-container, .js-custom-pattern-dry-run-results, form.ajax-pagination-form');
        
        if (!await resultsContainer.first().isVisible()) {
            console.log(chalk.gray('No dry run results container found'));
            return { hits: 0, results: [] };
        }

        // Try to get the count from various possible locations
        const countSelectors = [
            'span[data-testid="dry-run-count"]',
            '.js-dry-run-count',
            'span:has-text("potential")',
            'span:has-text("matches")',
            'h5:has-text("potential")'
        ];

        for (const selector of countSelectors) {
            const countElement = page.locator(selector);
            if (await countElement.isVisible()) {
                const countText = await countElement.textContent();
                const match = countText?.match(/(\d+)\s*potential/i);
                if (match) {
                    hits = parseInt(match[1], 10);
                    console.log(chalk.blue(`Found hit count: ${hits}`));
                    break;
                }
            }
        }

        // If we didn't find a count, try to count the actual result rows
        if (hits === 0) {
            const resultRows = page.locator('tr[data-testid="dry-run-result-row"], .js-dry-run-result, li.Box-row');
            const rowCount = await resultRows.count();
            if (rowCount > 0) {
                hits = rowCount;
                console.log(chalk.blue(`Counted ${hits} result rows`));
            }
        }

        // Check for "no results" indicators
        const noResultsSelectors = [
            '[data-testid="no-dry-run-results"]',
            'text="No potential secrets found"',
            'text="0 potential secrets"',
            '.js-no-results'
        ];

        for (const selector of noResultsSelectors) {
            if (await page.locator(selector).isVisible()) {
                console.log(chalk.green('No dry run results found (clean scan)'));
                return { hits: 0, results: [] };
            }
        }

        // Extract results from the page
        const resultSelectors = [
            'tr[data-testid="dry-run-result-row"]',
            '.js-dry-run-result',
            'li.Box-row:has(.js-navigation-open)'
        ];

        for (const selector of resultSelectors) {
            const resultElements = page.locator(selector);
            const count = await resultElements.count();
            
            if (count > 0) {
                console.log(chalk.blue(`Found ${count} result elements using selector: ${selector}`));
                
                for (let i = 0; i < count; i++) {
                    const element = resultElements.nth(i);
                    
                    try {
                        // Try different approaches to extract data based on the structure
                        let repository = '';
                        let file = '';
                        let match = '';

                        // Approach 1: Look for specific data attributes
                        const repoElement = element.locator('[data-testid="repository"], .js-repo-name');
                        const fileElement = element.locator('[data-testid="file-path"], .js-file-path');
                        const matchElement = element.locator('[data-testid="secret-match"], .js-secret-match');

                        if (await repoElement.isVisible()) {
                            repository = await repoElement.textContent() || '';
                        }
                        if (await fileElement.isVisible()) {
                            file = await fileElement.textContent() || '';
                        }
                        if (await matchElement.isVisible()) {
                            match = await matchElement.textContent() || '';
                        }

                        // Approach 2: If data attributes don't work, try to extract from links and text
                        if (!repository || !file) {
                            const linkElements = element.locator('a');
                            const linkCount = await linkElements.count();
                            
                            if (linkCount >= 2) {
                                repository = await linkElements.nth(0).textContent() || '';
                                file = await linkElements.nth(1).textContent() || '';
                            } else if (linkCount === 1) {
                                const href = await linkElements.nth(0).getAttribute('href') || '';
                                const parts = href.split('/');
                                if (parts.length >= 4) {
                                    repository = `${parts[1]}/${parts[2]}`;
                                    file = parts.slice(5).join('/');
                                }
                            }
                        }

                        // Approach 3: Extract text content and try to parse it
                        if (!match) {
                            const elementText = await element.textContent() || '';
                            // Look for patterns that might be the secret match
                            const lines = elementText.split('\n').map(line => line.trim()).filter(line => line);
                            for (const line of lines) {
                                if (line.length > 10 && (line.includes('=') || line.includes(':') || line.includes('"') || line.includes("'"))) {
                                    match = line;
                                    break;
                                }
                            }
                        }

                        if (repository || file || match) {
                            results.push({
                                repository: repository.trim(),
                                file: file.trim(),
                                match: match.trim()
                            });
                        }
                    } catch (error) {
                        console.log(chalk.gray(`Warning: Could not extract data from result ${i}: ${error}`));
                    }
                }
                break; // Found results with this selector, no need to try others
            }
        }

        // If we still don't have results but have a hit count, create placeholder results
        if (results.length === 0 && hits > 0) {
            console.log(chalk.yellow(`Found ${hits} hits but could not extract detailed results`));
            for (let i = 0; i < Math.min(hits, 10); i++) {
                results.push({
                    repository: 'Unknown',
                    file: 'Unknown',
                    match: `Match ${i + 1} (details not available)`
                });
            }
        }

        console.log(chalk.blue(`Extracted ${results.length} detailed results`));

    } catch (error) {
        console.log(chalk.yellow(`Warning: Error extracting dry run results: ${error}`));
    }

    return { hits, results };
}

async function publishPattern(page: Page, pattern: Pattern): Promise<void> {
    // Click publish button
    await page.click('button[name="publish_pattern"]');
    await page.waitForLoadState('networkidle');

    // Check for success message
    const successMessage = await page.locator('.flash-success').isVisible();
    if (!successMessage) {
        const errorMessage = await page.locator('.flash-error').textContent();
        throw new Error(`Failed to publish pattern: ${errorMessage}`);
    }
}

async function enablePushProtection(page: Page, pattern: Pattern): Promise<void> {
    // Look for push protection toggle
    const pushProtectionToggle = page.locator('button[name="push_protection_enabled"]');
    
    if (await pushProtectionToggle.isVisible()) {
        const isEnabled = await pushProtectionToggle.textContent();
        
        if (isEnabled?.includes('Enable')) {
            await pushProtectionToggle.click();
            await page.waitForLoadState('networkidle');
            console.log(`✓ Push protection enabled for pattern: ${pattern.name}`);
        } else {
            console.log(`Push protection already enabled for pattern: ${pattern.name}`);
        }
    } else {
        console.warn(`Push protection toggle not found for pattern: ${pattern.name}`);
    }
}

async function displayDryRunResults(results: { hits: number; results: any[] }): Promise<void> {
    if (results.hits === 0) {
        console.log(chalk.green('✓ No potential secrets found - clean dry run!'));
        return;
    }

    console.log(chalk.yellow(`\n⚠️  Found ${results.hits} potential matches:`));

    // Create a table to display results
    const table = new Table({
        head: ['Repository', 'File', 'Match Preview'],
        colWidths: [30, 50, 60]
    });

    // Show first 10 results
    const displayResults = results.results.slice(0, 10);
    for (const result of displayResults) {
        table.push([
            result.repository || 'N/A',
            result.file || 'N/A',
            (result.match || 'N/A').substring(0, 55) + (result.match?.length > 55 ? '...' : '')
        ]);
    }

    console.log(table.toString());

    if (results.results.length > 10) {
        console.log(chalk.gray(`... and ${results.results.length - 10} more results`));
    }

    console.log(chalk.blue('\n💡 Review these results to ensure they represent actual secrets, not false positives.'));
}

async function confirmPatternAction(pattern: Pattern, dryRunResult: DryRunResult, config: Config): Promise<boolean> {
    if (config.dryRunThreshold && dryRunResult.hits > config.dryRunThreshold) {
        console.log(chalk.red(`\n❌ Pattern "${pattern.name}" exceeds dry run threshold (${dryRunResult.hits} > ${config.dryRunThreshold})`));
        
        const answer = await inquirer.prompt([{
            type: 'confirm',
            name: 'proceed',
            message: 'Do you want to proceed anyway?',
            default: false
        }]);
        
        return answer.proceed;
    }

    if (dryRunResult.hits === 0) {
        console.log(chalk.green(`✅ Pattern "${pattern.name}" has no matches - proceeding automatically`));
        return true;
    }

    const answer = await inquirer.prompt([{
        type: 'list',
        name: 'action',
        message: `Pattern "${pattern.name}" found ${dryRunResult.hits} matches. What would you like to do?`,
        choices: [
            { name: 'Proceed with publishing', value: 'publish' },
            { name: 'Skip this pattern', value: 'skip' },
            { name: 'View detailed results', value: 'view' }
        ]
    }]);

    if (answer.action === 'view') {
        await displayDetailedResults(dryRunResult);
        // Ask again after viewing
        return confirmPatternAction(pattern, dryRunResult, config);
    }

    return answer.action === 'publish';
}

async function displayDetailedResults(dryRunResult: DryRunResult): Promise<void> {
    console.log(chalk.bold(`\n📋 Detailed Results for "${dryRunResult.name}":`));
    
    const table = new Table({
        head: ['#', 'Repository', 'File Path', 'Match'],
        colWidths: [5, 25, 40, 50]
    });

    for (const [index, result] of dryRunResult.results.entries()) {
        if (index >= 50) { // Limit to 50 results for readability
            console.log(chalk.gray(`... and ${dryRunResult.results.length - 50} more results`));
            break;
        }
        
        table.push([
            (index + 1).toString(),
            result.repository || 'N/A',
            result.file || 'N/A',
            result.match || 'N/A'
        ]);
    }

    console.log(table.toString());
}

function buildUrl(config: Config, ...pathSegments: string[]): string {
    let basePath = '';
    
    if (config.scope === 'repo') {
        const [owner, repo] = config.target.split('/', 2);
        if (!owner || !repo) {
            throw new Error('Invalid repository format. Use "owner/repo".');
        }
        basePath = `${config.server}/${owner}/${repo}`;
    } else if (config.scope === 'org') {
        basePath = `${config.server}/organizations/${config.target}`;
    } else if (config.scope === 'enterprise') {
        basePath = `${config.server}/enterprises/${config.target}`;
    }
    
    return `${basePath}/${pathSegments.join('/')}`;
}
