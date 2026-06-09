from playwright.sync_api import sync_playwright
import time

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    page.goto('http://localhost:8080')

    # Wait for the UI to be ready
    page.wait_for_selector('#numberInput')

    # Enter a target number
    page.fill('#numberInput', '12345678901234567890')

    # Click START
    page.click('#btnStart')

    # Wait for the status to show COMPLETED
    print("Waiting for COMPLETED status...")
    page.wait_for_function('document.getElementById("engineStatusText").innerText.includes("COMPLETED")', timeout=60000)

    print("Test finished successfully!")
    browser.close()
