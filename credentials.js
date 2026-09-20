// credentials.js
// Secure credential storage using Windows Credential Manager.
//
// We use @napi-rs/keyring (a maintained, prebuilt-binary replacement for
// the archived keytar module). On Windows it talks to the OS Credential
// Vault via the Rust keyring-rs crate. No plaintext password lives in
// JavaScript source or in any committed file.

const SERVICE_NAME = "IIT-ISM-WiFiAutoLogin";
const USERNAME_ACCOUNT = "username";
const PASSWORD_ACCOUNT = "password";

let Entry;
try {
    ({ Entry } = require("@napi-rs/keyring"));
} catch (err) {
    Entry = null;
}

/**
 * Read both stored credentials. Returns null if not configured.
 * NEVER logs the password.
 */
async function loadCredentials() {
    if (!Entry) {
        throw new Error(
            "Optional dependency '@napi-rs/keyring' is not installed.\n" +
            "Run: npm install @napi-rs/keyring"
        );
    }

    const userEntry = new Entry(SERVICE_NAME, USERNAME_ACCOUNT);
    const passEntry = new Entry(SERVICE_NAME, PASSWORD_ACCOUNT);

    let username;
    let password;

    try {
        username = await Promise.resolve(userEntry.getPassword());
    } catch (_) {
        username = null;
    }
    try {
        password = await Promise.resolve(passEntry.getPassword());
    } catch (_) {
        password = null;
    }

    if (!username || !password) {
        return null;
    }
    return { username, password };
}

/**
 * Save / update credentials in Windows Credential Manager.
 */
async function saveCredentials(username, password) {
    if (!Entry) {
        throw new Error(
            "Optional dependency '@napi-rs/keyring' is not installed.\n" +
            "Run: npm install @napi-rs/keyring"
        );
    }
    if (!username || !password) {
        throw new Error("Username and password are required");
    }

    const userEntry = new Entry(SERVICE_NAME, USERNAME_ACCOUNT);
    const passEntry = new Entry(SERVICE_NAME, PASSWORD_ACCOUNT);

    await Promise.resolve(userEntry.setPassword(username));
    await Promise.resolve(passEntry.setPassword(password));
}

/**
 * Delete stored credentials.
 */
async function clearCredentials() {
    if (!Entry) return;

    const userEntry = new Entry(SERVICE_NAME, USERNAME_ACCOUNT);
    const passEntry = new Entry(SERVICE_NAME, PASSWORD_ACCOUNT);

    try { await Promise.resolve(userEntry.deletePassword()); } catch (_) { /* ignore */ }
    try { await Promise.resolve(passEntry.deletePassword()); } catch (_) { /* ignore */ }
}

/**
 * Prompt the user for credentials on the command line and save them.
 * Uses a custom prompt that disables echo for the password.
 */
async function promptAndSave() {
    const readline = require("readline/promises");
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    try {
        const username = (await rl.question("IIT(ISM) username: ")).trim();

        // Hide password input
        process.stdout.write("IIT(ISM) password: ");
        const password = await readHidden(rl);

        if (!username || !password) {
            console.log("Aborted: empty username or password.");
            return false;
        }

        await saveCredentials(username, password);
        console.log("✅ Credentials saved to Windows Credential Manager.");
        console.log("   Service:", SERVICE_NAME);
        return true;
    } finally {
        rl.close();
    }
}

// Cross-platform-ish hidden password input. On Windows we use the raw
// mode trick below; on other platforms we still try to suppress echo.
function readHidden(rl) {
    return new Promise((resolve, reject) => {
        let muted = false;
        const stdout = process.stdout;
        const stdin = process.stdin;

        const originalRaw = stdin.isRaw;
        if (stdin.isTTY) {
            stdin.setRawMode(true);
            muted = true;
        }
        let input = "";

        const onData = (ch) => {
            const s = ch.toString("utf8");
            switch (s) {
                case "\n":
                case "\r":
                case "\r\n":
                    if (muted) stdin.setRawMode(originalRaw);
                    stdin.removeListener("data", onData);
                    stdout.write("\n");
                    resolve(input);
                    break;
                case "\u0003": // Ctrl-C
                    if (muted) stdin.setRawMode(originalRaw);
                    stdin.removeListener("data", onData);
                    reject(new Error("interrupted"));
                    break;
                case "\u007f":
                case "\b":
                    if (input.length > 0) {
                        input = input.slice(0, -1);
                        if (muted) stdout.write("\b \b");
                    }
                    break;
                default:
                    input += s;
                    if (muted) stdout.write("*");
                    break;
            }
        };

        stdin.on("data", onData);
    });
}

module.exports = {
    SERVICE_NAME,
    loadCredentials,
    saveCredentials,
    clearCredentials,
    promptAndSave
};
