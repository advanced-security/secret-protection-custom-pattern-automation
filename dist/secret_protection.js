import { chromium } from 'playwright';
import minimist from 'minimist';
import { promises as fs } from 'fs';
import * as yaml from 'js-yaml';
import * as path from 'path';
import chalk from 'chalk';
import Table from 'cli-table3';
import inquirer from 'inquirer';
import { PatternValidator } from './validator.js';
let state = null;
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
            }
            catch (error) {
                console.error(chalk.red(`❌ Validation failed for ${patternPath}:`), error);
                process.exit(1);
            }
        }
        console.log(chalk.green('\n✅ All pattern files passed validation!'));
        process.exit(0);
    }
    try {
        await login(config.server);
    }
    catch (error) {
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
    }
    finally {
        browser.close();
    }
}
function parseArgs() {
    const args = minimist(process.argv.slice(2));
    const target = args._.pop();
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
    let scope;
    if (target.includes('/')) {
        scope = 'repo';
    }
    else if (args.scope === undefined) {
        scope = 'org';
    }
    else {
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
        validate: args.validate ?? true
    };
}
async function login(server) {
    // look for existing state stored in .state file locally
    const stateFilePath = path.join(process.cwd(), '.state');
    try {
        state = JSON.parse(await fs.readFile(stateFilePath, 'utf-8'));
        console.log('Using existing authentication state from .state file');
        return;
    }
    catch (error) {
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
    await new Promise((resolve) => {
        process.stdin.once('data', () => resolve());
    });
    // Save browser state
    state = await context.storageState();
    await fs.writeFile(stateFilePath, JSON.stringify(state, null, 2));
    console.log('Login successful, state saved.');
    await browser.close();
}
async function downloadExistingPatterns(context, config) {
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
        const extractedPatterns = [];
        let count = 0;
        let firstPage = true;
        while (keepGoing) {
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
                    const additionalMatchRules = new Map();
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
            }
            else {
                console.log('No more patterns to load, stopping pagination');
                keepGoing = false;
            }
        }
        console.log(`Found ${extractedPatterns.length} existing patterns`);
        // Save patterns to file
        const outputPath = path.join(process.cwd(), 'existing-patterns.json');
        await fs.writeFile(outputPath, JSON.stringify(extractedPatterns, null, 2));
        console.log(`Existing patterns saved to: ${outputPath}`);
    }
    finally {
        await page.close();
    }
}
async function uploadPatterns(context, config) {
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
        }
        catch (error) {
            console.error(`Failed to process pattern file ${patternPath}:`, error);
        }
    }
}
async function loadPatternFile(filePath) {
    const content = await fs.readFile(filePath, 'utf-8');
    try {
        return yaml.load(content);
    }
    catch (yamlError) {
        try {
            return JSON.parse(content);
        }
        catch (jsonError) {
            throw new Error(`Failed to parse file as YAML or JSON: ${yamlError}`);
        }
    }
}
function validatePatterns(patternFile) {
    console.log(chalk.bold(`\n🔍 Validating patterns in: ${patternFile.name}`));
    const fileResult = PatternValidator.validatePatternFile(patternFile);
    if (fileResult.isValid) {
        console.log(chalk.green('✓ All patterns passed validation'));
    }
    else {
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
async function fillInPattern(page, pattern) {
    await page.fill('input[name="display_name"]', pattern.name);
    await page.fill('input[name="secret_format"]', pattern.regex.pattern);
    // open "more options"
    const moreOptions = await page.locator('div.js-more-options').first();
    await moreOptions.locator('button.js-details-target.Details-content--shown').click();
    if (pattern.regex.start) {
        await page.locator('input[name="before_secret"]').click();
        await page.fill('input[name="before_secret"]', pattern.regex.start);
    }
    if (pattern.regex.end) {
        await page.locator('input[name="after_secret"]').click();
        await page.fill('input[name="after_secret"]', pattern.regex.end);
    }
    if (pattern.regex.additional_match) {
        for (const [index, rule] of pattern.regex.additional_match.entries()) {
            await addAdditionalRule(page, rule, 'must_match', index);
        }
    }
    if (pattern.regex.additional_not_match) {
        for (const [index, rule] of pattern.regex.additional_not_match.entries()) {
            const offset = pattern.regex.additional_match?.length || 0;
            await addAdditionalRule(page, rule, 'must_not_match', index + offset);
        }
    }
}
async function processPattern(context, config, pattern) {
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
        const dryRunResult = await performDryRun(page, pattern);
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
    }
    catch (error) {
        console.error(chalk.red(`❌ Failed to process pattern "${pattern.name}":`, error));
        throw error;
    }
    finally {
        await page.close();
    }
}
async function testPattern(page, pattern) {
    // Add test data
    if (!pattern.test?.data) {
        console.warn(chalk.yellow(`⚠️  No test data found for pattern: ${pattern.name}`));
        return;
    }
    await page.fill('div.CodeMirror-code', pattern.test.data);
    let waiting = true;
    let testSuccess = null;
    // Check for test results
    while (waiting) {
        testSuccess = await page.locator('div.js-test-pattern-matches').textContent();
        if (!testSuccess?.match(/ match$/) && !testSuccess?.includes(' - No matches')) {
            continue;
        }
        ;
        waiting = false;
        if (testSuccess?.includes('No matches')) {
            console.warn(chalk.red(`❌ Pattern test failed for: ${pattern.name}`));
            throw new Error(`Pattern test failed for: ${pattern.name}`);
        }
    }
    console.log(chalk.green(`✅ Pattern test passed: ${pattern.name}`));
    console.log(chalk.blue(`${testSuccess}`));
}
async function addAdditionalRule(page, rule, type, index) {
    // Click add button to create new additional rule
    await page.click('.js-add-secret-format-button');
    // Fill in the rule
    await page.fill(`input[name="post_processing_${index}"]`, rule);
    // Select the appropriate radio button
    await page.check(`input[name="post_processing_rule_${index}"][value="${type}"]`);
}
async function performDryRun(page, pattern) {
    console.log(chalk.yellow(`🧪 Starting dry run for pattern: ${pattern.name}`));
    let dryRunButton = page.locator('button[form="custom-pattern-form"]');
    // Click the dry run button
    while (true) {
        if (!await dryRunButton.isEnabled()) {
            console.log('Dry run button not enabled on the page');
            dryRunButton = page.locator('button[form="custom-pattern-form"]');
            continue;
        }
        break;
    }
    console.log(page.url());
    await dryRunButton.click();
    console.log(chalk.blue(`Clicked dry run button`));
    await page.waitForLoadState('load');
    console.log(page.url());
    // Wait for dry run to complete with progress indicator
    let attempts = 0;
    const maxAttempts = 60; // Wait up to 5 minutes
    process.stdout.write('Waiting for dry run to complete');
    while (attempts < maxAttempts) {
        const form = await page.locator('form.ajax-pagination-form');
        if (!await form.isVisible()) {
            console.error(chalk.red('Dry run form not found, exiting...'));
            throw new Error('Dry run form not found');
        }
        console.log(form.textContent());
        console.log(`\nFound form`);
        try {
            const status = await form.locator('h5.mt-1').textContent();
            if (status?.includes('Completed')) {
                process.stdout.write(chalk.green(' ✓\n'));
                break;
            }
            else if (status?.includes('Failed')) {
                process.stdout.write(chalk.red(' ✗\n'));
                throw new Error('Dry run failed');
            }
        }
        catch (error) {
            // If we can't find the status, continue waiting
            console.error(chalk.yellow(' Dry run status not found, exiting...'));
            break;
        }
        process.stdout.write('.');
        await page.waitForTimeout(5000); // Wait 5 seconds
        await page.reload();
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
        id: pattern.name,
        name: pattern.name,
        hits: results.hits,
        results: results.results,
        completed: true
    };
}
async function getDryRunResults(page) {
    const results = [];
    let hits = 0;
    // Check if there are any results
    const noResultsElement = await page.locator('[data-testid="no-dry-run-results"]').isVisible();
    if (noResultsElement) {
        return { hits: 0, results: [] };
    }
    // Get total count
    const countElement = await page.locator('[data-testid="dry-run-count"]');
    if (await countElement.isVisible()) {
        const countText = await countElement.textContent();
        hits = parseInt(countText?.match(/\d+/)?.[0] || '0', 10);
    }
    // Extract results from all pages
    let hasNextPage = true;
    let pageNumber = 1;
    while (hasNextPage && pageNumber <= 10) { // Limit to 10 pages to avoid infinite loops
        console.log(`Extracting dry run results from page ${pageNumber}...`);
        const pageResults = await page.evaluate(() => {
            const rows = document.querySelectorAll('[data-testid="dry-run-result-row"]');
            return Array.from(rows).map(row => ({
                repository: row.querySelector('[data-testid="repository"]')?.textContent?.trim(),
                file: row.querySelector('[data-testid="file-path"]')?.textContent?.trim(),
                match: row.querySelector('[data-testid="secret-match"]')?.textContent?.trim()
            }));
        });
        results.push(...pageResults);
        // Check for next page
        const nextButton = page.locator('[data-testid="next-page"]');
        hasNextPage = await nextButton.isVisible() && await nextButton.isEnabled();
        if (hasNextPage) {
            await nextButton.click();
            await page.waitForLoadState('networkidle');
            pageNumber++;
        }
    }
    return { hits, results };
}
async function publishPattern(page, pattern) {
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
async function enablePushProtection(page, pattern) {
    // Look for push protection toggle
    const pushProtectionToggle = page.locator('button[name="push_protection_enabled"]');
    if (await pushProtectionToggle.isVisible()) {
        const isEnabled = await pushProtectionToggle.textContent();
        if (isEnabled?.includes('Enable')) {
            await pushProtectionToggle.click();
            await page.waitForLoadState('networkidle');
            console.log(`✓ Push protection enabled for pattern: ${pattern.name}`);
        }
        else {
            console.log(`Push protection already enabled for pattern: ${pattern.name}`);
        }
    }
    else {
        console.warn(`Push protection toggle not found for pattern: ${pattern.name}`);
    }
}
async function displayDryRunResults(results) {
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
async function confirmPatternAction(pattern, dryRunResult, config) {
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
async function displayDetailedResults(dryRunResult) {
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
function buildUrl(config, ...pathSegments) {
    let basePath = '';
    if (config.scope === 'repo') {
        const [owner, repo] = config.target.split('/', 2);
        if (!owner || !repo) {
            throw new Error('Invalid repository format. Use "owner/repo".');
        }
        basePath = `${config.server}/${owner}/${repo}`;
    }
    else if (config.scope === 'org') {
        basePath = `${config.server}/organizations/${config.target}`;
    }
    else if (config.scope === 'enterprise') {
        basePath = `${config.server}/enterprises/${config.target}`;
    }
    return `${basePath}/${pathSegments.join('/')}`;
}
