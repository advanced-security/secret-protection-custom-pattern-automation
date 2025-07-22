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
        validate: args.validate ?? true,
        debug: args.debug ?? false
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
                    console.log(`Getting: ${name} (ID: ${id})`);
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
                    // pull out additional matches, and if they are Must match or Must not Match
                    const additionalMatchRules = new Map();
                    for await (const match of additionalMatches) {
                        // skip if it has 'has-removed-contents' set in the class
                        const className = await match.getAttribute('class');
                        if (className?.includes('has-removed-contents')) {
                            continue;
                        }
                        const additionalSecretFormat = await match.locator('input[type="text"]').getAttribute('value');
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
                        if (!additionalMatchRules.has(matchType)) {
                            additionalMatchRules.set(matchType, []);
                        }
                        additionalMatchRules.get(matchType)?.push(additionalSecretFormat);
                    }
                    // reprocess additional matches so we can serialize as JSON - so in a plain JS object, not a Map
                    const additionalMatchesObject = Object.fromEntries(additionalMatchRules.entries());
                    // TODO: record if push protection is enabled or not
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
            // find the Next> button
            const nextButton = customPatternList.locator('button[id="next_cursor_button_udp"]');
            if (await nextButton.isVisible() && await nextButton.isEnabled()) {
                await nextButton.click();
            }
            else {
                keepGoing = false;
            }
        }
        console.log(`Got ${extractedPatterns.length} existing patterns`);
        // Save patterns to file
        const outputPath = path.join(process.cwd(), 'existing-patterns.yml');
        await fs.writeFile(outputPath, yaml.dump(extractedPatterns));
        console.log(`Saved to: ${outputPath}`);
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
        catch (err) {
            const error = err;
            console.error(`Failed to fully process pattern file ${patternPath}:`, error.message);
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
async function expandMoreOptions(page) {
    const moreOptions = page.locator('div.js-more-options').first();
    if (await moreOptions.isVisible()) {
        const detailsButtons = await moreOptions.locator('button.js-details-target').all();
        for (const detailsButton of detailsButtons) {
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
}
function comparePatterns(patternA, patternB) {
    return patternA?.trim() === patternB?.trim();
}
async function fillInPattern(page, pattern, isExisting = false, config) {
    // If this is an existing pattern, clear the fields first, if they are different to what we are uploading
    if (isExisting) {
        let changed = false;
        await expandMoreOptions(page);
        const currentSecretFormat = page.locator('input[name="secret_format"]');
        const secretFormatContent = await currentSecretFormat.getAttribute('value');
        if (secretFormatContent && !comparePatterns(secretFormatContent, pattern.regex.pattern)) {
            console.log(secretFormatContent);
            console.log(pattern.regex.pattern);
            await currentSecretFormat.click();
            await currentSecretFormat.clear();
            changed = true;
        }
        // Clear before/after secret fields if they exist
        const beforeSecretInput = page.locator('input[name="before_secret"]');
        const beforeSecretContent = await beforeSecretInput.getAttribute('value');
        if (beforeSecretContent && !comparePatterns(beforeSecretContent, pattern.regex.start)) {
            if (await beforeSecretInput.isVisible()) {
                await beforeSecretInput.click();
                await beforeSecretInput.clear();
                changed = true;
            }
        }
        const afterSecretInput = page.locator('input[name="after_secret"]');
        const afterSecretContent = await afterSecretInput.getAttribute('value');
        if (afterSecretContent && !comparePatterns(afterSecretContent, pattern.regex.end)) {
            if (await afterSecretInput.isVisible()) {
                await afterSecretInput.click();
                await afterSecretInput.clear();
                changed = true;
            }
        }
        // Clear existing additional rules by removing them
        try {
            const removeExistingAdditionalMatches = await page.locator('button.js-remove-secret-format-button').all();
            // if there are no additional matches, and no buttons to remove them, there's no change
            if (removeExistingAdditionalMatches.length === 0 && pattern.regex.additional_match?.length === 0 && pattern.regex.additional_not_match?.length === 0) {
                ;
            }
            else {
                // check if the additional matches are already present on the page - if they all are, and there are no extra ones, then we didn't change anything
                const existingAdditionalMatches = await page.locator('input[name="additional_match"]').all();
                const existingNotMatches = await page.locator('input[name="additional_not_match"]').all();
                if (existingAdditionalMatches.length === (pattern.regex.additional_match?.length ?? 0) && existingNotMatches.length === (pattern.regex.additional_not_match?.length ?? 0)) {
                    // Check if all existing matches are the same as the new ones
                    let allMatchesSame = true;
                    for (let i = 0; i < existingAdditionalMatches.length; i++) {
                        const currentValue = await existingAdditionalMatches[i].inputValue();
                        if (currentValue !== pattern.regex.additional_match?.[i]) {
                            allMatchesSame = false;
                            break;
                        }
                    }
                    if (!allMatchesSame) {
                        changed = true;
                    }
                    let allNotMatchesSame = true;
                    for (let i = 0; i < existingNotMatches.length; i++) {
                        const currentValue = await existingNotMatches[i].inputValue();
                        if (currentValue !== pattern.regex.additional_not_match?.[i]) {
                            allNotMatchesSame = false;
                            break;
                        }
                    }
                    if (!allNotMatchesSame) {
                        changed = true;
                    }
                }
                else {
                    changed = true;
                }
                for (const removeButton of removeExistingAdditionalMatches) {
                    if (await removeButton.isVisible() && await removeButton.isEnabled()) {
                        await removeButton.click();
                    }
                }
            }
        }
        catch (error) {
            console.log(chalk.gray(`Note: Could not clear all existing additional rules: ${error}`));
        }
        if (!changed) {
            console.log(chalk.yellow(`No changes detected against existing pattern, skipping submission`));
            return;
        }
    }
    else {
        await page.fill('input[name="display_name"]', pattern.name);
    }
    if (pattern.regex.start || pattern.regex.end || pattern.regex.additional_match || pattern.regex.additional_not_match) {
        await expandMoreOptions(page);
    }
    const secretFormat = page.locator('input[name="secret_format"]');
    await secretFormat.click();
    await secretFormat.fill(pattern.regex.pattern);
    if (pattern.regex.start) {
        const beforeSecretInput = page.locator('input[name="before_secret"]');
        await beforeSecretInput.click();
        await beforeSecretInput.fill(pattern.regex.start);
    }
    if (pattern.regex.end) {
        const afterSecretInput = page.locator('input[name="after_secret"]');
        await afterSecretInput.click();
        await afterSecretInput.fill(pattern.regex.end);
    }
    if (pattern.regex.additional_match) {
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
async function findExistingPatternByName(context, config, patternName) {
    const page = await context.newPage();
    try {
        const url = buildUrl(config, 'settings/security_analysis');
        const result = await page.goto(url);
        if (!result || !result.ok()) {
            console.warn(`Failed to load security analysis page: ${result?.status() || 'unknown error'}`);
            return null;
        }
        let keepGoing = true;
        while (keepGoing) {
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
                return null;
            }
            const patternRows = await customPatternList.locator('li[class="Box-row"]').all();
            if (!patternRows || patternRows.length === 0) {
                console.warn('No existing patterns found');
                return null;
            }
            // Check each pattern on this page
            for (const row of patternRows) {
                const link = row.locator('.js-navigation-open').first();
                if (link) {
                    const name = await link.textContent();
                    if (name?.trim() === patternName) {
                        const url = await link.getAttribute('href');
                        return url;
                    }
                }
            }
            // Check for next page
            const nextButton = customPatternList.locator('button[id="next_cursor_button_udp"]');
            if (await nextButton.isVisible() && await nextButton.isEnabled()) {
                await nextButton.click();
            }
            else {
                keepGoing = false;
            }
        }
        return null;
    }
    catch (error) {
        console.warn(`Error checking for existing patterns: ${error}`);
        return null;
    }
    finally {
        await page.close();
    }
}
async function processPattern(context, config, pattern) {
    console.log(chalk.bold(`\n🔄 Processing pattern: ${pattern.name}`));
    const page = await context.newPage();
    try {
        // Look at existing patterns to see if one matches this pattern name
        console.log(chalk.blue(`🔍 Checking for existing pattern with name: ${pattern.name}`));
        const existingPatternUrl = await findExistingPatternByName(context, config, pattern.name);
        let url;
        if (existingPatternUrl) {
            console.log(chalk.yellow(`📝 Found existing pattern, editing instead of creating new`));
            url = `${config.server}${existingPatternUrl}`;
        }
        else {
            console.log(chalk.blue(`➕ No existing pattern found, creating new pattern`));
            url = buildUrl(config, 'settings/security_analysis/custom_patterns/new');
        }
        // Navigate to pattern page (new or existing)
        await page.goto(url);
        await page.waitForLoadState('load');
        console.log(page.url());
        console.log(chalk.blue(`📝 Filling in pattern details for: ${pattern.name}`));
        await fillInPattern(page, pattern, !!existingPatternUrl, config);
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
        const action = existingPatternUrl ? 'Updating' : 'Publishing';
        console.log(chalk.green(`📤 ${action} pattern: ${pattern.name}`));
        await publishPattern(page);
        // Enable push protection if requested in the pattern config, or if confirmed by the user
        let enablePushProtectionFlag = config.enablePushProtection;
        if (!enablePushProtectionFlag) {
            // ask the user
            const { enablePushProtection } = await inquirer.prompt({
                name: 'enablePushProtection',
                type: 'confirm',
                message: `Do you want to enable push protection for pattern "${pattern.name}"?`,
                default: false
            });
            enablePushProtectionFlag = enablePushProtection;
        }
        if (enablePushProtectionFlag) {
            console.log(chalk.blue(`🛡️  Enabling push protection for pattern: ${pattern.name}`));
            await enablePushProtection(page, pattern);
        }
        else {
            await disablePushProtection(page, pattern);
        }
        const actionPast = existingPatternUrl ? 'updated' : 'created';
        console.log(chalk.green(`✅ Successfully ${actionPast} pattern: ${pattern.name}`));
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
async function performDryRun(page, pattern, config) {
    console.log(chalk.yellow(`🧪 Starting dry run for pattern: ${pattern.name}`));
    // Wait for the dry run button to be enabled
    const dryRunButton = page.locator('button.js-save-and-dry-run-button');
    await dryRunButton.waitFor({ state: 'visible' });
    while (!await dryRunButton.isEnabled()) {
        console.log(chalk.gray('Waiting for dry run button to be enabled...'));
        await page.waitForTimeout(1000);
    }
    // Click the dry run button and wait for navigation
    const [response] = await Promise.all([
        page.waitForResponse(response => response.url().includes('custom_patterns') && response.status() < 400),
        dryRunButton.click()
    ]);
    try {
        // Check if the response indicates a redirect
        if (response.status() >= 300 && response.status() < 400) {
            const redirectUrl = response.headers()['location'];
            await page.goto(redirectUrl);
        }
        // Wait for the page to fully load after redirect
        await page.waitForLoadState('load');
    }
    catch (err) {
        const error = err;
        console.error(chalk.red(`❌ Error during page navigation: ${error.message}`));
        throw error;
    }
    // Extract pattern ID from the URL for tracking
    const urlParts = page.url().split('/');
    const patternId = urlParts[urlParts.length - 1];
    console.log(chalk.blue(`Pattern ID: ${patternId}`));
    if (!patternId || patternId.length === 0 || patternId === 'new') {
        console.error(chalk.red('❌ Failed to retrieve pattern ID from the URL'));
        throw new Error('Failed to retrieve pattern ID from the URL');
    }
    // Wait for dry run to complete with progress indicator
    let attempts = 0;
    process.stdout.write(chalk.yellow('Waiting for dry run to complete'));
    while (true) {
        try {
            // Check the dry-run status - a span with class f6, and the text "Status" is the header, and the next sibling is the status
            const statusElement = page.locator('span.f6:has-text("Status") + h5');
            const statusText = await statusElement.textContent();
            console.log(chalk.blue(`Dry run status: ${statusText}`));
            if (statusText === 'Completed') {
                console.log(chalk.green('✅ Dry run completed successfully'));
                break;
            }
            else if (statusText === 'In Progress' || statusText === 'Queued') {
                process.stdout.write('.');
            }
            else {
                console.log(chalk.red(`❌ Dry run failed: ${statusText}`));
                break;
            }
        }
        catch (error) {
            console.log(chalk.gray(`\nDebug: Attempt ${attempts + 1}, error checking status: ${error}`));
            process.stdout.write('.');
        }
        await page.waitForTimeout(5000); // Wait 5 seconds
        // TODO: back off a bit after some time, maybe a logistic curve? Grow exponentially at first, then slow down the growth
        await page.reload();
        await page.waitForLoadState('load');
        attempts++;
    }
    // Get dry run results
    const results = await getDryRunResults(page);
    console.log(chalk.blue(`📊 Dry run completed: ${results.count} potential matches found`));
    // Display results summary
    if (results.count > 0) {
        await displayDryRunResults(results);
    }
    return {
        id: patternId,
        name: pattern.name,
        hits: results.count,
        results: results.results,
        completed: true
    };
}
async function getDryRunResults(page) {
    const results = [];
    let count = 0;
    try {
        // Wait a moment for the results to load
        await page.waitForTimeout(500);
        // Look for the dry run results container
        const resultsContainer = page.locator('#custom-pattern-form-frame').locator('form.ajax-pagination-form');
        if (!await resultsContainer.first().isVisible()) {
            console.log(chalk.gray('No dry run results container found'));
            return { count: 0, results: [] };
        }
        // get count from the results container. Find the heading "Total matches" in a span, then get the next sibling element, an h5
        const countElement = resultsContainer.locator('span.f6:has-text("Total matches") + h5');
        const countText = await countElement.textContent();
        console.debug(chalk.blue(`Count text: ${countText}`));
        count = parseInt(countText ?? '0', 10);
        console.log(chalk.blue(`Found hit count: ${count}`));
        // If we didn't find a count, exit
        if (count === 0 || isNaN(count)) {
            console.log(chalk.green('No dry run results found (clean scan)'));
            return { count: 0, results: [] };
        }
        // loop over table results, until we have found enough results or exhausted the list
        let resultsProcessed = 0;
        while (resultsProcessed < count) {
            // grab the new results list
            const resultsList = await resultsContainer.locator('div.Box > ul');
            const resultsItems = await resultsList.locator('li').all();
            const resultCount = resultsItems.length;
            for (const result of resultsItems) {
                // pull out link to result, which is the href of the a element inside a div
                const linkElement = result.locator('div > a');
                if (!await linkElement.isVisible()) {
                    continue;
                }
                const link = await linkElement.getAttribute('href');
                // pull out the partial match, which is the first child span element of the anchor, then the repo/location, which is the second child span element
                const matchElement = linkElement.locator('span').first();
                const match = await matchElement.textContent();
                // pull out the repository/location, which is the second child span element
                const repoElement = linkElement.locator('span.color-fg-muted').first();
                const repositoryLocation = await repoElement.textContent();
                // push the result to the results array
                results.push({
                    match: match?.trim(),
                    repository_location: repositoryLocation?.trim(),
                    link: link
                });
            }
            resultsProcessed += resultCount;
            // find the Next > button, click it, wait for the page to reload
            const nextButton = resultsContainer.locator('button#next_cursor_button');
            if (!await nextButton.isEnabled()) {
                console.log(chalk.blue('No more results to process'));
                break;
            }
            await nextButton.click();
            // ideally, confirm that the existing resultsList has changed. For now, just wait a bit
            await page.waitForTimeout(200);
        }
        console.log(chalk.blue(`Extracted ${results.length} detailed results`));
    }
    catch (error) {
        console.log(chalk.yellow(`Warning: Error extracting dry run results: ${error}`));
    }
    return { count, results };
}
async function publishPattern(page) {
    // Click publish button
    await page.click('button.js-custom-pattern-submit-button');
    // TODO: Check for success message
}
async function enablePushProtection(page, pattern) {
    // Look for push protection toggle
    const pushProtectionToggle = page.locator('button[name="push_protection_enabled"]');
    if (await pushProtectionToggle.isVisible()) {
        const label = await pushProtectionToggle.locator('span.Button-label').first();
        const isNotEnabled = (await label.textContent())?.trim() == 'Enable';
        if (isNotEnabled) {
            await pushProtectionToggle.click();
            await page.waitForLoadState('load');
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
async function disablePushProtection(page, pattern) {
    // Look for push protection toggle
    const pushProtectionToggle = page.locator('button[name="push_protection_enabled"]');
    if (await pushProtectionToggle.isVisible()) {
        const label = await pushProtectionToggle.locator('span.Button-label').first();
        const isEnabled = (await label.textContent())?.trim() == 'Disable';
        if (isEnabled) {
            await pushProtectionToggle.click();
            await page.waitForLoadState('load');
            console.log(`✓ Push protection disabled for pattern: ${pattern.name}`);
        }
        else {
            console.log(`Push protection already disabled for pattern: ${pattern.name}`);
        }
    }
    else {
        console.warn(`Push protection toggle not found for pattern: ${pattern.name}`);
    }
}
async function displayDryRunResults(results) {
    if (results.count === 0) {
        console.log(chalk.green('✓ No potential secrets found - clean dry run!'));
        return;
    }
    console.log(chalk.yellow(`\n⚠️  Found ${results.count} potential matches:`));
    // Create a table to display results
    const table = new Table({
        head: ['Repository location', 'Match Preview'],
    });
    // Show all results
    const displayResults = results.results;
    for (const result of displayResults) {
        table.push([
            result.repository_location || 'N/A',
            result.match || 'N/A',
        ]);
    }
    console.log(table.toString());
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
        head: ['#', 'Repository location', 'Match', 'URL'],
    });
    for (const [index, result] of dryRunResult.results.entries()) {
        if (index >= 50) { // Limit to 50 results for readability
            console.log(chalk.gray(`... and ${dryRunResult.results.length - 50} more results`));
            break;
        }
        table.push([
            (index + 1).toString(),
            result.repository_location || 'N/A',
            result.match || 'N/A',
            result.link || 'N/A'
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
