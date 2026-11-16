# Security Policy

## Supported Versions

We actively maintain and provide security updates for the latest Manifest V3 release of **CursorDemo**:

| Version | Supported |
| :--- | :--- |
| `1.4.x` (Current) | :white_check_mark: Supported |
| `< 1.4.0` | :x: Not Supported |

---

## Security & Isolation Architecture

CursorDemo is designed with strict local sandbox isolation:
- **Zero External Network Calls:** The extension makes no `fetch()` or `XMLHttpRequest` calls to external servers.
- **No Remote Code Execution:** All scripts (`background.js`, `content.js`, `record.js`, `editor.js`, `video-processor.js`, `zoom-analyzer.js`) are packaged locally inside the extension bundle under Manifest V3 Content Security Policy (`script-src 'self'; object-src 'self'`).
- **Local IndexedDB Storage:** Video blobs and cursor coordinates are stored strictly in browser-isolated `IndexedDB` (`CursorDemoVideoStorage`).

---

## Reporting a Vulnerability

If you discover a security vulnerability (such as cross-site scripting via DOM overlay injection, privilege escalation across extension messaging ports, or unintended data exposure), please report it responsibly:

1. **Do NOT open a public GitHub issue** for unpatched security vulnerabilities.
2. Use GitHub's **Private Vulnerability Reporting** tab at [https://github.com/cursordemo/cursordemo-screen-recorder/security/advisories/new](https://github.com/cursordemo/cursordemo-screen-recorder/security/advisories/new).
3. Include a clear reproduction steps description, affected Chrome/Chromium version, and proof-of-concept.
4. Maintainers will acknowledge your report within **48 hours** and publish a coordinated fix and advisory within **7 days**.
