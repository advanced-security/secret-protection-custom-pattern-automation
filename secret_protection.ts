import { chromium, BrowserContext, Page, Locator } from 'playwright';
import minimist from 'minimist';
import { promises as fs } from 'fs';
import * as yaml from 'js-yaml';
import * as path from 'path';
import chalk from 'chalk';
import Table from 'cli-table3';
import inquirer from 'inquirer';
import cliProgress from 'cli-progress';
import { PatternValidator } from './validator.js';
import { HELP_TEXT } from './cli.js';

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
    push_protection?: boolean;
    comments?: string[];
}

export interface PatternFile {
    name: string;
    patterns: Pattern[];
}

interface BrowserStorageState {
    cookies: Array<{
        name: string;
        value: string;
        domain: string;
        path: string;
        expires: number;
        httpOnly: boolean;
        secure: boolean;
        sameSite: "Strict" | "Lax" | "None";
    }>;
    origins: Array<{
        origin: string;
        localStorage: Array<{
            name: string;
            value: string;
        }>;
    }>;
}

interface DryRunMatch {
    match: string | undefined;
    repository_location: string | undefined;
    link: string | null;
}

interface DryRunResult {
    id: string;
    name: string;
    hits: number;
    results: DryRunMatch[];
    completed: boolean;
}

interface Config {
    server: string;
    target: string;
    scope: 'repo' | 'org' | 'enterprise';
    patterns?: string[];
    dryRunThreshold?: number;
    enablePushProtection?: boolean;
    noChangePushProtection?: boolean;
    disablePushProtection?: boolean;
    headless?: boolean;
    downloadExisting?: boolean;
    validate?: boolean;
    validateOnly?: boolean;
    debug?: boolean;
    dryRunAllRepos?: boolean;
    dryRunRepoList?: string[];
}

let state: BrowserStorageState | null = null;

export async function main() {
    const config = parseArgs();

    if (!config) {
        console.error(chalk.red('✖ Invalid configuration. Please check your command line arguments.'));
        console.log(HELP_TEXT);
        process.exit(1);
    }

    console.log(chalk.bold.blue(`🔐 Secret Scanning Custom Pattern Automation Tool`));
    console.log(chalk.gray(`Using server: ${config.server}`));
    console.log(chalk.gray(`Target: ${config.target}`));
    console.log(chalk.gray(`Scope: ${config.scope}\n`));

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
                validatePatterns(patternFile);
            } catch (error) {
                console.error(chalk.red(`✖ Validation failed for ${patternPath}:`), error);
                process.exit(1);
            }
        }

        console.log(chalk.green('\n✓ All pattern files passed validation'));
        process.exit(0);
    }

    try {
        await login(config.server);
    } catch (error) {
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

        if (config.patterns && config.patterns.length > 0) {
            await uploadPatterns(context, config);
        }
    } finally {
        browser.close();
    }
}

