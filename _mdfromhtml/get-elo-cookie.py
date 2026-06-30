#!/usr/bin/env python3
"""
get-elo-cookie.py — Open community.elo.com in a real browser, let you log in
manually, then capture the session cookies and write them to elo-auth.json so
html-to-md.mjs can download the streamed lesson videos.

Usage:
    python3 _mdfromhtml/get-elo-cookie.py

Flow:
    1. A Chromium window opens at the ELO course page (persistent profile, so
       a re-run remembers your login).
    2. You log in manually (SSO, password, 2FA — whatever applies).
    3. The script detects the post-login session cookie, confirms it against the
       course REST API, saves the cookies, and closes the browser.
"""

import json
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

SCRIPT_DIR = Path(__file__).resolve().parent
AUTH_FILE = SCRIPT_DIR / "elo-auth.json"
PROFILE_DIR = SCRIPT_DIR / ".pw-profile"   # persistent browser profile

START_URL = (
    "https://community.elo.com/community/plugin/de.elo.ix.plugin.proxy/wf/apps/"
    "app/sol.learning.apps.Courses/#/course/(1F77E8AA-0586-B459-6D82-7143D6739394)"
)

# Course REST endpoint. The ticket=…ticket_from_cookie tells ELO to authenticate
# using the session cookie, so a 200 here means we are logged in.
PROBE_URL = (
    "https://community.elo.com/community/plugin/de.elo.ix.plugin.rest/"
    "de.elo.sol.learning.wbt/course/(1F77E8AA-0586-B459-6D82-7143D6739394)/"
    "?lang=de&ticket=de.elo.ix.client.ticket_from_cookie"
)

LOGIN_TIMEOUT_S = 600   # 10 minutes to complete login
POLL_EVERY_S = 3


def elo_cookie_names(cookies):
    return {c["name"] for c in cookies if "elo.com" in c.get("domain", "")}


def main() -> int:
    PROFILE_DIR.mkdir(exist_ok=True)
    with sync_playwright() as p:
        print("→ Launching Chromium… log in when the window opens.", flush=True)
        context = p.chromium.launch_persistent_context(
            str(PROFILE_DIR), headless=False
        )
        page = context.pages[0] if context.pages else context.new_page()
        page.goto(START_URL, wait_until="domcontentloaded")

        # Baseline cookies after initial load (pre-login set).
        time.sleep(5)
        baseline = elo_cookie_names(context.cookies())
        print(f"→ Waiting for login (up to {LOGIN_TIMEOUT_S // 60} min)…", flush=True)

        deadline = time.time() + LOGIN_TIMEOUT_S
        authed = False
        while time.time() < deadline:
            try:
                # Primary signal: course REST API authenticates via cookie ticket.
                resp = context.request.get(PROBE_URL)
                if resp.status == 200:
                    print("→ Login confirmed via course REST API.", flush=True)
                    authed = True
                    break
                # Fallback signal: a new session cookie appeared after login.
                # The probe URL guess may be wrong, but the cookies are what the
                # video download actually needs — capture them and let the
                # download be the real test.
                if elo_cookie_names(context.cookies()) - baseline:
                    time.sleep(2)   # let the session finalize
                    print("→ New session cookie detected after login.", flush=True)
                    authed = True
                    break
            except Exception:
                pass
            time.sleep(POLL_EVERY_S)

        cookies = context.cookies()
        context.close()

    if not authed:
        print("✗ Timed out waiting for login. No cookie saved.", file=sys.stderr)
        return 1

    elo_cookies = [c for c in cookies if "elo.com" in c.get("domain", "")]
    if not elo_cookies:
        print("✗ No community.elo.com cookies found.", file=sys.stderr)
        return 1

    cookie_header = "; ".join(f"{c['name']}={c['value']}" for c in elo_cookies)
    AUTH_FILE.write_text(
        json.dumps({"cookie": cookie_header}, indent=2) + "\n", encoding="utf-8"
    )
    print(f"✓ Authenticated. Saved {len(elo_cookies)} cookie(s) to {AUTH_FILE}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
