# IIT(ISM) Wi-Fi Auto Login 🚀

A lightweight, reliable background daemon for Windows that monitors IIT(ISM) captive-portal connectivity, automatically detects session expirations, and securely re-authenticates in the background using Playwright and Windows Credential Manager.

---

## ⚡ Quick Start (1-Click Setup)

Open **PowerShell** in the project folder and run:

```powershell
.\install.ps1
```

This will automatically:
1. Install dependencies (`playwright`, `@napi-rs/keyring`).
2. Securely prompt and save your IIT(ISM) credentials into Windows Credential Manager.
3. Register a Windows Scheduled Task (`wifi_auto_login`) that **starts on boot/logon** and runs silently in the background.

---

## 🔒 Security Architecture

1. **Windows Credential Vault (DPAPI)**:
   - Credentials are stored inside Windows Credential Manager under service name `IIT-ISM-WiFiAutoLogin` via `@napi-rs/keyring`.
   - **Zero plaintext passwords** in code, environment variables, or files.
   - Safe to push this codebase to public repositories like GitHub without leaking credentials.

2. **In-Memory Temporary Tokens**:
   - The probe detects portal redirect tokens and passes them in memory to Playwright.
   - Tokens are **never** logged to disk or console.

---

## 📁 Project Structure

```
wifilogi_auto/
├── install.ps1         # 1-click Windows setup & task scheduler installer
├── uninstall.ps1       # 1-click uninstaller & credential cleanup
├── index.js            # CLI entry point, monitor loop, single-instance mutex
├── connectivity.js     # HTTP probe & captive portal detection
├── credentials.js      # Windows Credential Manager integration (DPAPI)
├── login.js            # Playwright browser automation (silent headless login)
├── logs/               # Runtime logs (gitignored)
├── package.json        # Dependencies & project metadata
└── README.md           # Documentation
```

---

## ⚙️ Manual CLI Usage

| Action | Command |
| :--- | :--- |
| **Check connection status** | `node index.js --check` |
| **Test manual login** | `node index.js --login` |
| **Setup/Update credentials** | `node index.js --setup` |
| **View live logs** | `Get-Content logs/wifi-auto.log -Tail 20 -Wait` |
| **Stop background daemon** | `node index.js --stop` |
| **Clear saved credentials** | `node index.js --clear` |
| **Uninstall background task** | `.\uninstall.ps1` |

---

## 🛠️ How It Works in the Background

* **Starts on Logon:** Windows Task Scheduler starts the daemon silently whenever you log in or open your laptop.
* **Continuous Monitoring:** Checks connection state every 60 seconds.
* **Instant Re-Authentication:** When network drops or the session expires, Playwright performs a headless login in ~5–10 seconds and verifies public internet connectivity.
* **Low Footprint:** Uses ~30MB RAM and 0% CPU while sleeping between checks.
