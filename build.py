"""Package app/ as an unsigned Tizen widget: dist/Kick-<version>.wgt.

The TV only installs packages signed with a certificate made for it, so sign while installing,
for example with `aerotizen --tv <tv-ip> install dist/Kick-<version>.wgt` or Tizen Studio.

Usage: python3 build.py
"""

import pathlib
import re
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent
APP = ROOT / "app"
SKIP = re.compile(r"(^|/)(\.|__pycache__/)|(^|/)(author-signature|signature\d*)\.xml$")


def main():
    version = re.search(r'<widget[^>]*\sversion="([^"]+)"', (APP / "config.xml").read_text()).group(1)
    out = ROOT / "dist" / ("Kick-%s.wgt" % version)
    out.parent.mkdir(exist_ok=True)
    files = sorted(p for p in APP.rglob("*") if p.is_file() and not SKIP.search(p.relative_to(APP).as_posix()))
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for p in files:
            z.write(p, p.relative_to(APP).as_posix())
    print("%s: %d files, %d KB" % (out.relative_to(ROOT), len(files), out.stat().st_size // 1024))


main()
