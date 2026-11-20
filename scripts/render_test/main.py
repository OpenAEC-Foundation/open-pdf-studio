"""Render-regression test main loop."""
import argparse
import shutil
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Iterable

from .app_client import AppClient
from .compare import compare
from .reference import render_with_pymupdf
from .report import PageResult, write_summary, write_html


def _git_sha() -> str:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=str(Path(__file__).resolve().parents[2]),
        ).decode().strip()
    except Exception:
        return "unknown"


def _filter_pdfs(pdfs: list[dict], pat: str | None) -> list[dict]:
    if not pat:
        return pdfs
    return [p for p in pdfs if pat.lower() in Path(p["path"]).name.lower()]


def _parse_page_range(arg: str | None, total: int) -> Iterable[int]:
    if not arg:
        return range(total)
    if "-" in arg:
        a, b = arg.split("-", 1)
        return range(int(a), min(int(b) + 1, total))
    return [int(arg)]


def main() -> int:
    ap = argparse.ArgumentParser(prog="render-regression-test")
    ap.add_argument("--url", default="http://127.0.0.1:9223/mcp")
    ap.add_argument("--width", type=int, default=2000)
    ap.add_argument("--blur-sigma", type=float, default=1.0)
    ap.add_argument("--pixel-tol", type=int, default=30)
    ap.add_argument("--fail-pct", type=float, default=2.0)
    ap.add_argument("--pdf", help="filter PDFs by substring of filename")
    ap.add_argument("--page-range", help="e.g. 0 or 0-2 (applied to each PDF)")
    ap.add_argument(
        "--out-root",
        default="target/render-regression-runs",
    )
    args = ap.parse_args()

    out_root = Path(args.out_root)
    out_root.mkdir(parents=True, exist_ok=True)
    sha = _git_sha()
    run_dir = out_root / f"{datetime.now().strftime('%Y-%m-%d_%H%M%S')}-{sha}"
    run_dir.mkdir()

    print(f"[render-regression] writing to {run_dir}")

    client = AppClient(args.url)
    try:
        client.initialize()
    except Exception as e:
        print(f"[render-regression] cannot reach MCP server at {args.url}: {e}", file=sys.stderr)
        print("[render-regression] is the app running with --mcp-server?", file=sys.stderr)
        return 2

    pdfs = _filter_pdfs(client.list_test_pdfs(), args.pdf)
    print(f"[render-regression] {len(pdfs)} PDFs to test")
    if not pdfs:
        print("[render-regression] no matching PDFs — nothing to do")
        client.close()
        return 0

    results: list[PageResult] = []
    for pdf in pdfs:
        meta = client.get_pdf_metadata(pdf["path"])
        version = meta["pdf_version"]
        stem = Path(pdf["path"]).stem.replace(" ", "_")[:40]
        pages_to_test = list(_parse_page_range(args.page_range, pdf["page_count"]))

        for idx in pages_to_test:
            print(f"  {Path(pdf['path']).name} p{idx}", end="", flush=True)
            try:
                t_ref = time.perf_counter()
                ref = render_with_pymupdf(Path(pdf["path"]), idx, args.width)
                ref_ms = (time.perf_counter() - t_ref) * 1000.0

                t_app = time.perf_counter()
                app = client.screenshot_page(pdf["path"], idx, args.width)
                app_ms = (time.perf_counter() - t_app) * 1000.0

                t_diff = time.perf_counter()
                pct, overlay = compare(
                    ref, app, args.blur_sigma, args.pixel_tol
                )
                diff_ms = (time.perf_counter() - t_diff) * 1000.0

                ref_name  = f"{stem}_p{idx}_ref.png"
                app_name  = f"{stem}_p{idx}_app.png"
                diff_name = f"{stem}_p{idx}_diff.png"
                ref.save(run_dir / ref_name)
                app.save(run_dir / app_name)
                overlay.save(run_dir / diff_name)

                results.append(PageResult(
                    pdf_path=str(pdf["path"]),
                    pdf_version=version,
                    page_index=idx,
                    diff_pct=pct,
                    ref_filename=ref_name,
                    app_filename=app_name,
                    diff_filename=diff_name,
                    app_render_ms=app_ms,
                    ref_render_ms=ref_ms,
                    diff_ms=diff_ms,
                ))
                status = "PASS" if pct <= args.fail_pct else "FAIL"
                print(f"  {pct:6.2f}%  {status}  app={app_ms:.0f}ms ref={ref_ms:.0f}ms")
            except Exception as e:
                print(f"  ERROR: {e}")
                # Synthesize a failed result so the report shows the error
                results.append(PageResult(
                    pdf_path=str(pdf["path"]),
                    pdf_version=version,
                    page_index=idx,
                    diff_pct=100.0,
                    ref_filename="-",
                    app_filename="-",
                    diff_filename="-",
                ))

    config = {
        "width":      args.width,
        "blur_sigma": args.blur_sigma,
        "pixel_tol":  args.pixel_tol,
        "fail_pct":   args.fail_pct,
    }
    write_summary(run_dir / "summary.json", results, sha, config)
    write_html(run_dir / "report.html",   results, sha, config)

    # 'latest' symlink (best-effort; Windows requires admin for symlinks).
    latest = out_root / "latest"
    try:
        if latest.is_symlink() or latest.exists():
            latest.unlink()
        latest.symlink_to(run_dir.name)
    except OSError:
        # Windows fallback: copy summary to a stable filename
        shutil.copy2(run_dir / "summary.json", out_root / "latest_summary.json")

    failed = sum(1 for r in results if r.diff_pct > args.fail_pct)
    passed = len(results) - failed
    print(f"[render-regression] {len(results)} pages, {passed} passed, {failed} failed.")

    # Timing summary (only meaningful if any pages were successfully timed)
    timed = [r for r in results if r.app_render_ms > 0.0]
    if timed:
        app_total = sum(r.app_render_ms for r in timed)
        ref_total = sum(r.ref_render_ms for r in timed)
        app_avg = app_total / len(timed)
        app_max = max(r.app_render_ms for r in timed)
        ref_avg = ref_total / len(timed)
        print(
            f"[render-regression] total app render: {app_total/1000.0:.1f}s "
            f"(avg {app_avg:.0f}ms/page, max {app_max:.0f}ms)"
        )
        print(
            f"[render-regression] PyMuPDF reference: {ref_total/1000.0:.1f}s "
            f"(avg {ref_avg:.0f}ms/page)"
        )

    print(f"[render-regression] open {run_dir / 'report.html'}")
    client.close()
    return failed
