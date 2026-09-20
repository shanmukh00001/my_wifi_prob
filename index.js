// index.js
// IIT(ISM) Wi-Fi re-authentication daemon.
//
// Usage:
//   node index.js                  Start the background monitor loop (~60s).
//   node index.js --check          One-shot connectivity check, then exit.
//   node index.js --login          One-shot login attempt, then exit.
//   node index.js --setup          Prompt for credentials and save them to
//                                  Windows Credential Manager.
//   node index.js --clear          Remove stored credentials.
//   node index.js --headless       Run monitor loop with Chrome headless.
//
// Environment variables:
//   WIFILOGI_INTERVAL_MS     Override default 60000ms check interval.
//   WIFILOGI_HEADLESS=1      Run monitor with headless Chrome (default: false).
//   WIFILOGI_VERBOSE=1       Print more verbose network diagnostic details.

const fs = require("fs");
const path = require("path");
const net = require("net");
const { checkConnection } = require("./connectivity");
const { performLogin } = require("./login");
const {
    loadCredentials,
    promptAndSave,
    clearCredentials
} = require("./credentials");

const DEFAULT_INTERVAL_MS = 60_000;
const MIN_INTERVAL_MS = 10_000;
const LOG_DIR = path.join(__dirname, "logs");
const LOG_FILE = path.join(LOG_DIR, "wifi-auto.log");
const MUTEX_PIPE_NAME = "\\\\.\\pipe\\wifilogi_auto_daemon_lock";

let mutexServer = null;

/**
 * Ensures only one monitor daemon instance runs at a time.
 * If another instance is already running, exits cleanly.
 */
function acquireSingleInstanceLock() {
    return new Promise((resolve) => {
        const server = net.createServer((socket) => {
            // If another process requests stopping this instance
            socket.on("data", (data) => {
                if (data.toString().trim() === "STOP") {
                    log("🛑 Stop command received. Shutting down daemon...");
                    process.exit(0);
                }
            });
        });

        server.once("error", (err) => {
            if (err.code === "EADDRINUSE" || err.code === "EACCES") {
                log("ℹ️ Another wifi_auto monitor instance is already running. Exiting duplicate process.");
                process.exit(0);
            } else {
                log("⚠️ Lock server error:", err.message);
                resolve();
            }
        });

        server.listen(MUTEX_PIPE_NAME, () => {
            mutexServer = server;
            resolve();
        });
    });
}

/**
 * Sends a STOP signal to any currently running background daemon.
 */
function sendStopSignal() {
    return new Promise((resolve) => {
        const client = net.connect(MUTEX_PIPE_NAME, () => {
            client.write("STOP\n");
            client.end();
            log("🛑 Sent stop signal to running daemon.");
            setTimeout(() => resolve(true), 500);
        });

        client.on("error", () => {
            // Daemon not running
            resolve(false);
        });
    });
}

// Ensure logs directory exists
function ensureLogDir() {
    try {
        if (!fs.existsSync(LOG_DIR)) {
            fs.mkdirSync(LOG_DIR, { recursive: true });
        }
    } catch (_) { /* ignore directory creation errors */ }
}

// ---------- CLI arguments & flags ----------
const argv = process.argv.slice(2);
const FLAGS = new Set(argv);

function isFlag(name) {
    return FLAGS.has(name);
}

