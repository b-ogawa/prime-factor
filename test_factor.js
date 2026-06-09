const { chromium } = require('playwright');
const path = require('path');
const express = require('express');

const app = express();
app.use(express.static(__dirname));

const server = app.listen(0, async () => {
    const port = server.address().port;
    console.log(`Server listening on port ${port}`);

    const browser = await chromium.launch();
    const page = await browser.newPage();

    page.on('console', msg => {
        if (msg.type() === 'error') {
            console.error(`Browser console error: ${msg.text()}`);
        }
    });
    page.on('pageerror', err => {
        console.error(`Browser page error: ${err.message}`);
    });

    await page.goto(`http://localhost:${port}/index.html`);

    // Composite test
    await page.fill('#numberInput', '12345678901234567890');
    await page.fill('#paramTrialLimit', '100');

    await page.click('#btnStart');

    for (let i = 0; i < 5; i++) {
      const logs = await page.locator('#consoleLog').innerText();
      const status = await page.locator('#engineStatusText').innerText();
      if (status === 'COMPLETED' || status === 'ABORTED') {
          break;
      }
      await page.waitForTimeout(1000);
    }

    try {
        console.log("Status:", await page.locator('#engineStatusText').innerText());
        const factors = await page.locator('#factorsContainer').innerText();
        console.log("Factors found:\n" + factors);

        if (factors.includes("No factors yet.")) {
            console.error("Test failed: No factors found.");
            process.exit(1);
        }
        console.log("Composite Test Passed.");
    } catch (e) {
        console.error("Test failed", e);
        process.exit(1);
    }

    await browser.close();
    server.close();
});