function parseArgs(): Config | undefined {
    const args = minimist(process.argv.slice(2));

    const target: string | undefined = args._.pop();

    // For validate-only mode, target can be a placeholder
    if (args['validate-only']) {
        console.log(chalk.yellow('ℹ️  Running validation-only mode without target specification'));
        return {
            server: 'https://github.com',
            target: 'validation-only',
            scope: 'repo',
            patterns: args.pattern ? (Array.isArray(args.pattern) ? args.pattern : [args.pattern]) : undefined,
            validateOnly: true,
            validate: true,
            dryRunAllRepos: true,
        };
    }

    if (!target) {
        console.error(chalk.red('✖ Please provide a target repository, organization, or enterprise.'));
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
        console.error(chalk.red(`✖ Invalid scope: ${scope}. Valid scopes are: ${validScopes.join(', ')}`));
        process.exit(1);
    }

    const config = {
        server: args.server ?? process.env.GITHUB_SERVER ?? 'https://github.com',
        target,
        scope,
        patterns: args.pattern ? (Array.isArray(args.pattern) ? args.pattern : [args.pattern]) : undefined,
        dryRunThreshold: process.env.DRY_RUN_THRESHOLD ? parseInt(process.env.DRY_RUN_THRESHOLD, 10) : 50,
        enablePushProtection: args['enable-push-protection'] ?? false,
        noChangePushProtection: args['no-change-push-protection'] ?? false,
        disablePushProtection: args['disable-push-protection'] ?? false,
        headless: args.headless ?? true,
        downloadExisting: args['download-existing'] ?? false,
        validateOnly: args['validate-only'] ?? false,
        validate: args.validate ?? true,
        debug: args.debug ?? false,
        dryRunAllRepos: args['dry-run-all-repos'] ?? false,
        dryRunRepoList: args['dry-run-repo-list'] ? (Array.isArray(args['dry-run-repo-list']) ? args['dry-run-repo-list'] : [args['dry-run-repo-list']]) : [],
    };

    if ((!config.patterns || config.patterns.length === 0) && !config.downloadExisting) {
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

    return config;
}

async function login(server: string) {
    // look for existing state stored in .state file locally
    const stateFilePath = path.join(process.cwd(), '.state');
    try {
        state = JSON.parse(await fs.readFile(stateFilePath, 'utf-8'));
        console.log(chalk.gray('🔑 Using existing authentication from .state file'));
        return;
    } catch {
        console.log(chalk.blue('🔑 No existing authentication found, doing browser login'));
    }

    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();

    // Wait for user to log in
    await page.goto(`${server}/login`);
    console.log(chalk.blue(`🖥️ Please log in manually to GitHub on ${server}`));

    console.log(chalk.blue('⌨ Waiting for manual login... Press Enter once logged in'));
    // Wait for user input
    await new Promise<void>((resolve) => {
        process.stdin.once('data', () => resolve());
    });

    // Save browser state
    state = await context.storageState();

    await fs.writeFile(stateFilePath, JSON.stringify(state, null, 2));

    console.log(chalk.green('✓ Login successful, state saved'));
    await browser.close();
}

async function downloadExistingPatterns(context: BrowserContext, config: Config): Promise<void> {
    console.log('Downloading existing patterns...');
    const page = await context.newPage();

    try {
        const url_path = config.scope !== 'enterprise' ? 'settings/security_analysis' : 'settings/security_analysis_policies/security_features';
        const url = buildUrl(config, url_path);

        const result = await page.goto(url);

        if (!result || !result.ok()) {
            console.error(`Failed to load page: ${result?.status() || 'unknown error'}`);
            return;
        }

        let keepGoing = true;
        const extractedPatterns: Pattern[] = [];
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
                progressBarSimple.setTotal(count);
                progressBarSimple.update(0);
            }

            const patternRows = await customPatternList.locator('li[class="Box-row"]').all();

            if (!patternRows || patternRows.length === 0) {
                console.warn(chalk.yellow('No existing patterns found'));
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

                    if (patternName !== name) {
                        console.warn(chalk.yellow(`⚠️ Pattern name mismatch: expected "${name}", found "${patternName}"`));
                    }

                    // record if it is published or not
                    const subHead = await patternPage.locator('h1.Subhead-heading').textContent();
                    const isPublished = subHead?.includes('Update pattern');

                    // pull out additional matches, and if they are Must match or Must not Match
                    const additionalMatchRules: Map<string, Array<string>> = new Map();

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
                    const pattern: Pattern = {
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
            } else {
                keepGoing = false;
            }
        }

        progressBar.stop();

        // Create PatternFile structure matching the import format
        const patternFile: PatternFile = {
            name: `Downloaded patterns from ${config.target}`,
            patterns: extractedPatterns
        };

        // Save patterns to file
        const outputPath = path.join(process.cwd(), 'existing-patterns.yml');
        await fs.writeFile(outputPath, yaml.dump(patternFile));
        console.log(chalk.blue(`⬇️  Saved to: ${outputPath}`));

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
        } catch (err) {
            const error = err as Error;
            console.error(chalk.red(`✖ Failed to fully process pattern file ${patternPath}:`, error.message));
        }
    }
}

async function loadPatternFile(filePath: string): Promise<PatternFile> {
    const content = await fs.readFile(filePath, 'utf-8');

    try {
        return yaml.load(content) as PatternFile;
    } catch {
        try {
            return JSON.parse(content) as PatternFile;
        } catch (jsonError) {
            throw new Error(`Failed to parse file as YAML or JSON: ${jsonError}`);
        }
    }
}

