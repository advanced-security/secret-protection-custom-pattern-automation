import { chromium } from 'playwright';
import minimist from 'minimist';
import { promises as fs } from 'fs';
import * as yaml from 'js-yaml';
import * as path from 'path';
import chalk from 'chalk';
import Table from 'cli-table3';
import inquirer from 'inquirer';
import cliProgress from 'cli-progress';
import { exit } from 'process';
import { PatternValidator } from './validator.js';
import { HELP_TEXT } from './cli.js';
let state = null;
export async function main() {
    const config = parseArgs();
    if (!config) {
        console.error(chalk.red('✖ Invalid configuration. Please check your command line arguments.'));
        console.log(HELP_TEXT);
        process.exit(1);
    }
    console.log(chalk.bold.blue(`🔐 Secret Scanning Custom Pattern Automation Tool`));
    if (config.server !== 'https://github.com') {
        console.log(chalk.gray(`Using server: ${config.server}`));
    }
    console.log(chalk.gray(`Target: ${config.target} (${config.scope})\n`));
    // Handle validation-only mode
    if (config.validateOnly) {
        if (!config.patterns || config.patterns.length === 0) {
            console.error(chalk.red('✖ No pattern files specified for validation'));
            process.exit(1);
        }
        console.log(chalk.yellow('🔍 Running validation-only mode (no upload)'));
        for (const patternPath of config.patterns) {
            try {
                console.log(chalk.blue(`\n📁 Loading pattern file: ${patternPath}`));
                const patternFile = await loadPatternFile(patternPath);
                validatePatterns(patternFile, config);
            }
            catch (error) {
                console.error(chalk.red(`✖ Validation failed for ${patternPath}:`), error);
                process.exit(1);
            }
        }
        console.log(chalk.green('\n✓ All pattern files passed validation'));
        process.exit(0);
    }
    try {
        await login(config.server, config);
    }
    catch (error) {
        console.error(chalk.red('✖ Login failed:'), error);
        process.exit(1);
    }
    if (state === null) {
        console.error(chalk.red('✖ Authentication error.'));
        process.exit(1);
    }
    const browser = await chromium.launch({ headless: config.headless });
    const context = await browser.newContext({ storageState: state || undefined });
    try {
        if (config.downloadExisting) {
            await downloadExistingPatterns(context, config);
        }
        if (config.deleteExisting) {
            await deleteExistingPatterns(context, config);
        }
        if (config.patterns && config.patterns.length > 0) {
            await uploadPatterns(context, config);
        }
    }
    finally {
        browser.close();
    }
}
function parseArgs() {
    const args = minimist(process.argv.slice(2));
    const target = args._.pop();
    const patterns = args.pattern ? (Array.isArray(args.pattern) ? args.pattern : [args.pattern]) : undefined;
    const include_patterns = args['include-pattern-name'] ? (Array.isArray(args['include-pattern-name']) ? args['include-pattern-name'] : [args['include-pattern-name']]) : undefined;
    const exclude_patterns = args['exclude-pattern-name'] ? (Array.isArray(args['exclude-pattern-name']) ? args['exclude-pattern-name'] : [args['exclude-pattern-name']]) : undefined;
    // For validate-only mode, target can be a placeholder
    if (args['validate-only']) {
        console.log(chalk.yellow('ℹ️  Running validation-only mode without target specification'));
        return {
            server: 'https://github.com',
            target: 'validation-only',
            scope: 'repo',
            patterns: patterns,
            patternsToInclude: include_patterns,
            patternsToExclude: exclude_patterns,
            validateOnly: true,
            validate: true,
            dryRunAllRepos: true,
            dryRunThreshold: 0,
            maxTestTries: 25,
        };
    }
    if (!target) {
        console.error(chalk.red('✖ Please provide a target repository, organization, or enterprise.'));
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
    // dry run threshold, from ENV or args - args win
    let dryRunThreshold = 0;
    if (process.env.DRY_RUN_THRESHOLD !== undefined) {
        dryRunThreshold = parseInt(process.env.DRY_RUN_THRESHOLD, 10);
    }
    if (args['dry-run-threshold'] !== undefined) {
        dryRunThreshold = parseInt(args['dry-run-threshold'], 10);
    }
    const dryRunRepoList = args['dry-run-repo'] ? (Array.isArray(args['dry-run-repo']) ? args['dry-run-repo'] : [args['dry-run-repo']]) : [];
    let maxTestTries = 25;
    if (args['max-test-tries'] !== undefined) {
        maxTestTries = parseInt(args['max-test-tries'], 10);
    }
    const config = {
        server: args.server ?? process.env.GITHUB_SERVER ?? 'https://github.com',
        target,
        scope,
        patterns: patterns,
        patternsToInclude: include_patterns,
        patternsToExclude: exclude_patterns,
        dryRunThreshold: dryRunThreshold,
        enablePushProtection: args['enable-push-protection'] ?? false,
        noChangePushProtection: args['keep-push-protection'] ?? false,
        disablePushProtection: args['disable-push-protection'] ?? false,
        headless: args.headless ?? true,
        downloadExisting: args['download-existing'] ?? false,
        deleteExisting: args['delete-existing'] ?? false,
        validateOnly: args['validate-only'] ?? false,
        validate: args.validate ?? true,
        debug: args.debug ?? false,
        dryRunAllRepos: args['dry-run-all-repos'] ?? false,
        dryRunRepoList: dryRunRepoList,
        forceSubmission: args['force-submission'] ?? false,
        maxTestTries: maxTestTries,
    };
    if (config.debug) {
        console.log(chalk.blue('🐛 Debug mode enabled'));
        console.log(chalk.gray(`Config: \n${JSON.stringify(config, null, 2)}`));
        console.log(chalk.grey(`Args: \n${JSON.stringify(args, null, 2)}`));
    }
    // check scope is valid
    const validScopes = ['repo', 'org', 'enterprise'];
    if (!validScopes.includes(config.scope)) {
        console.error(chalk.red(`✖ Invalid scope: ${config.scope}. Valid scopes are: ${validScopes.join(', ')}`));
        process.exit(1);
    }
    if (isNaN(config.dryRunThreshold) || config.dryRunThreshold < 0) {
        config.dryRunThreshold = 0;
    }
    if ((!config.patterns || config.patterns.length === 0) && !config.downloadExisting && !config.deleteExisting) {
        console.warn(chalk.yellow('ℹ️  No patterns specified for upload. You can use --pattern to specify one or more pattern files.'));
        return undefined;
    }
    if (config.enablePushProtection && config.noChangePushProtection) {
        console.warn(chalk.yellow('⚠️ Both --enable-push-protection and --no-change-push-protection are set. Choose one of them only.'));
        return undefined;
    }
    if (config.enablePushProtection && config.disablePushProtection) {
        console.warn(chalk.yellow('⚠️ Both --enable-push-protection and --disable-push-protection are set. Choose one of them only.'));
        return undefined;
    }
    if (config.disablePushProtection && config.noChangePushProtection) {
        console.warn(chalk.yellow('⚠️ Both --disable-push-protection and --no-change-push-protection are set. Choose one of them only.'));
        return undefined;
    }
    if (config.scope === 'org' && !config.dryRunAllRepos && dryRunRepoList.length === 0) {
        console.error(chalk.red('✖ No specific repositories provided for dry-run. To run dry-run on all repositories, use --dry-run-all-repos'));
        return undefined;
    }
    return config;
}
async function goto(page, url, config) {
    while (true) {
        try {
            const result = await page.goto(url);
            if (!result || !result.ok()) {
                console.warn(`Failed to load page: ${result?.status() || 'unknown error'}`);
                return false;
            }
            break;
        }
        catch (err) {
            const error = err;
            if (error.message.startsWith('page.goto: net::ERR')) {
                if (error.message.startsWith('page.goto: net::ERR_ABORTED')) {
                    if (config.debug) {
                        console.warn(chalk.yellow(`⚠️ Network error occurred while loading page: ${error.message}`));
                    }
                    continue;
                }
            }
            console.error(chalk.red(`⨯ Error loading page: ${error.message}`));
            return false;
        }
    }
    return true;
}
async function reload(page, config) {
    while (true) {
        try {
            const result = await page.reload({ waitUntil: 'load' });
            if (!result || !result.ok()) {
                console.warn(`⚠️  Failed to reload page: ${result?.status() || 'unknown error'}`);
                return false;
            }
            break;
        }
        catch (err) {
            const error = err;
            if (error.message.startsWith('page.reload: net::ERR')) {
                if (error.message.startsWith('page.reload: net::ERR_ABORTED')) {
                    if (config.debug) {
                        console.warn(chalk.yellow(`⚠️  Network error occurred while reloading page: ${error.message}`));
                    }
                    continue;
                }
            }
            console.error(chalk.red(`⨯ Error reloading page: ${error.message}`));
            return false;
        }
    }
    return true;
}
async function login(server, config) {
    // look for existing state stored in .state file locally
    const stateFilePath = path.join(process.cwd(), '.state');
    try {
        state = JSON.parse(await fs.readFile(stateFilePath, 'utf-8'));
        console.log(chalk.gray('🔑 Using existing authentication from .state file'));
        return;
    }
    catch {
        console.log(chalk.blue('🔑 No existing authentication found, doing browser login'));
    }
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();
    // Wait for user to log in
    const url = `${server}/login`;
    const success = await goto(page, url, config);
    if (!success) {
        console.error(chalk.red('✖ Failed to load login page. Please check your server URL.'));
        await browser.close();
        return;
    }
    console.log(chalk.blue(`🖥️ Please log in manually to GitHub on ${server}`));
    console.log(chalk.blue('⌨ Waiting for manual login... Press Enter once logged in'));
    // Wait for user input
    await new Promise((resolve) => {
        process.stdin.once('data', () => resolve());
    });
    // Save browser state
    state = await context.storageState();
    await fs.writeFile(stateFilePath, JSON.stringify(state, null, 2));
    console.log(chalk.green('✓ Login successful, state saved'));
    await browser.close();
}
async function deleteExistingPatterns(context, config) {
    console.log('Deleting existing patterns...');
    const page = await context.newPage();
    try {
        const url_path = config.scope !== 'enterprise' ? 'settings/security_analysis' : 'settings/security_analysis_policies/security_features';
        const url = buildUrl(config, url_path);
        const success = await goto(page, url, config);
        if (!success) {
            console.error(chalk.red(`⨯ Failed to load existing patterns`));
            return;
        }
        const existingPatterns = await findExistingPatterns(context, config);
        if (existingPatterns === null) {
            console.error(chalk.red('✖ Failed to find existing patterns'));
            return;
        }
        if (Array.from(existingPatterns.keys()).length === 0) {
            return;
        }
        const deletedPatternNames = new Set();
        const patternsToDelete = Array.from(existingPatterns.entries()).filter(([name, _url]) => {
            return (config.patternsToInclude ? config.patternsToInclude.includes(name) : true) &&
                !(config.patternsToExclude && config.patternsToExclude.includes(name));
        });
        if (patternsToDelete.length === 0) {
            console.log(chalk.blue('ℹ No patterns to delete based on include/exclude filters'));
            return;
        }
        const deleteCount = patternsToDelete.length;
        // confirm deletion of N patterns
        const confirmDelete = await inquirer.prompt({
            type: 'confirm',
            name: 'confirm',
            message: `Are you sure you want to delete ${deleteCount} existing pattern${deleteCount === 1 ? '' : 's'}?`,
            default: false,
        });
        if (!confirmDelete.confirm) {
            console.log(chalk.yellow('⚠️  Deletion cancelled by user'));
            return;
        }
        // progress bar
        const progressBar = new cliProgress.MultiBar({}, cliProgress.Presets.shades_classic);
        const progressBarSimple = progressBar.create(deleteCount, 0);
        for (const [name, url] of patternsToDelete) {
            try {
                const id = url.split('/').pop()?.split('?')[0] || '';
                // now get the content of the URL, by loading it and extracting it from the page
                const patternPage = await context.newPage();
                const success = await goto(patternPage, `${config.server}${url}`, config);
                if (!success) {
                    progressBar.log(chalk.red(`⨯ Failed to load pattern page`));
                    progressBarSimple.increment();
                    continue;
                }
                await patternPage.waitForLoadState('load');
                // show delete dialog - Playwright has trouble clicking the button
                const confirmDialog = await showDialog(patternPage, `remove-pattern-dialog-pattern-${id}`);
                if (!confirmDialog) {
                    progressBar.log(chalk.yellow(`⚠️ No confirmation dialog found for pattern "${name}"`));
                    progressBarSimple.increment();
                    continue;
                }
                // TODO: pick between deleting and closing alerts, and by default confirm delete
                const confirmDeleteSelector = `button[data-close-dialog-id="remove-pattern-dialog-pattern-${id}"][type="submit"]`;
                const confirmDeleteButton = confirmDialog.locator(confirmDeleteSelector);
                if (!confirmDeleteButton) {
                    progressBar.log(chalk.yellow(`⚠️ No confirm delete button found for pattern "${name}"`));
                    progressBarSimple.increment();
                    continue;
                }
                await confirmDeleteButton.click();
                deletedPatternNames.add(name);
                progressBarSimple.increment();
            }
            catch (err) {
                const error = err;
                console.error(chalk.red(`✖ Error when deleting existing pattern: ${error.message}`));
                progressBar.stop();
                return;
            }
        }
        progressBar.stop();
        // wait for a bit for the backend to catch up with the deletes
        await page.waitForTimeout(1000);
    }
    finally {
        await page.close();
    }
}
async function downloadExistingPatterns(context, config) {
    console.log('Downloading existing patterns...');
    const page = await context.newPage();
    try {
        const url_path = config.scope !== 'enterprise' ? 'settings/security_analysis' : 'settings/security_analysis_policies/security_features';
        const url = buildUrl(config, url_path);
        const success = await goto(page, url, config);
        if (!success) {
            console.error(chalk.red(`⨯ Failed to load existing patterns`));
            return;
        }
        let keepGoing = true;
        const extractedPatterns = [];
        let count = 0;
        let firstPage = true;
        // progress bar
        const progressBar = new cliProgress.MultiBar({}, cliProgress.Presets.shades_classic);
        const progressBarSimple = progressBar.create(count, 0);
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
                progressBar.stop();
                console.warn(chalk.yellow('⚠️ No custom patterns found on the page'));
                return;
            }
            if ((await customPatternList.textContent())?.includes('There are no custom patterns for this repository')) {
                progressBar.stop();
                console.log(chalk.blue('ℹ No custom patterns exist on this repository'));
                return;
            }
            const customPatternCount = await customPatternList.locator('.js-custom-pattern-total-count').first().textContent();
            if (!customPatternCount) {
                progressBar.stop();
                console.warn(chalk.yellow('⚠️ No custom pattern count found on the page'));
                return;
            }
            // put out value from text
            if (firstPage) {
                firstPage = false;
                count = parseInt(customPatternCount.match(/\d+/)?.[0] ?? '0', 10);
                progressBarSimple.setTotal(count);
                progressBarSimple.update(0);
            }
            const patternRows = await customPatternList.locator('li[class="Box-row"]').all();
            if (!patternRows || patternRows.length === 0) {
                progressBar.stop();
                return;
            }
            for (const row of patternRows) {
                const link = row.locator('.js-navigation-open').first();
                if (link) {
                    const name = await link.textContent();
                    const url = await link.getAttribute('href');
                    const id = url?.split('/').pop()?.split('?')[0] || '';
                    progressBarSimple.increment();
                    // now get the content of the URL, by loading it and extracting it from the page
                    const patternPage = await context.newPage();
                    const success = await goto(patternPage, `${config.server}${url}`, config);
                    if (!success) {
                        console.error(chalk.red(`⨯ Failed to load pattern page`));
                        continue;
                    }
                    await patternPage.waitForLoadState('load');
                    // the data is in HTML content of the page, so we need to use the right locators to get it out
                    const patternName = await patternPage.locator('#display_name').getAttribute('value');
                    const secretFormat = await patternPage.locator('#secret_format').getAttribute('value');
                    const beforeSecret = await patternPage.locator('#before_secret').getAttribute('value');
                    const afterSecret = await patternPage.locator('#after_secret').getAttribute('value');
                    const additionalMatches = await patternPage.locator('.js-additional-secret-format').all();
                    if (patternName !== name) {
                        console.warn(chalk.yellow(`⚠️ Pattern name mismatch: expected "${name}", found "${patternName}"`));
                    }
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
                            console.warn(chalk.yellow('⚠️ No additional secret format found, skipping this match'));
                            continue;
                        }
                        // Get the radio button with value='must_match'
                        const mustMatchRadio = match.locator('input[type="radio"][value="must_match"]');
                        if (!mustMatchRadio) {
                            console.warn(chalk.yellow('⚠️ No must match radio button found, skipping this match'));
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
                    // Convert to the Pattern interface format
                    const pattern = {
                        name: patternName || `Pattern_${id}`,
                        regex: {
                            version: 1,
                            pattern: secretFormat || '',
                            ...(beforeSecret && { start: beforeSecret }),
                            ...(afterSecret && { end: afterSecret }),
                            ...(additionalMatchRules.get('must_match') && { additional_match: additionalMatchRules.get('must_match') }),
                            ...(additionalMatchRules.get('must_not_match') && { additional_not_match: additionalMatchRules.get('must_not_match') })
                        },
                        comments: [
                            `Downloaded from ${config.scope}: ${config.target} (${config.server})`,
                            `Original ID: ${id}`,
                            `Published: ${isPublished ? 'Yes' : 'No'}`
                        ]
                    };
                    extractedPatterns.push(pattern);
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
        progressBar.stop();
        // Create PatternFile structure matching the import format
        const patternFile = {
            name: `Downloaded patterns from ${config.target}`,
            patterns: extractedPatterns
        };
        // Save patterns to file
        const outputPath = path.join(process.cwd(), 'existing-patterns.yml');
        await fs.writeFile(outputPath, yaml.dump(patternFile));
        console.log(chalk.blue(`⬇️  Saved to: ${outputPath}`));
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
    const unprocessedPatterns = new Map();
    const existingPatterns = await findExistingPatterns(context, config);
    if (existingPatterns === null) {
        console.error(chalk.red('✖ Failed to find existing patterns'));
        return;
    }
    if (config.debug) {
        console.log(chalk.blue(`Debug: Found ${Array.from(existingPatterns.entries()).length} existing patterns`));
    }
    for (const patternPath of config.patterns) {
        try {
            console.log(`Processing pattern file: ${patternPath}`);
            const patternFile = await loadPatternFile(patternPath);
            if (config.validate) {
                validatePatterns(patternFile, config);
            }
            for (const pattern of patternFile.patterns) {
                if (config.patternsToInclude && !config.patternsToInclude.includes(pattern.name)) {
                    if (config.debug) {
                        console.log(chalk.blue(`Skipping pattern '${pattern.name}' not in the include list`));
                    }
                    continue;
                }
                if (config.patternsToExclude && config.patternsToExclude.includes(pattern.name)) {
                    if (config.debug) {
                        console.log(chalk.blue(`Skipping pattern '${pattern.name}' in the exclude list`));
                    }
                    continue;
                }
                try {
                    await processPattern(context, config, pattern, existingPatterns);
                }
                catch (err) {
                    const error = err;
                    console.error(chalk.red(`✖ Failed to process pattern '${pattern.name ?? "**unnamed pattern**"}' in file ${patternPath}:`, error.message));
                    unprocessedPatterns.set(patternPath, unprocessedPatterns.get(patternPath) || []);
                    unprocessedPatterns.get(patternPath)?.push([pattern?.name ?? "**unnamed pattern**", error.message]);
                    if (err instanceof Error && err.message.includes('Target page, context or browser has been closed')) {
                        console.error(chalk.red('⚠️  Browser context or page was closed unexpectedly.'));
                        exit(1);
                    }
                }
            }
        }
        catch (err) {
            const error = err;
            console.error(chalk.red(`✖ Failed to fully process pattern file ${patternPath}:`, error.message));
        }
    }
    if (unprocessedPatterns.size > 0) {
        console.log(chalk.yellow('\n⚠️  Some patterns could not be processed:'));
        for (const [filePath, patterns] of unprocessedPatterns.entries()) {
            console.log(chalk.yellow(`\nFile: ${filePath}`));
            for (const [patternName, errorMessage] of patterns) {
                console.log(chalk.red(`  Pattern: ${patternName} - Error: ${errorMessage}`));
            }
        }
    }
    else {
        console.log(chalk.green('✓ All patterns processed successfully'));
    }
}
async function loadPatternFile(filePath) {
    const content = await fs.readFile(filePath, 'utf-8');
    try {
        return yaml.load(content);
    }
    catch {
        try {
            return JSON.parse(content);
        }
        catch (jsonError) {
            throw new Error(`Failed to parse file as YAML or JSON: ${jsonError}`);
        }
    }
}
function validatePatterns(patternFile, config) {
    const fileResult = PatternValidator.validatePatternFile(patternFile, config);
    if (fileResult.isValid && !config.validateOnly) {
        console.log(chalk.green('✔ All patterns passed validation'));
    }
    else {
        PatternValidator.printValidationReport(fileResult);
    }
    // Individual pattern validation for summary reporting
    const patternResults = patternFile.patterns.filter(pattern => {
        // Filter out patterns that are not in the include list or are in the exclude list
        if (config.patternsToInclude && !config.patternsToInclude.includes(pattern.name)) {
            return false;
        }
        if (config.patternsToExclude && config.patternsToExclude.includes(pattern.name)) {
            return false;
        }
        return true;
    }).map(pattern => ({
        name: pattern.name,
        result: PatternValidator.validatePattern(pattern)
    }));
    // Print summary table
    const summaryTable = PatternValidator.createSummaryTable(patternResults);
    console.log('\n📊 Validation Summary:');
    console.log(summaryTable);
    if (!fileResult.isValid) {
        throw new Error('Pattern validation failed');
    }
}
async function expandMoreOptions(page) {
    const optionsData = page.locator('div.Details-content--shown').first();
    if (await optionsData.isVisible()) {
        return;
    }
    const moreOptions = page.locator('div.js-more-options').first();
    const moreOptionsButton = await moreOptions.locator('button.js-details-target:text-is("More options")').first();
    const isExpanded = await moreOptionsButton.getAttribute('aria-expanded');
    if (isExpanded !== 'true') {
        await moreOptionsButton.click();
        const beforeSecretInput = page.locator('input#before_secret');
        await beforeSecretInput.waitFor({ state: 'visible' });
    }
}
function comparePatterns(patternA, patternB) {
    if (patternA === null || patternA === undefined || patternB === null || patternB === undefined) {
        return false;
    }
    return patternA?.trim() === patternB?.trim();
}
async function fillInPattern(page, pattern, isExisting = false, config) {
    // If this is an existing pattern, clear the fields first, if they are different to what we are uploading
    if (isExisting) {
        let changed = false;
        const removeExistingAdditionalMatchesSelector = 'button.js-remove-secret-format-button';
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
            const removeExistingAdditionalMatches = await page.locator(removeExistingAdditionalMatchesSelector).all();
            if (pattern.regex.additional_match === undefined) {
                pattern.regex.additional_match = [];
            }
            if (pattern.regex.additional_not_match === undefined) {
                pattern.regex.additional_not_match = [];
            }
            // if there are no additional matches, and no buttons to remove them, there's no change
            if (removeExistingAdditionalMatches.length === 0 && pattern.regex.additional_match.length === 0 && pattern.regex.additional_not_match.length === 0) {
                if (config.debug) {
                    console.log(chalk.blue(`✓ No existing additional matches to clear, none to add`));
                }
            }
            else {
                // check if the additional matches are already present on the page - if they all are, and there are no extra ones, then we didn't change anything
                const existingAdditionalMatchCount = parseInt(await page.locator('div.js-post-processing-expression-count').textContent() || '0', 10);
                const newAdditionalMatchCount = pattern.regex.additional_match.length + pattern.regex.additional_not_match.length;
                if (config.debug) {
                    console.log(chalk.blue(`Found ${existingAdditionalMatchCount} existing additional matches`));
                    console.log(chalk.blue(`Adding ${newAdditionalMatchCount} additional matches`));
                }
                if (existingAdditionalMatchCount === newAdditionalMatchCount) {
                    const existingAdditionalMatches = (await page.locator('div.js-additional-secret-format').all()).filter(async (match) => (await match.locator('input[type="radio"]').count()) > 0);
                    if (config.debug) {
                        console.log(chalk.blue(`Found ${existingAdditionalMatches.length}`));
                    }
                    // Check if all existing matches are the same as the new ones
                    let existingMustMatches = [];
                    let existingMustNotMatches = [];
                    for (let i = 0; i < existingAdditionalMatchCount && i < existingAdditionalMatches.length; i++) {
                        const existingMatch = existingAdditionalMatches[i];
                        const radioButton = existingAdditionalMatches[i].locator('input[type="radio"][value="must_match"]');
                        const isMustMatch = await radioButton.isChecked();
                        if (isMustMatch) {
                            existingMustMatches.push(existingMatch);
                        }
                        else {
                            existingMustNotMatches.push(existingMatch);
                        }
                    }
                    for (let i = 0; i < existingMustMatches.length; i++) {
                        const existingMustMatch = existingMustMatches[i];
                        const newMatch = pattern.regex.additional_match[i];
                        const existingMatchValue = await existingMustMatch.locator('input[type="text"]').inputValue();
                        const newMatchValue = pattern.regex.additional_match[i];
                        if (!comparePatterns(existingMatchValue, newMatchValue)) {
                            changed = true;
                            if (config.debug) {
                                console.log(chalk.blue(`Old value and new value differ: ${existingMatchValue} !== ${newMatchValue}`));
                            }
                            break;
                        }
                    }
                    if (!changed) {
                        for (let i = 0; i < existingMustNotMatches.length; i++) {
                            const existingMustNotMatch = existingMustNotMatches[i];
                            const existingMatchValue = await existingMustNotMatch.locator('input[type="text"]').inputValue();
                            const newMatchValue = pattern.regex.additional_not_match[i];
                            if (!comparePatterns(existingMatchValue, newMatchValue)) {
                                changed = true;
                                if (config.debug) {
                                    console.log(chalk.blue(`Old value and new value differ: ${existingMatchValue} !== ${newMatchValue}`));
                                }
                                break;
                            }
                        }
                    }
                }
                else {
                    if (config.debug) {
                        console.log(chalk.blue(`✓ Existing additional matches count (${existingAdditionalMatchCount}) does not match new count (${newAdditionalMatchCount}), will clear all additional matches`));
                    }
                    changed = true;
                }
                if (changed || config.forceSubmission) {
                    if (config.debug) {
                        console.log(chalk.blue(`Removing ${await page.locator(removeExistingAdditionalMatchesSelector).count()} existing additional matches`));
                    }
                    while (await page.locator(removeExistingAdditionalMatchesSelector).count() > 0) {
                        const removeButton = page.locator(removeExistingAdditionalMatchesSelector).last();
                        await removeButton.click();
                    }
                }
            }
        }
        catch (error) {
            console.log(chalk.gray(`Note: Could not check/clear all existing additional rules: ${error}`));
        }
        if (!changed && !config.forceSubmission) {
            console.log(chalk.yellow(`⏩ No changes detected against existing pattern, skipping submission`));
            return false;
        }
        // wait a bit
        await page.waitForTimeout(200);
        if (config.debug) {
            console.log(chalk.blue(`✓ Cleared existing pattern fields`));
            //take screenshot of the cleared pattern
            await page.setViewportSize({ width: 1920, height: 2000 });
            const screenshotPath = path.join(process.cwd(), `debug-cleared_pattern_${pattern.name.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.png`);
            await page.screenshot({ path: screenshotPath });
            console.log(`📸 Screenshot of cleared pattern saved to ${screenshotPath}`);
        }
    }
    else {
        const nameField = page.locator('input[name="display_name"]');
        await nameField.fill(pattern.name);
    }
    if (pattern.regex.start || pattern.regex.end || pattern.regex.additional_match || pattern.regex.additional_not_match) {
        await expandMoreOptions(page);
    }
    const secretFormat = page.locator('input[name="secret_format"]');
    await secretFormat.clear();
    await secretFormat.fill(pattern.regex.pattern);
    if (pattern.regex.start) {
        const beforeSecretInput = page.locator('input[name="before_secret"]');
        await beforeSecretInput.clear();
        await beforeSecretInput.fill(pattern.regex.start);
    }
    if (pattern.regex.end) {
        const afterSecretInput = page.locator('input[name="after_secret"]');
        await afterSecretInput.clear();
        await afterSecretInput.fill(pattern.regex.end);
    }
    if (pattern.regex.additional_match && pattern.regex.additional_match.length > 0) {
        for (const [index, rule] of pattern.regex.additional_match.entries()) {
            const success = await addAdditionalRule(page, rule, 'must_match', index, config);
            if (!success) {
                console.error(chalk.red(`⨯ Failed to add additional match rule ${index} for ${rule}`));
                return false;
            }
            else {
                if (config.debug) {
                    console.log(chalk.blue(`✓ Added additional match rule ${index}: ${rule}`));
                }
            }
        }
    }
    if (pattern.regex.additional_not_match && pattern.regex.additional_not_match.length > 0) {
        for (const [index, rule] of pattern.regex.additional_not_match.entries()) {
            const offset = pattern.regex.additional_match?.length || 0;
            const success = await addAdditionalRule(page, rule, 'must_not_match', index + offset, config);
            if (!success) {
                console.error(chalk.red(`⨯ Failed to add additional not match rule ${index + offset} for ${rule}`));
                return false;
            }
            else {
                if (config.debug) {
                    console.log(chalk.blue(`✓ Added additional not match rule ${index + offset}: ${rule}`));
                }
            }
        }
    }
    console.log(chalk.green(`✓ Pattern filled in - checking for test result and looking for errors`));
    return true;
}
async function findExistingPatterns(context, config) {
    const page = await context.newPage();
    const existingPatterns = new Map();
    try {
        const url_path = config.scope !== 'enterprise' ? 'settings/security_analysis' : 'settings/security_analysis_policies/security_features';
        const url = buildUrl(config, url_path);
        const success = await goto(page, url, config);
        if (!success) {
            console.error(chalk.red(`⨯ Failed to load security analysis page`));
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
            // wait a little to ensure the table is fully loaded
            await page.waitForTimeout(200);
            if (!customPatternList) {
                console.warn(chalk.yellow('⚠️ No custom pattern list found on the page'));
                return null;
            }
            if ((await customPatternList.textContent())?.includes('There are no custom patterns for this repository')) {
                console.log(chalk.blue('ℹ No custom patterns exist on this repository'));
                return existingPatterns;
            }
            let patternRows = [];
            try {
                patternRows = await customPatternList.locator('li[class="Box-row"]').all();
            }
            catch (error) {
                if (config.debug) {
                    console.log(chalk.blue(`Waiting for custom pattern list to be stable, trying again: ${error}`));
                }
                // did page reload? try again
                continue;
            }
            if (!patternRows || patternRows.length === 0) {
                return existingPatterns;
            }
            // Check each pattern on this page
            for (const row of patternRows) {
                const link = row.locator('.js-navigation-open').first();
                if (link) {
                    const name = await link.textContent();
                    const url = await link.getAttribute('href');
                    if (!name || !url) {
                        console.warn(chalk.yellow('⚠️ No name or URL found for pattern'));
                        continue;
                    }
                    existingPatterns.set(name, url);
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
        return existingPatterns;
    }
    catch (error) {
        console.error(chalk.red(`⨯ Error checking for existing patterns: ${error}`));
        if (config.debug) {
            // take screenshot
            const screenshotPath = path.join(process.cwd(), `debug-check_existing_patterns_error_screenshot_${Date.now()}.png`);
            await page.screenshot({ path: screenshotPath });
            console.log(`📸 Screenshot saved to ${screenshotPath}`);
        }
        return null;
    }
    finally {
        await page.close();
    }
}
// TODO: catch errors/warnings after each step and log them, or stop on error
async function processPattern(context, config, pattern, existingPatterns) {
    console.log(chalk.bold(`\n🔄 Processing pattern: ${pattern.name}`));
    // fill in some defaults if parts are missing
    if (pattern.regex.start === undefined) {
        pattern.regex.start = '\\A|[^0-9A-Za-z]';
    }
    if (pattern.regex.end === undefined) {
        pattern.regex.end = '\\z|[^0-9A-Za-z]';
    }
    const page = await context.newPage();
    try {
        // Look at existing patterns to see if one matches this pattern name
        const existingPatternUrl = existingPatterns.get(pattern.name);
        let url;
        if (existingPatternUrl) {
            url = `${config.server}${existingPatternUrl}`;
            const id = existingPatternUrl.split('/').pop()?.split('?')[0] || '';
            console.log(chalk.blue(`🔍 Found existing pattern: ${id}`));
        }
        else {
            const url_path = config.scope !== 'enterprise' ? 'settings/security_analysis/custom_patterns/new' : 'settings/advanced_security/custom_patterns/new';
            url = buildUrl(config, url_path);
        }
        // Navigate to pattern page (new or existing)
        const success = await goto(page, url, config);
        if (!success) {
            console.warn(`Failed to load custom pattern page`);
            return;
        }
        await page.waitForLoadState('load');
        const needToSubmit = await fillInPattern(page, pattern, !!existingPatternUrl, config);
        if (needToSubmit) {
            // Test the pattern
            const testResult = await testPattern(page, pattern, config);
            if (!testResult) {
                throw new Error(`Pattern test failed for '${pattern.name}'`);
            }
            // Perform dry run
            const dryRunResult = await performDryRun(page, pattern, config, !existingPatternUrl);
            // Interactive confirmation based on results
            const shouldProceed = await confirmPatternAction(pattern, dryRunResult, config);
            if (!shouldProceed) {
                console.log(chalk.yellow(`⏭️  Skipped pattern`));
                return;
            }
            // Publish the pattern
            await publishPattern(page);
            const action = existingPatternUrl ? 'Updated' : 'Published';
            console.log(chalk.green(`✓ ${action} pattern`));
            existingPatterns.set(pattern.name, page.url());
        }
        else {
            // publish if the pattern is not already published - we have a pattern there that matches our upload and is unpublished
            // if the title is "Unpublished pattern", we can assume it is unpublished
            const title = await page.locator('h1.Subhead-heading').textContent();
            if (title?.includes('Unpublished pattern')) {
                await publishPattern(page);
            }
        }
        if (config.noChangePushProtection) {
            return;
        }
        // Enable push protection if requested in the pattern config, or if confirmed by the user
        let enablePushProtectionFlag = config.enablePushProtection || pattern.push_protection;
        if (config.disablePushProtection) {
            enablePushProtectionFlag = false;
        }
        if (!enablePushProtectionFlag && !config.disablePushProtection && pattern.push_protection === undefined) {
            // ask the user, if there is no instruction to disable push protection at the args or in the pattern
            const { enablePushProtection } = await inquirer.prompt({
                name: 'enablePushProtection',
                type: 'confirm',
                message: `Do you want to enable push protection for pattern '${pattern.name}'?`,
                default: false
            });
            enablePushProtectionFlag = enablePushProtection;
        }
        if (config.scope === 'repo') {
            await togglePushProtection(page, enablePushProtectionFlag);
        }
        else {
            if (enablePushProtectionFlag) {
                await togglePushProtectionConfig(page, pattern, config, enablePushProtectionFlag);
            }
        }
        const actionPast = existingPatternUrl ? 'updated' : 'created';
        console.log(chalk.green(`✓ Successfully ${actionPast} pattern: ${pattern.name}`));
    }
    finally {
        await page.close();
    }
}
async function testPattern(page, pattern, config) {
    const ignoreTestResult = pattern.test?.data === undefined || pattern.test.data.trim() === '';
    // Add test data
    if (!pattern.test?.data) {
        console.warn(chalk.yellow(`⚠️  No test data found for pattern: ${pattern.name}`));
        // test with a single space, so we can dry-run the pattern
        pattern.test = {
            data: ' '
        };
    }
    else {
        // trim the test data
        pattern.test.data = pattern.test.data.trim();
    }
    if (config.debug) {
        console.log(chalk.blue(`🔄 Testing pattern '${pattern.name}' with data: ${pattern.test.data}`));
    }
    const codeMirror = await page.locator('div.CodeMirror-code').first();
    await codeMirror.focus();
    await codeMirror.click();
    await codeMirror.fill(pattern.test.data);
    let testSuccess = null;
    let tries = 0;
    // Check for test results
    // TODO: use a more robust way to check for test results, including the offsets of the result(s)
    // this might require doing a specific request using secrets derived from the page
    while (!testSuccess?.includes('No matches') && !testSuccess?.match(/\s*- \d+ match(?:es)?\s*$/)) {
        testSuccess = await page.locator('div.js-test-pattern-matches').textContent();
        // wait a bit before trying again
        await page.waitForTimeout(100);
        if (config.debug) {
            console.log(chalk.blue(`🔄 Waiting for test results... Current text: ${testSuccess}`));
            console.log(chalk.blue(`🔄 Tries: ${tries}`));
            console.log(chalk.blue(`🔄 Test data: ${pattern.test.data}`));
        }
        tries++;
        if (tries > config.maxTestTries) {
            console.warn(chalk.yellow(`⚠️  Pattern test is taking longer than expected...`));
            break;
        }
    }
    if (testSuccess?.includes(' - Finding matches..')) {
        // look for errors
        const errorExists = await page.locator('p.error').count() !== 0;
        if (errorExists) {
            const errorMessage = await page.locator('p.error').first().textContent();
            const fieldName = await page.locator('div.errored').first().locator('input').first().getAttribute('aria-label');
            console.error(chalk.red(`⨯ Error in field "${fieldName}": ${errorMessage}`));
            return false;
        }
    }
    if (!ignoreTestResult) {
        if (!testSuccess?.match(/\s*- \d+ match(?:es)?\s*$/)) {
            if (config?.debug) {
                const screenshotPath = path.join(process.cwd(), `debug-test_failed_screenshot_${Date.now()}.png`);
                // 50% zoom
                await page.evaluate(() => {
                    document.body.style.zoom = '50%';
                });
                // take a screenshot
                await page.screenshot({ path: screenshotPath });
                console.log(chalk.blue(`📸 Screenshot saved to: ${screenshotPath}`));
            }
            return false;
        }
        const matchCount = testSuccess.match(/\s*- (\d+) match(?:es)?\s*$/)?.[1] || '0';
        console.log(chalk.green(`✓ Pattern test passed with ${matchCount} match${matchCount === '1' ? '' : 'es'}`));
    }
    return true;
}
async function addAdditionalRule(page, rule, type, index, config) {
    if (config.debug) {
        // Take a screenshot if debugging
        // make screen quite big
        await page.setViewportSize({ width: 1920, height: 2000 });
        console.log(chalk.blue(`Taking screenshot of before state for post_processing_${index}`));
        const screenshotPath = path.join(process.cwd(), `debug-additional_rule_input_${index}_before_screenshot_${Date.now()}.png`);
        await page.screenshot({ path: screenshotPath });
        console.log(chalk.blue(`📸 Screenshot saved to: ${screenshotPath}`));
    }
    // Click add button to create new additional rule
    const addButton = page.locator('button.js-add-secret-format-button:text("Add requirement")');
    await addButton.click();
    // Small delay to wait for the element
    await page.waitForTimeout(200);
    // Wait for the new rule input to appear
    try {
        await page.waitForSelector(`input[name="post_processing_${index}"]`, { timeout: 5000 });
    }
    catch (err) {
        const error = err;
        console.error(chalk.red(`⨯ Error waiting for post_processing_${index} input: ${error.message}`));
        if (config.debug) {
            // Take a screenshot if debugging
            // make screen quite big
            await page.setViewportSize({ width: 1920, height: 2000 });
            console.log(chalk.blue(`Taking screenshot of error state for post_processing_${index}`));
            const screenshotPath = path.join(process.cwd(), `debug-additional_rule_input_${index}_error_screenshot_${Date.now()}.png`);
            await page.screenshot({ path: screenshotPath });
            console.log(chalk.blue(`📸 Screenshot saved to: ${screenshotPath}`));
        }
        return false;
    }
    // Fill in the rule
    const ruleInput = page.locator(`input[name="post_processing_${index}"]`);
    await ruleInput.fill(rule);
    // Select the appropriate radio button
    const ruleRadioButton = page.locator(`input[name="post_processing_rule_${index}"][value="${type}"]`);
    await ruleRadioButton.check();
    // Small delay to ensure the change is registered
    await page.waitForTimeout(200);
    if (config.debug) {
        // Take a screenshot if debugging
        // make screen quite big
        await page.setViewportSize({ width: 1920, height: 2000 });
        console.log(chalk.blue(`Taking screenshot of success state for post_processing_${index}`));
        const screenshotPath = path.join(process.cwd(), `debug-additional_rule_input_${index}_success_screenshot_${Date.now()}.png`);
        await page.screenshot({ path: screenshotPath });
        console.log(chalk.blue(`📸 Screenshot saved to: ${screenshotPath}`));
    }
    return true;
}
async function clickAndWaitForRedirect(page, button, config) {
    // Click the button and wait for navigation
    const [response] = await Promise.all([
        page.waitForResponse(response => response.url().includes('custom_patterns') && response.status() >= 300 && response.status() < 400),
        button.click()
    ]);
    try {
        // Check if the response indicates a redirect
        if (response.status() >= 300 && response.status() < 400) {
            const redirectUrl = response.headers()['location'];
            const success = await goto(page, redirectUrl, config);
            if (!success) {
                console.error(chalk.red(`⨯ Failed to navigate to redirect URL: ${redirectUrl}`));
                throw new Error(`Failed to navigate to redirect URL: ${redirectUrl}`);
            }
        }
        else {
            console.warn(chalk.yellow(`⚠️ Button click did not result in a redirect. Status: ${response.status()}`));
            console.log(response.status());
            // if we're debugging, take a screenshot
            if (config?.debug) {
                const screenshotPath = path.join(process.cwd(), `debug-button_click_not_redirected_screenshot_${Date.now()}.png`);
                await page.screenshot({ path: screenshotPath });
                console.log(chalk.blue(`📸 Screenshot saved to: ${screenshotPath}`));
            }
        }
        // Wait for the page to fully load after redirect
        await page.waitForLoadState('load');
    }
    catch (err) {
        const error = err;
        console.error(chalk.red(`✖ Error during page navigation: ${error.message}`));
        throw error;
    }
}
async function showDialog(page, dialogId) {
    const dialog = page.locator(`dialog#${dialogId}`);
    dialog.evaluate((el) => {
        if (!el.open) {
            el.showModal();
        }
    });
    // Wait for the dialog to appear
    await dialog.waitFor({ state: 'visible' });
    return dialog;
}
async function performDryRun(page, pattern, config, newPattern) {
    // Wait for the dry run button to be enabled
    // repo level class: js-save-and-dry-run-button or js-custom-pattern-submit-button if new
    // org level class: js-repo-selector-dialog-summary-button
    const nullResult = {
        id: '',
        name: pattern.name,
        hits: 0,
        results: [],
        completed: false
    };
    const selectorClass = config.scope === 'repo' ? (newPattern ? 'js-custom-pattern-submit-button' : 'js-save-and-dry-run-button') : 'js-repo-selector-dialog-summary-button';
    if ((await page.locator(`button.${selectorClass}`).count()) === 0) {
        console.warn(chalk.yellow(`⚠️ No dry run button found with class: ${selectorClass}`));
        if (config?.debug) {
            const screenshotPath = path.join(process.cwd(), `debug-no_dry_run_button_screenshot_${Date.now()}.png`);
            // big screen
            await page.setViewportSize({ width: 1920, height: 2000 });
            // take a screenshot
            await page.screenshot({ path: screenshotPath });
            console.log(chalk.blue(`📸 Screenshot saved to: ${screenshotPath}`));
        }
        return nullResult;
    }
    const dryRunButton = page.locator(`button.${selectorClass}`).first();
    let buttonID = null;
    try {
        buttonID = await dryRunButton.getAttribute('id');
        const enabled = await dryRunButton.isEnabled();
        if (!enabled) {
            console.warn(chalk.yellow('⚠️ Dry run button is not enabled'));
            if (config?.debug) {
                const screenshotPath = path.join(process.cwd(), `debug-dry_run_button_not_enabled_screenshot_${Date.now()}.png`);
                // big screen
                await page.setViewportSize({ width: 1920, height: 2000 });
                // take a screenshot
                await page.screenshot({ path: screenshotPath });
                console.log(chalk.blue(`📸 Screenshot saved to: ${screenshotPath}`));
            }
            return nullResult;
        }
    }
    catch (error) {
        console.warn(chalk.yellow(`⚠️ Error checking dry run button state: ${error}`));
        if (config?.debug) {
            const screenshotPath = path.join(process.cwd(), `debug-dry_run_button_state_error_screenshot_${Date.now()}.png`);
            // 50% zoom
            await page.evaluate(() => {
                document.body.style.zoom = '50%';
            });
            // take a screenshot
            await page.screenshot({ path: screenshotPath });
            console.log(chalk.blue(`📸 Screenshot saved to: ${screenshotPath}`));
        }
        return nullResult;
    }
    // if there's no button ID, we are at repo level. We can just click the button and start the dry-run
    if (!buttonID) {
        await clickAndWaitForRedirect(page, dryRunButton, config);
    }
    else {
        // if we are at org level, we need to handle a repo selector dialog. Do we do all repos in the org, or select a few?
        if (buttonID === 'dialog-show-repo-selector-dialog') {
            // Emulate clicking the button to open the repo selector dialog
            // Playwright struggles with this click, so we need to directly trigger the dialog
            // we need to change the dialog state to 'open', using the dialog 'repo-selector-dialog'
            // Wait for the dialog to appear
            const dialog = await showDialog(page, 'repo-selector-dialog');
            // Select all repositories if we're in org mode and dryRunAllRepos is true
            if (config?.dryRunAllRepos && config.scope === 'org') {
                const repoCheckboxes = dialog.locator('input[type="radio"][id="dry_run_repo_selection_all_repos"]');
                await repoCheckboxes.check();
            }
            else if (config?.dryRunRepoList && (config.scope === 'org' || config.scope === 'enterprise')) {
                // select the "Select specific repositories" option
                if (config.scope === 'org') {
                    const specificReposOption = dialog.locator('input[type="radio"][id="dry_run_repo_selection_selected_repos"]');
                    await specificReposOption.check();
                }
                // Select specific repositories
                for (let repo of config.dryRunRepoList) {
                    if (config.debug) {
                        console.log(chalk.blue(`Selecting repository for dry run: ${repo}`));
                    }
                    // if it has a `/` in it, we assume it's a full repository name like `org/repo`, and at the org level, split off just the repo name
                    if (config.scope === 'org' && repo.includes('/')) {
                        repo = repo.split('/', 2)[1];
                    }
                    // put them into the search field
                    const searchInput = dialog.locator('input#repo_id');
                    await searchInput.click();
                    await searchInput.fill(repo);
                    // Wait for the dropdown to update and be visible
                    const repoDropDown = dialog.locator(`anchored-position[anchor="repo_id"]`);
                    await repoDropDown.waitFor({ state: 'visible' });
                    const repoOptions = await repoDropDown.locator(`div[role="option"]`).all();
                    let found = false;
                    for (const option of repoOptions) {
                        const optionLabel = (await option.locator('span.ActionListItem-label').textContent())?.trim();
                        if (config.debug) {
                            console.log(chalk.gray(`Checking repository option: ${optionLabel}`));
                        }
                        if (optionLabel === repo) {
                            await option.click();
                            found = true;
                            console.log(chalk.blue(`Selected dry-run repository: ${repo}`));
                            break;
                        }
                    }
                    if (!found) {
                        console.warn(chalk.yellow(`Repository "${repo}" not found in the dry-run dropdown`));
                    }
                }
                // check if we have any selected repositories
                await dialog.locator('button[title="Remove dry run repository"]').first().waitFor({ state: 'visible' });
                const selectedRepos = await dialog.locator('div#dry-run-selected-repos > div > ul > li').all();
                if (selectedRepos.length === 0) {
                    console.warn(chalk.yellow('No repositories selected for dry run, please check your configuration'));
                    return nullResult;
                }
            }
            // Click the confirm button
            const confirmButton = dialog.locator('button.js-org-repo-selector-dialog-dry-run-button');
            await clickAndWaitForRedirect(page, confirmButton, config);
        }
        else {
            // error, exit
            console.error(chalk.red(`✖ Unexpected button ID: ${buttonID}`));
            return nullResult;
        }
    }
    // Extract pattern ID from the URL for tracking - split at / and pick final entry, then split at ? and pick first part
    const patternId = page.url().split('/').pop()?.split('?', 2)[0];
    if (!patternId || patternId.length === 0 || patternId === 'new') {
        console.error(chalk.red('✖ Failed to retrieve pattern ID from the URL'));
        throw new Error('Failed to retrieve pattern ID from the URL');
    }
    // Wait for dry run to complete with progress indicator
    let attempts = 0;
    process.stdout.write(chalk.yellow(`⏳ Waiting for dry run (pattern ${patternId})...`));
    while (true) {
        try {
            // Check the dry-run status - a span with class f6, and the text "Status" is the header, and the next sibling is the status
            const statusElement = page.locator('span.f6:has-text("Status") + h5');
            const statusText = await statusElement.textContent();
            if (statusText === 'Completed') {
                break;
            }
            else if (statusText === 'In progress' || statusText === 'Queued') {
                process.stdout.write('.');
            }
            else {
                process.stdout.write('\n');
                console.log(chalk.red(`✖ Dry run failed: ${statusText}`));
                break;
            }
        }
        catch (error) {
            if (config.debug) {
                console.log(chalk.gray(`\nDebug: Attempt ${attempts + 1}, error checking status: ${error}`));
            }
            process.stdout.write('.');
        }
        await page.waitForTimeout(5000); // Wait 5 seconds
        // TODO: back off a bit after some time, maybe a logistic curve? Grow exponentially at first, then slow down the growth
        const success = await reload(page, config);
        if (!success) {
            console.error(chalk.red(`✖ Failed to reload page during dry run`));
            return nullResult;
        }
        attempts++;
    }
    process.stdout.write('\n');
    if (config.debug) {
        console.log(chalk.blue(`ℹ Dry run completed after ${attempts} attempts`));
    }
    // Get dry run results
    const results = await getDryRunResults(page);
    console.log(chalk.green(`✓ Dry run completed with ${results.count} matches`));
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
            console.log(chalk.red('✖ No dry run results container found'));
            return { count: 0, results: [] };
        }
        // get count from the results container. Find the heading "Total matches" in a span, then get the next sibling element, an h5
        const countElement = resultsContainer.locator('span.f6:has-text("Total matches") + h5');
        const countText = await countElement.textContent();
        count = parseInt(countText ?? '0', 10);
        // If we didn't find a count, exit
        if (count === 0 || isNaN(count)) {
            return { count: 0, results: [] };
        }
        // loop over table results, until we have found enough results or exhausted the list
        let resultsProcessed = 0;
        while (true) {
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
            if (resultsProcessed >= count) {
                break;
            }
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
async function togglePushProtection(page, enable) {
    const pushProtectionToggle = page.locator('button[name="push_protection_enabled"]');
    const label = await pushProtectionToggle.locator('span.Button-label').first();
    const isEnabled = (await label.textContent())?.trim() === 'Disable';
    if (!isEnabled && enable || isEnabled && !enable) {
        await pushProtectionToggle.click();
        await page.waitForLoadState('load');
        console.log(chalk.green(`✓ Push protection ${enable ? 'enabled' : 'disabled'}`));
    }
    else {
        console.log(chalk.green(`✓ Push protection already ${enable ? 'enabled' : 'disabled'}`));
    }
}
async function togglePushProtectionConfig(page, pattern, config, enablePushProtectionFlag) {
    // visit the push protection configuration page
    const url = buildUrl(config, 'settings/security_analysis/pattern_configurations');
    let tableRow = undefined;
    while (true) {
        const success = await goto(page, url, config);
        if (!success) {
            console.error(chalk.red(`⨯ Failed to navigate to push protection configuration page: ${url}`));
            throw new Error(`Failed to navigate to push protection configuration page: ${url}`);
        }
        await page.waitForLoadState('load');
        // click on the "Custom" tab to show the custom patterns
        const tabNav = page.locator('nav[aria-label="Table selector"]');
        const customTab = tabNav.locator('span[data-content="Custom"]').first();
        await customTab.click();
        // search for the pattern with the search box, using the `name:"..."` syntax
        const inputSearchFilter = page.locator('input#pattern-configs-filter-input');
        await inputSearchFilter.click();
        await inputSearchFilter.fill(`name:"${pattern.name}"`);
        // wait for the results to filter down
        await page.waitForTimeout(200);
        // find the pattern in the list
        const tableRows = await page.locator('table > tbody > tr').all();
        for (const row of tableRows) {
            const nameCell = row.locator('td').first();
            const nameText = (await nameCell.textContent())?.trim();
            if (nameText === pattern.name) {
                tableRow = row;
                break;
            }
        }
        // if we didn't find the pattern, wait, try again, it might not be in the database yet
        if (!tableRow) {
            if (config.debug) {
                console.log(chalk.gray(`Debug: Pattern '${pattern.name}' not found in push protection configuration`));
            }
            await page.waitForTimeout(2000); // wait a bit before retrying
        }
        else {
            break;
        }
    }
    // find the push protection toggle in the row
    const pushProtectionToggle = tableRow.locator('button[data-testid="push-protection-setting"]').first();
    // get the current state of the toggle
    const currentState = (await pushProtectionToggle.textContent())?.trim();
    if ((enablePushProtectionFlag && currentState === 'Enabled') || (!enablePushProtectionFlag && currentState === 'Disabled')) {
        console.log(chalk.green(`✓ Push protection already ${currentState.toLowerCase()}`));
        return;
    }
    await pushProtectionToggle.click();
    const settingPopOver = await page.locator('div[role="none"][data-variant="anchored"]').first();
    // wait for the popover to appear
    await settingPopOver.waitFor({ state: 'visible' });
    if (enablePushProtectionFlag) {
        // press "e" to use the aria key shortcutd
        await settingPopOver.press('e');
        await settingPopOver.press('Enter');
    }
    else {
        // press "d" to disable push protection
        await settingPopOver.press('d');
        await settingPopOver.press('Enter');
    }
    // wait for the Apply changes button to be enabled, and click it
    const applyChangesButton = page.locator('button[type="button"]:has-text("Apply changes")').first();
    await applyChangesButton.click();
    console.log(chalk.green(`✓ Push protection ${enablePushProtectionFlag ? 'enabled' : 'disabled'}`));
}
async function displayDryRunResults(results) {
    if (results.count === 0) {
        console.log(chalk.green('\n✓ No results found - clean dry run'));
        return;
    }
    console.log(chalk.yellow(`\n⚠️  Found ${results.count} potential matches:`));
    // Create a table to display results
    const table = new Table({
        head: ['#', 'Repository location', 'Match', 'URL'],
    });
    // Show all results
    const displayResults = results.results;
    for (const [index, result] of displayResults.entries()) {
        table.push([
            (index + 1).toString(),
            result.repository_location || 'N/A',
            result.match || 'N/A',
            result.link || 'N/A'
        ]);
    }
    console.log(table.toString());
    console.log(chalk.blue('\n💡 Review these results to ensure they represent actual secrets, not false positives.'));
}
async function confirmPatternAction(pattern, dryRunResult, config) {
    if (dryRunResult.hits > config.dryRunThreshold) {
        console.log(chalk.red(`\n✖ Pattern exceeds dry run threshold (${dryRunResult.hits} > ${config.dryRunThreshold})`));
        const answer = await inquirer.prompt([{
                type: 'confirm',
                name: 'proceed',
                message: 'Do you want to proceed anyway?',
                default: false
            }]);
        if (!answer.proceed) {
            console.log(chalk.yellow(`⏭️  Skipping pattern publication`));
            return false;
        }
    }
    return true;
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
