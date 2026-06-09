const { chromium } = require('playwright');
const path = require('path');
const express = require('express');

// Start a local server to serve files since wasm fetch doesn't work with file://
const app = express();
app.use(express.static(__dirname));

const server = app.listen(0, async () => {
    const port = server.address().port;
    console.log(`Server listening on port ${port}`);

    const browser = await chromium.launch();
    const page = await browser.newPage();

    // Log browser console errors
    page.on('console', msg => {
        if (msg.type() === 'error') {
            console.error(`Browser console error: ${msg.text()}`);
        }
    });
    page.on('pageerror', err => {
        console.error(`Browser page error: ${err.message}`);
    });

    await page.goto(`http://localhost:${port}/index.html`);

    // Fill the input
    await page.fill('#numberInput', '98765432198765432101');
    await page.fill('#paramTrialLimit', '100');

    // Start the engine
    await page.click('#btnStart');

    // Check logs periodically
    for (let i = 0; i < 5; i++) {
      const logs = await page.locator('#consoleLog').innerText();
      console.log(`\n--- Logs at ${i} seconds ---\n${logs}`);
      const status = await page.locator('#engineStatusText').innerText();
      if (status === 'COMPLETED' || status === 'ABORTED') {
          break;
      }
      await page.waitForTimeout(1000);
    }

    await browser.close();
    server.close();
});
