#!/usr/bin/env python3
"""Self-check for the learning-site: static structure + headless-Chrome screenshots.

Checks every page for the WU-1 acceptance items:
  * file exists and is non-empty
  * complete HTML structure (doctype, html lang, title, viewport, inline <style>)
  * the unified navigation on every page
  * no broken relative links and no unexplained TODO/FIXME markers
  * no external stylesheet/script/image dependencies (the site must open from file://)

Screenshots are captured with headless Google Chrome at 1280x800. The report is
written to .shot/report.md and .shot/report.json. Exit code is 1 when any
blocker or error is found, 0 otherwise.

Usage:
    python3 learning-site/shot.py [--site DIR] [--out DIR] [--chrome PATH]
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import struct
import subprocess
import sys
import tempfile
import time
from dataclasses import asdict, dataclass, field
from html.parser import HTMLParser
from pathlib import Path


PAGES = [
    ("index.html", "首页"),
    ("concept.html", "概念(A论文)"),
    ("evolution.html", "进化(B论文)"),
    ("feynman.html", "费曼拆解"),
    ("test-log.html", "测试日志"),
    ("prototype.html", "原型"),
    ("experiment.html", "实验"),
]
NAV_LABELS = [label for _, label in PAGES]
VIEWPORT = (1280, 800)
SKIP_PREFIXES = ("http://", "https://", "mailto:", "tel:", "data:", "javascript:")
TODO_RE = re.compile(r"\b(TODO|FIXME|XXX)\b")


@dataclass
class Finding:
    severity: str  # blocker | error | warn
    page: str
    rule: str
    detail: str


@dataclass
class PageReport:
    page: str
    title: str = ""
    checks: dict[str, str] = field(default_factory=dict)
    screenshot: str = ""


class Probe(HTMLParser):
    """Collect the handful of facts the checks need."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.title = ""
        self.viewport = ""
        self.html_lang = ""
        self.style_chunks: list[str] = []
        self.nav_links: list[tuple[str, str]] = []
        self.nav_current: list[str] = []
        self.hrefs: list[str] = []
        self.ids: set[str] = set()
        self.external_assets: list[str] = []
        self.script_srcs: list[str] = []
        self._in_title = False
        self._in_style = False
        self._in_nav = 0
        self._in_nav_link = False
        self._nav_current = ""
        self._nav_text: list[str] = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "html":
            self.html_lang = attrs.get("lang", "")
        elif tag == "title":
            self._in_title = True
        elif tag == "style":
            self._in_style = True
        elif tag == "meta" and attrs.get("name") == "viewport":
            self.viewport = attrs.get("content", "")
        elif tag == "nav":
            self._in_nav += 1
        elif tag == "a":
            href = attrs.get("href", "")
            if href:
                self.hrefs.append(href)
            if self._in_nav:
                self._in_nav_link = True
                self._nav_current = attrs.get("aria-current", "")
                self._nav_text = []
        elif tag == "link":
            href = attrs.get("href", "")
            if attrs.get("rel", "").lower() == "stylesheet" and href.startswith(SKIP_PREFIXES):
                self.external_assets.append(f"link {href}")
        elif tag == "script":
            src = attrs.get("src", "")
            if src:
                self.script_srcs.append(src)
                if src.startswith(SKIP_PREFIXES):
                    self.external_assets.append(f"script {src}")
        elif tag == "img":
            src = attrs.get("src", "")
            if src.startswith(SKIP_PREFIXES):
                self.external_assets.append(f"img {src}")
        if "id" in attrs:
            self.ids.add(attrs["id"])

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False
        elif tag == "style":
            self._in_style = False
        elif tag == "nav" and self._in_nav:
            self._in_nav -= 1
        elif tag == "a" and self._in_nav_link:
            text = " ".join("".join(self._nav_text).split())
            href = self.hrefs[-1] if self.hrefs else ""
            self.nav_links.append((href, text))
            self.nav_current.append(self._nav_current)
            self._in_nav_link = False
            self._nav_current = ""
            self._nav_text = []

    def handle_data(self, data):
        if self._in_title:
            self.title += data
        elif self._in_style:
            self.style_chunks.append(data)
        elif self._in_nav_link:
            self._nav_text.append(data)


def find_chrome(explicit: str | None) -> str | None:
    candidates = [
        explicit,
        os.environ.get("CHROME"),
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ]
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return candidate
    return None