function validatePatterns(patternFile: PatternFile): void {
    const fileResult = PatternValidator.validatePatternFile(patternFile);

    if (fileResult.isValid) {
        console.log(chalk.green('✔ All patterns passed validation'));
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
}

async function expandMoreOptions(page: Page): Promise<void> {
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

function comparePatterns(patternA: string | undefined, patternB: string | undefined): boolean {
    return patternA?.trim() === patternB?.trim();
}

async function fillInPattern(page: Page, pattern: Pattern, isExisting: boolean = false, _config: Config): Promise<boolean> {

    // If this is an existing pattern, clear the fields first, if they are different to what we are uploading
    if (isExisting) {
        let changed: Boolean = false;

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
            } else {
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
                } else {
                    changed = true;
                }

                for (const removeButton of removeExistingAdditionalMatches) {
                    if (await removeButton.isVisible() && await removeButton.isEnabled()) {
                        await removeButton.click();
                    }
                }
            }
        } catch (error) {
            console.log(chalk.gray(`Note: Could not clear all existing additional rules: ${error}`));
        }

        if (!changed) {
            console.log(chalk.yellow(`⏩ No changes detected against existing pattern, skipping submission`));
            return false;
        }

    } else {
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

    if (pattern.regex.additional_match && pattern.regex.additional_match.length > 0) {
        for (const [index, rule] of pattern.regex.additional_match.entries()) {
            await addAdditionalRule(page, rule, 'must_match', index);
        }
    }

    if (pattern.regex.additional_not_match && pattern.regex.additional_not_match.length > 0) {
        for (const [index, rule] of pattern.regex.additional_not_match.entries()) {
            const offset = pattern.regex.additional_match?.length || 0;
            await addAdditionalRule(page, rule, 'must_not_match', index + offset);
        }
    }

    console.log(chalk.green(`✓ Pattern information filled successfully`));

    return true;
}

// TODO: cache the names we have already seen, so we don't have to keep checking - and store any newly created name/id pairs as we go, too
async function findExistingPatternByName(context: BrowserContext, config: Config, patternName: string): Promise<string | null> {
    const page = await context.newPage();

    try {
        const url_path = config.scope !== 'enterprise' ? 'settings/security_analysis' : 'settings/security_analysis_policies/security_features';
        const url = buildUrl(config, url_path);
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
            } else {
                keepGoing = false;
            }
        }

        return null;

    } catch (error) {
        console.warn(`Error checking for existing patterns: ${error}`);
        return null;
    } finally {
        await page.close();
    }
}

// TODO: catch errors/warnings after each step and log them, or stop on error
async function processPattern(context: BrowserContext, config: Config, pattern: Pattern): Promise<void> {
    console.log(chalk.bold(`\n🔄 Processing pattern: ${pattern.name}`));

    const page = await context.newPage();

    try {
        // Look at existing patterns to see if one matches this pattern name
        const existingPatternUrl = await findExistingPatternByName(context, config, pattern.name);

        let url: string;
        if (existingPatternUrl) {
            url = `${config.server}${existingPatternUrl}`;
        } else {
            const url_path = config.scope !== 'enterprise' ? 'settings/security_analysis/custom_patterns/new' : 'settings/advanced_security/custom_patterns/new';
            url = buildUrl(config, url_path);
        }

        // Navigate to pattern page (new or existing)
        await page.goto(url);
        await page.waitForLoadState('load');

        const needToSubmit = await fillInPattern(page, pattern, !!existingPatternUrl, config);

        if (needToSubmit) {
            // Test the pattern
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
                message: `Do you want to enable push protection for pattern "${pattern.name}"?`,
                default: false
            });
            enablePushProtectionFlag = enablePushProtection;
        }

        if (config.scope === 'repo') {
            await togglePushProtection(page, enablePushProtectionFlag);
        } else {
            if (enablePushProtectionFlag) {
                console.log(chalk.blue(`🛡️  Enabling push protection for pattern: ${pattern.name}`));
                await togglePushProtectionConfig(page, pattern, config, enablePushProtectionFlag);
            }
        }

        const actionPast = existingPatternUrl ? 'updated' : 'created';
        console.log(chalk.green(`✓ Successfully ${actionPast} pattern: ${pattern.name}`));

    } catch (error) {
        console.error(chalk.red(`✖ Failed to process pattern "${pattern.name}":`, error));
        throw error;
    } finally {
        await page.close();
    }
}

async function testPattern(page: Page, pattern: Pattern): Promise<void> {
    const ignoreTestResult = pattern.test?.data === undefined || pattern.test.data.trim() === '';

    // Add test data
    if (!pattern.test?.data) {
        console.warn(chalk.yellow(`⚠️  No test data found for pattern: ${pattern.name}`));
        // test with a single space, so we can dry-run the pattern
        pattern.test = {
            data: ' '
        };
    }

    await page.fill('div.CodeMirror-code', pattern.test.data);

    let waiting = true;
    let testSuccess: string | null = null;

    // Check for test results
    // TODO: use a more robust way to check for test results, including the offsets of the result(s)
    // this might require doing a specific request using secrets derived from the page
    while (waiting) {
        testSuccess = await page.locator('div.js-test-pattern-matches').textContent();

        if (!testSuccess?.match(/ match$/) && !testSuccess?.includes(' - No matches')) {
            continue;
        };

        waiting = false;
    }

    if (!ignoreTestResult) {
        if (testSuccess?.includes('No matches')) {
            console.warn(chalk.red(`✖ Pattern test failed for: ${pattern.name}`));
            throw new Error(`Pattern test failed for: ${pattern.name}`);
        }

        console.log(chalk.green(`✓ Pattern test passed: ${pattern.name}`));
    }
}

