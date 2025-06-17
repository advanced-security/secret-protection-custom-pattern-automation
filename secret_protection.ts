const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch({ headless: false }); // Open a visible browser
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto('https://github.com/login');
    console.log('Please log in manually...');
    await page.waitForTimeout(30000); // Wait for user to log in

    await context.storageState({ path: 'auth.json' }); // Save authentication state
    console.log('Authentication state saved.');

    await browser.close();
})();