def png_size(path: Path) -> tuple[int, int] | None:
    try:
        data = path.read_bytes()[:24]
    except OSError:
        return None
    if len(data) < 24 or data[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    width, height = struct.unpack(">II", data[16:24])
    return width, height


def shoot(chrome: str, page: Path, out: Path) -> tuple[bool, str]:
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.exists():
        out.unlink()
    with tempfile.TemporaryDirectory(prefix="learning-site-shot-") as profile:
        cmd = [
            chrome,
            "--headless=new",
            "--disable-gpu",
            "--hide-scrollbars",
            "--force-device-scale-factor=1",
            f"--window-size={VIEWPORT[0]},{VIEWPORT[1]}",
            "--virtual-time-budget=1500",
            "--no-first-run",
            "--no-default-browser-check",
            f"--user-data-dir={profile}",
            f"--screenshot={out}",
            page.as_uri(),
        ]
        # A file, not a pipe: Chrome helpers inherit the descriptor, so reading a
        # pipe here would block until they all exit.
        stderr_file = tempfile.TemporaryFile(mode="w+")
        try:
            proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=stderr_file)
        except OSError as exc:
            stderr_file.close()
            return False, f"cannot run Chrome: {exc}"
        # Chrome can finish the screenshot and then hang for tens of seconds in
        # teardown on macOS; stop as soon as the PNG has been written.
        deadline = time.time() + 90
        while time.time() < deadline:
            if out.is_file() and out.stat().st_size > 1024:
                time.sleep(0.4)
                if out.is_file() and out.stat().st_size > 1024:
                    break
            if proc.poll() is not None:
                break
            time.sleep(0.25)
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()
        stderr = ""
        try:
            stderr_file.seek(0)
            stderr = stderr_file.read()
        except OSError:
            pass
        finally:
            stderr_file.close()
    if not out.is_file():
        tail = stderr.strip().splitlines()[-3:]
        return False, "no screenshot produced" + (f" ({' | '.join(tail)})" if tail else "")
    size = png_size(out)
    if size is None:
        return False, "screenshot is not a valid PNG"
    if size != VIEWPORT:
        return False, f"screenshot size {size[0]}x{size[1]}, expected {VIEWPORT[0]}x{VIEWPORT[1]}"
    return True, "ok"


def check_page(site: Path, filename: str, label: str) -> tuple[PageReport, list[Finding]]:
    report = PageReport(page=filename)
    findings: list[Finding] = []

    def fail(severity: str, rule: str, detail: str) -> None:
        findings.append(Finding(severity, filename, rule, detail))

    path = site / filename
    if not path.is_file():
        fail("blocker", "file", "file does not exist")
        report.checks["file"] = "fail"
        return report, findings
    text = path.read_text(encoding="utf-8")
    report.checks["file"] = f"ok ({len(text)} chars)"
    if len(text.strip()) < 500:
        fail("blocker", "file", "file is empty or nearly empty")

    probe = Probe()
    try:
        probe.feed(text)
        probe.close()
    except Exception as exc:  # HTMLParser is lenient; this guards hard failures
        fail("blocker", "html", f"cannot parse HTML: {exc}")
        return report, findings

    if not text.lstrip().lower().startswith("<!doctype html>"):
        fail("error", "doctype", "missing <!DOCTYPE html>")
    report.checks["doctype"] = "ok" if text.lstrip().lower().startswith("<!doctype html>") else "fail"

    report.title = " ".join(probe.title.split())
    if not report.title:
        fail("error", "title", "missing or empty <title>")
    report.checks["title"] = report.title or "fail"

    if probe.html_lang.lower() != "zh-cn":
        fail("error", "lang", f'<html lang> is "{probe.html_lang}", expected "zh-CN"')
    report.checks["lang"] = probe.html_lang or "fail"

    if "width=device-width" not in probe.viewport:
        fail("error", "viewport", "missing responsive viewport meta")
    report.checks["viewport"] = probe.viewport or "fail"

    style_len = sum(len(chunk) for chunk in probe.style_chunks)
    if style_len < 1500:
        fail("error", "inline-css", f"inline <style> is only {style_len} chars")
    report.checks["inline-css"] = f"{style_len} chars"

    if "</html>" not in text.lower():
        fail("error", "html", "missing closing </html>")

    if probe.external_assets:
        fail("error", "self-contained", "external asset(s): " + ", ".join(probe.external_assets))
    report.checks["self-contained"] = "ok" if not probe.external_assets else "fail"

    labels = [text for _, text in probe.nav_links]
    hrefs = [href for href, _ in probe.nav_links]
    if labels != NAV_LABELS:
        fail("error", "nav", f"nav labels {labels} != {NAV_LABELS}")
    expected_hrefs = [name for name, _ in PAGES]
    if hrefs != expected_hrefs:
        fail("error", "nav", f"nav hrefs {hrefs} != {expected_hrefs}")
    active = [href for href, current in zip(hrefs, probe.nav_current) if current == "page"]
    if active != [filename]:
        fail("error", "nav", f"aria-current=page must be only on {filename}, found {active}")
    report.checks["nav"] = "ok" if not any(f.rule == "nav" for f in findings) else "fail"

    todo = TODO_RE.search(text)
    if todo:
        fail("error", "todo", f"unexplained marker: {todo.group(0)}")
    report.checks["todo"] = "ok" if not todo else "fail"

    broken: list[str] = []
    for href in probe.hrefs:
        if href.lower().startswith(SKIP_PREFIXES) or href.startswith("#"):
            continue
        target, _, fragment = href.partition("#")
        target_path = (path.parent / target).resolve() if target else path
        try:
            target_path.relative_to(site.resolve())
        except ValueError:
            broken.append(f"{href} (outside the site)")
            continue
        if not target_path.is_file():
            broken.append(f"{href} (missing {target_path.name})")
            continue
        if fragment and target_path.suffix == ".html":
            target_text = target_path.read_text(encoding="utf-8")
            if f'id="{fragment}"' not in target_text:
                broken.append(f"{href} (missing anchor #{fragment})")
    if broken:
        fail("error", "links", "broken relative link(s): " + "; ".join(broken))
    report.checks["links"] = "ok" if not broken else "fail"

    shots_dir = site / ".shot" / "shots"
    shot_path = shots_dir / (path.stem + ".png")
    ok, detail = shoot(SHOT, path, shot_path)
    if not ok:
        fail("error", "screenshot", detail)
    else:
        report.screenshot = str(shot_path.relative_to(site / ".shot"))
    report.checks["screenshot"] = detail

    return report, findings