// ---------- Timestamped console & file logging ----------
function log(...args) {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const ts = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
               `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    const message = args.join(" ");
    const line = `[${ts}] ${message}`;

    console.log(line);

    try {
        ensureLogDir();
        fs.appendFileSync(LOG_FILE, line + "\n", "utf8");
    } catch (_) {
        // Fail silently on disk write error so monitor keeps running
    }
}

function stateLabel(state) {
    if (state === "online")  return "✅ Internet active";
    if (state === "captive") return "🔐 IIT(ISM) login required";
    return "⚠️ Network unavailable";
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------- Subcommands ----------

// 1. One-shot connectivity check
async function runCheck() {
    const result = await checkConnection();
    log(stateLabel(result.state));
    if (result.state === "unreachable" && result.error && process.env.WIFILOGI_VERBOSE) {
        log("   detail:", result.error);
    }
    return result;
}

// 2. One-shot login attempt
async function runLogin() {
    const creds = await loadCredentials();
    if (!creds) {
        log("❌ No credentials stored in Windows Credential Manager.");
        log("   Run: node index.js --setup");
        return false;
    }

    const probe = await checkConnection();
    if (probe.state === "online") {
        log("✅ Internet active - already authenticated. No login needed.");
        return true;
    }

    if (probe.state !== "captive") {
        log("⚠️ Network unavailable and captive portal not detected. Skipping login.");
        return false;
    }

    log("🔐 IIT(ISM) login required");
    log("🔄 Attempting login...");

    const isHeadless = isFlag("--headless") || process.env.WIFILOGI_HEADLESS === "1";

    const result = await performLogin({
        username: creds.username,
        password: creds.password,
        startUrl: probe.captiveUrl,
        options: {
            headless: isHeadless
        }
    });

    if (result.success) {
        log("✅ Login successful");
        return true;
    }

    log("❌ Login failed:", result.reason || "unknown");
    if (result.detail && process.env.WIFILOGI_VERBOSE) {
        log("   detail:", result.detail);
    }
    return false;
}

// 3. Continuous background monitoring loop
async function runMonitor() {
    await acquireSingleInstanceLock();

    const creds = await loadCredentials();
    if (!creds) {
        log("❌ No credentials found in Windows Credential Manager.");
        log("   Please run: node index.js --setup");
        process.exit(1);
    }

    const isHeadless = isFlag("--headless") || process.env.WIFILOGI_HEADLESS === "1";
    let intervalMs = parseInt(process.env.WIFILOGI_INTERVAL_MS, 10) || DEFAULT_INTERVAL_MS;
    if (intervalMs < MIN_INTERVAL_MS) intervalMs = MIN_INTERVAL_MS;

    log("📡 Starting IIT(ISM) Wi-Fi re-authentication monitor");
    log(`   Interval: ${Math.round(intervalMs / 1000)}s | Headless: ${isHeadless} | User: ${creds.username}`);
    log("   Press Ctrl+C to stop.\n");

    let isLoggingIn = false;
    let consecutiveErrors = 0;

    // Graceful exit handler
    let shuttingDown = false;
    const shutdown = () => {
        if (shuttingDown) return;
        shuttingDown = true;
        log("🛑 Stopping monitor...");
        if (mutexServer) {
            try { mutexServer.close(); } catch (_) {}
        }
        process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    while (!shuttingDown) {
        try {
            const probe = await checkConnection();

            if (probe.state === "online") {
                log(stateLabel(probe.state));
                consecutiveErrors = 0;
            } else if (probe.state === "captive") {
                log(stateLabel(probe.state));

                if (!isLoggingIn) {
                    isLoggingIn = true;
                    log("🔄 Attempting login...");

                    try {
                        const result = await performLogin({
                            username: creds.username,
                            password: creds.password,
                            startUrl: probe.captiveUrl,
                            options: {
                                headless: isHeadless
                            }
                        });

                        if (result.success) {
                            log("✅ Login successful");
                            consecutiveErrors = 0;
                        } else {
                            log("❌ Login failed:", result.reason || "unknown");
                            consecutiveErrors++;
                        }
                    } finally {
                        isLoggingIn = false;
                    }
                }
            } else {
                // "unreachable" - no Wi-Fi/Ethernet or router down
                log("⚠️ Network unavailable");
                if (probe.error && process.env.WIFILOGI_VERBOSE) {
                    log("   detail:", probe.error);
                }
                consecutiveErrors++;
            }
        } catch (err) {
            log("⚠️ Unexpected monitor check error:", err.message);
            consecutiveErrors++;
        }

        // Apply backoff if consecutive errors occur to avoid hammering
        let sleepTime = intervalMs;
        if (consecutiveErrors >= 3) {
            sleepTime = Math.min(intervalMs * 2, 120_000);
        }

        await sleep(sleepTime);
    }
}

// ---------- Main Entry Point ----------
async function main() {
    if (isFlag("--setup")) {
        await promptAndSave();
        return;
    }

    if (isFlag("--clear")) {
        await clearCredentials();
        log("🗑️ Stored credentials cleared from Windows Credential Manager.");
        return;
    }

    if (isFlag("--check")) {
        await runCheck();
        return;
    }

    if (isFlag("--stop")) {
        const stopped = await sendStopSignal();
        if (stopped) {
            log("✅ Background daemon stopped.");
        } else {
            log("ℹ️ No background daemon was running.");
        }
        return;
    }

    if (isFlag("--login")) {
        const ok = await runLogin();
        process.exit(ok ? 0 : 1);
    }

    // Default: run the background monitor loop
    await runMonitor();
}

main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});