async function addAdditionalRule(page: Page, rule: string, type: 'must_match' | 'must_not_match', index: number): Promise<void> {
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

async function clickAndWaitForRedirect(page: Page, button: Locator, config: Config): Promise<void> {
    // Click the button and wait for navigation
    const [response] = await Promise.all([
        page.waitForResponse(response => response.url().includes('custom_patterns') && response.status() >= 300 && response.status() < 400),
        button.click()
    ]);

    try {
        // Check if the response indicates a redirect
        if (response.status() >= 300 && response.status() < 400) {
            const redirectUrl = response.headers()['location'];
            await page.goto(redirectUrl);
        } else {
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
    } catch (err) {
        const error = err as Error;
        console.error(chalk.red(`✖ Error during page navigation: ${error.message}`));
        throw error;
    }
}

async function performDryRun(page: Page, pattern: Pattern, config: Config): Promise<DryRunResult> {
    console.log(chalk.yellow(`🧪 Starting dry run for pattern: ${pattern.name}`));

    // Wait for the dry run button to be enabled
    // repo level class: js-custom-pattern-submit-button
    // org level class: js-repo-selector-dialog-summary-button
    const dryRunButton = page.locator('button.js-custom-pattern-submit-button, button.js-save-and-dry-run-button, button.js-repo-selector-dialog-summary-button').first();
    await dryRunButton.waitFor({ state: 'visible' });
    const buttonID = await dryRunButton.getAttribute('id');

    while (!await dryRunButton.isEnabled()) {
        await page.waitForTimeout(100);
    }

    // if there's no button ID, we are at repo level. We can just click the button and start the dry-run
    if (!buttonID) {
        await clickAndWaitForRedirect(page, dryRunButton, config);
    } else {
        // if we are at org level, we need to handle a repo selector dialog. Do we do all repos in the org, or select a few?
        if (buttonID === 'dialog-show-repo-selector-dialog') {
            // Emulate clicking the button to open the repo selector dialog
            // Playwright struggles with this click, so we need to directly trigger the dialog
            // we need to change the dialog state to 'open', using the dialog 'repo-selector-dialog'
            const dialog = page.locator('dialog#repo-selector-dialog');
            dialog.evaluate((el: HTMLDialogElement) => {
                if (!el.open) {
                    el.showModal();
                }
            });

            // Wait for the dialog to appear
            await dialog.waitFor({ state: 'visible' });

            // Select all repositories if we're in org mode and dryRunAllRepos is true
            if (config?.dryRunAllRepos && config.scope === 'org') {
                const repoCheckboxes = dialog.locator('input[type="radio"][id="dry_run_repo_selection_all_repos"]');
                await repoCheckboxes.check();
            } else if (config?.dryRunRepoList && (config.scope === 'org' || config.scope === 'enterprise')) {

                // select the "Select specific repositories" option
                if (config.scope === 'org') {
                    const specificReposOption = dialog.locator('input[type="radio"][id="dry_run_repo_selection_selected_repos"]');
                    await specificReposOption.check();
                }

                // Select specific repositories
                for (let repo of config.dryRunRepoList) {
                    console.log(chalk.blue(`Selecting repository for dry run: ${repo}`));

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
                        console.log(chalk.gray(`Checking repository option: ${optionLabel}`));
                        if (optionLabel === repo) {
                            await option.click();
                            found = true;
                            console.log(chalk.blue(`Selected repository: ${repo}`));
                            break;
                        }
                    }
                    if (!found) {
                        console.warn(chalk.yellow(`Repository "${repo}" not found in the dropdown`));
                    }
                }

                // check if we have any selected repositories
                await dialog.locator('button[title="Remove dry run repository"]').first().waitFor({ state: 'visible' });

                const selectedRepos = await dialog.locator('div#dry-run-selected-repos > div > ul > li').all();
                if (selectedRepos.length === 0) {
                    console.warn(chalk.yellow('No repositories selected for dry run, please check your configuration'));
                    return {
                        id: '',
                        name: pattern.name,
                        hits: 0,
                        results: [],
                        completed: false
                    };
                }
            }

            // Click the confirm button
            const confirmButton = dialog.locator('button.js-org-repo-selector-dialog-dry-run-button');

            await clickAndWaitForRedirect(page, confirmButton, config);
        } else {
            // error, exit
            console.error(chalk.red(`✖ Unexpected button ID: ${buttonID}`));
            return {
                id: '',
                name: pattern.name,
                hits: 0,
                results: [],
                completed: false
            };
        }
    }

    // Extract pattern ID from the URL for tracking - split at / and pick final entry, then split at ? and pick first part
    const patternId = page.url().split('/').pop()?.split('?', 2)[0];
    console.log(chalk.blue(`Pattern ID: ${patternId}`));

    if (!patternId || patternId.length === 0 || patternId === 'new') {
        console.error(chalk.red('✖ Failed to retrieve pattern ID from the URL'));
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

            if (statusText === 'Completed') {
                process.stdout.write('\n');
                console.log(chalk.green('✓ Dry run completed successfully'));
                break;
            } else if (statusText === 'In progress' || statusText === 'Queued') {
                process.stdout.write('.');
            } else {
                process.stdout.write('\n');
                console.log(chalk.red(`✖ Dry run failed: ${statusText}`));
                break;
            }
        } catch (error) {
            if (config.debug) {
                console.log(chalk.gray(`\nDebug: Attempt ${attempts + 1}, error checking status: ${error}`));
            }
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

async function getDryRunResults(page: Page): Promise<{ count: number; results: DryRunMatch[] }> {
    const results: DryRunMatch[] = [];
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

    } catch (error) {
        console.log(chalk.yellow(`Warning: Error extracting dry run results: ${error}`));
    }

    return { count, results };
}

async function publishPattern(page: Page): Promise<void> {
    // Click publish button
    await page.click('button.js-custom-pattern-submit-button');

    // TODO: Check for success message
}

async function togglePushProtection(page: Page, enable: boolean | undefined): Promise<void> {
    const pushProtectionToggle = page.locator('button[name="push_protection_enabled"]');

    if (await pushProtectionToggle.isVisible()) {
        const label = await pushProtectionToggle.locator('span.Button-label').first();

        const isEnabled = (await label.textContent())?.trim() === 'Disable';

        if (!isEnabled && enable || isEnabled && !enable) {
            await pushProtectionToggle.click();
            await page.waitForLoadState('load');
            console.log(chalk.green(`✓ Push protection ${enable ? 'enabled' : 'disabled'}`));
        } else {
            console.log(chalk.green(`✓ Push protection already ${enable ? 'enabled' : 'disabled'}`));
        }
    } else {
        console.warn(chalk.yellow(`⚠️ Push protection toggle not found`));
    }
}

async function togglePushProtectionConfig(page: Page, pattern: Pattern, config: Config, enablePushProtectionFlag: boolean): Promise<void> {
    // visit the push protection configuration page
    const url = buildUrl(config, 'settings/security_analysis/pattern_configurations');
    await page.goto(url);

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

    let tableRow = undefined;

    for (const row of tableRows) {
        const nameCell = row.locator('td').first();
        const nameText = (await nameCell.textContent())?.trim();

        if (nameText === pattern.name) {
            tableRow = row;
            break;
        }
    }

    // if we didn't find the pattern, exit
    if (!tableRow) {
        console.warn(chalk.yellow(`⚠️ Pattern "${pattern.name}" not found in push protection configuration`));
        return;
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
    } else {
        // press "d" to disable push protection
        await settingPopOver.press('d');
        await settingPopOver.press('Enter');
    }

    // wait for the Apply changes button to be enabled, and click it
    const applyChangesButton = page.locator('button[type="button"]:has-text("Apply changes")').first();
    await applyChangesButton.click();

    console.log(chalk.green(`✓ Push protection ${enablePushProtectionFlag ? 'enabled' : 'disabled'}`));
}

async function displayDryRunResults(results: { count: number; results: DryRunMatch[] }): Promise<void> {
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

async function confirmPatternAction(pattern: Pattern, dryRunResult: DryRunResult, config: Config): Promise<boolean> {
    if (config.dryRunThreshold && dryRunResult.hits > config.dryRunThreshold) {
        console.log(chalk.red(`\n✖ Pattern "${pattern.name}" exceeds dry run threshold (${dryRunResult.hits} > ${config.dryRunThreshold})`));

        const answer = await inquirer.prompt([{
            type: 'confirm',
            name: 'proceed',
            message: 'Do you want to proceed anyway?',
            default: false
        }]);

        if (!answer.proceed) {
            console.log(chalk.yellow(`⏭️  Skipping pattern "${pattern.name}" due to dry run threshold`));
            return false;
        }
    }

    return true;
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