def write_report(site: Path, out_dir: Path, chrome: str, pages: list[PageReport], findings: list[Finding]) -> None:
    counts = {level: sum(1 for f in findings if f.severity == level) for level in ("blocker", "error", "warn")}
    ok = counts["blocker"] == 0 and counts["error"] == 0
    now = dt.datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S %Z")

    lines = [
        "# learning-site 自检报告",
        "",
        f"- 生成时间：{now}",
        f"- 站点目录：`{site}`",
        f"- 页面数：{len(pages)}",
        f"- 结论：**{'PASS' if ok else 'FAIL'}**（blocker {counts['blocker']} / error {counts['error']} / warn {counts['warn']}）",
        f"- 截图：{VIEWPORT[0]}×{VIEWPORT[1]}，无头 Chrome",
        "",
        "## 页面",
        "",
        "| 页面 | 标题 | 结构 | 导航 | 链接 | 自包含 | 截图 |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ]
    for report in pages:
        c = report.checks
        lines.append(
            f"| `{report.page}` | {report.title or '—'} | {c.get('doctype', '—')} / {c.get('inline-css', '—')} "
            f"| {c.get('nav', '—')} | {c.get('links', '—')} | {c.get('self-contained', '—')} | {c.get('screenshot', '—')} |"
        )
    lines += ["", "## 发现", ""]
    if findings:
        for finding in sorted(findings, key=lambda f: ({"blocker": 0, "error": 1, "warn": 2}[f.severity], f.page)):
            lines.append(f"- **{finding.severity}** · `{finding.page}` · {finding.rule}: {finding.detail}")
    else:
        lines.append("无 error 或 blocker。")
    lines += [
        "",
        "## 截图",
        "",
    ]
    for report in pages:
        if report.screenshot:
            lines.append(f"- [{report.page}]({report.screenshot})")
    lines.append("")

    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "report.md").write_text("\n".join(lines), encoding="utf-8")
    (out_dir / "report.json").write_text(
        json.dumps(
            {
                "generated_at": now,
                "site": str(site),
                "chrome": chrome,
                "viewport": VIEWPORT,
                "pass": ok,
                "counts": counts,
                "pages": [asdict(p) for p in pages],
                "findings": [asdict(f) for f in findings],
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print("\n".join(lines))


def main() -> int:
    parser = argparse.ArgumentParser(description="learning-site self-check")
    parser.add_argument("--site", default=str(Path(__file__).resolve().parent))
    parser.add_argument("--out", default=None, help="report directory (default: <site>/.shot)")
    parser.add_argument("--chrome", default=None)
    args = parser.parse_args()

    site = Path(args.site).resolve()
    out_dir = Path(args.out).resolve() if args.out else site / ".shot"

    global SHOT
    SHOT = find_chrome(args.chrome)
    if not SHOT:
        print("error: Google Chrome not found; pass --chrome or set CHROME", file=sys.stderr)
        return 2

    pages: list[PageReport] = []
    findings: list[Finding] = []
    for filename, label in PAGES:
        report, page_findings = check_page(site, filename, label)
        pages.append(report)
        findings.extend(page_findings)

    write_report(site, out_dir, SHOT, pages, findings)
    failed = any(f.severity in ("blocker", "error") for f in findings)
    print(f"shot.py: {'FAIL' if failed else 'PASS'} — report: {out_dir / 'report.md'}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
