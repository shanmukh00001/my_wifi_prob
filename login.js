// login.js
// Performs the IIT(ISM) captive-portal login using Playwright + Chrome.
//
// The proven selectors (verified manually in the proof-of-concept) are used:
//   - input[name="username"]
//   - input[name="password"]
//   - button[type="submit"]
//
// Credentials are passed in as arguments from credentials.js, never read
// from disk or environment. The temporary captive-portal URL (which may
// contain a token) is passed in memory and never logged.

const { chromium } = require("playwright");
const { checkConnection } = require("./connectivity");

const PORTAL_HOST = "https://netaccess.iitism.ac.in:6082/";

const DEFAULT_OPTIONS = {
    headless: true,         // headless background Chrome avoids desktop window popups
    channel: "chrome",      // use real Google Chrome
    submitTimeoutMs: 15000, // wait up to 15s for navigation after submit
    postSubmitWaitMs: 8000, // extra grace period for the portal to settle
    verificationRetries: 2,
    verificationDelayMs: 3000
};

/**
 * Perform the login.
 *
 * @param {object} args
 * @param {string} args.username
 * @param {string} args.password      - never logged
 * @param {string} [args.startUrl]    - optional, the redirect URL from the
 *                                      detector (may contain a temp token).
 *                                      Used only as the initial navigation
 *                                      target; never persisted or logged.
 * @param {object} [args.options]
 * @returns {Promise<{success: boolean, reason?: string}>}
 */
async function performLogin({ username, password, startUrl, options }) {
    if (!username || !password) {
        return { success: false, reason: "missing-credentials" };
    }

    const opts = { ...DEFAULT_OPTIONS, ...(options || {}) };

    let browser;
    try {
        browser = await chromium.launch({
            headless: opts.headless,
            channel: opts.channel
        });
    } catch (err) {
        return {
            success: false,
            reason: "browser-launch-failed",
            detail: err && err.message ? err.message : String(err)
        };
    }

    const context = await browser.newContext({
        ignoreHTTPSErrors: true
    });
    const page = await context.newPage();

    try {
        console.log("🔐 Opening IIT(ISM) portal...");

        // Prefer the in-memory redirect URL (preserves any temp token) but
        // only if it points at the portal host. Otherwise fall back to the
        // canonical portal URL.
        const navUrl = isPortalUrl(startUrl) ? startUrl : PORTAL_HOST;

        await page.goto(navUrl, {
            waitUntil: "domcontentloaded",
            timeout: 30000
        });

        // Sanity: confirm we are actually on the login form before typing.
        // If the portal redirected us to a "success" page, return success.
        if (await isAlreadyAuthenticated(page)) {
            console.log("ℹ️ Portal reported already authenticated.");
        } else {
            const userInput = page.locator('input[name="username"], input[id="username"], #username').first();
            const passInput = page.locator('input[name="password"], input[id="password"], #password').first();
            const submitBtn = page.locator('button[type="submit"], input[type="submit"], button:has-text("Login"), input[value="Login"]').first();

            await userInput.fill(username);
            await passInput.fill(password);
            console.log("📝 Credentials filled");

            await Promise.all([
                page
                    .waitForLoadState("networkidle", { timeout: opts.submitTimeoutMs })
                    .catch(() => { /* portal may not reach networkidle */ }),
                submitBtn.click()
            ]);
            console.log("➡️ Login submitted");

            // Give the portal time to set up the session cookies.
            await page.waitForTimeout(opts.postSubmitWaitMs);
        }

    } catch (err) {
        await safeClose(browser);
        return {
            success: false,
            reason: "login-flow-failed",
            detail: err && err.message ? err.message : String(err)
        };
    }

    // Close the browser BEFORE verification so we don't keep Chrome open
    // for every check. We only keep it visible while the user is testing.
    if (opts.keepBrowserOpen) {
        // Intentionally do not close yet — for manual testing.
    } else {
        await safeClose(browser);
        browser = null;
    }

    // Verify authentication by probing the public Internet.
    const verifyResult = await verifyOnline(opts.verificationRetries, opts.verificationDelayMs);
    if (verifyResult.state === "online") {
        if (browser) await safeClose(browser);
        return { success: true };
    }

    if (browser) await safeClose(browser);
    return {
        success: false,
        reason: "post-login-verification-failed",
        verifyState: verifyResult.state
    };
}

async function verifyOnline(retries, delayMs) {
    let last;
    for (let i = 0; i <= retries; i++) {
        last = await checkConnection();
        if (last.state === "online") return last;
        if (i < retries) {
            await new Promise(r => setTimeout(r, delayMs));
        }
    }
    return last;
}

async function isAlreadyAuthenticated(page) {
    // Best-effort heuristic. The portal's "success" page typically does
    // not render the password input. We use absence as a signal.
    try {
        const count = await page.locator('input[name="password"]').count();
        return count === 0;
    } catch (_) {
        return false;
    }
}

function isPortalUrl(url) {
    if (!url || typeof url !== "string") return false;
    try {
        const u = new URL(url);
        return u.host.endsWith("netaccess.iitism.ac.in");
    } catch (_) {
        return false;
    }
}

async function safeClose(browser) {
    try { await browser.close(); } catch (_) { /* ignore */ }
}

module.exports = {
    performLogin,
    DEFAULT_OPTIONS
};
