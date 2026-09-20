// connectivity.js
// Detects whether the host has normal Internet access or whether the
// IIT(ISM) captive portal is intercepting requests.
//
// Verified behavior:
//   - GET http://example.com with redirect: "manual"
//   - Authenticated  -> status 200, no Location header
//   - IIT(ISM) portal -> 3xx with Location on netaccess.iitism.ac.in
//   - Other failures -> status not 200 / Location not on portal host

const PROBE_URL = "http://example.com";
const PORTAL_HOST = "netaccess.iitism.ac.in";

const FETCH_TIMEOUT_MS = 8000;

/**
 * Check current network / authentication state.
 *
 * @returns {Promise<{
 *   state: "online" | "captive" | "unreachable",
 *   captiveUrl?: string,
 *   error?: string
 * }>}
 */
async function checkConnection() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
        const response = await fetch(PROBE_URL, {
            redirect: "manual",
            signal: controller.signal,
            // Don't keep the connection warm too long
            cache: "no-store"
        });

        // Drain body so the socket can be released
        try { await response.text(); } catch (_) { /* ignore */ }

        const location = response.headers.get("location");

        // Normal Internet access
        if (response.status === 200 && !location) {
            return { state: "online" };
        }

        // IIT(ISM) captive portal redirect
        if (
            response.status >= 300 &&
            response.status < 400 &&
            location &&
            location.includes(PORTAL_HOST)
        ) {
            // NOTE: location may contain a temporary token. Do not log it.
            return {
                state: "captive",
                captiveUrl: location
            };
        }

        // Got a response but it's not what we expect
        return {
            state: "unreachable",
            error: `unexpected response: status=${response.status}, has-location=${Boolean(location)}`
        };

    } catch (error) {
        return {
            state: "unreachable",
            error: error && error.message ? error.message : String(error)
        };
    } finally {
        clearTimeout(timeout);
    }
}

module.exports = {
    checkConnection,
    PROBE_URL,
    PORTAL_HOST
};
