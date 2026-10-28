"""Find the Open PDF Studio executable and start a headless instance of it.

The instance is a test instance in the app's own sense (see
``src-tauri/src/headless.rs``): ``--mcp-server --mcp-port <port>`` with
``OPS_ENABLE_MCP=1`` (release builds refuse the flag without it),
``OPDS_DETACHED=1`` (skips the single-instance hand-off to a running app),
``OPDS_HEADLESS=1`` (window off-screen, no focus, native dialogs refused) and
its own ``OPDS_DATA_DIR`` (preferences, session and logs of the user stay
untouched). On Linux the WebView still needs a display; without one the
launcher runs the app under ``xvfb-run``.
"""

from __future__ import annotations

import collections
import os
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
from typing import Callable, Deque, Dict, List, Mapping, Optional, Sequence, Union

from .client import Client
from .errors import AppLaunchError, AppNotFoundError, AppNotReachableError, OpenPdfStudioError
from .transport import HttpTransport

APP_ENV = "OPDS_APP"
BINARY = "open-pdf-studio"
READY_MARKER = "[mcp-bridge] WebView ready"
# A cheap tool that needs the WebView: it answers once the frontend listens.
PROBE_TOOL = "app_list_tabs"

AppSpec = Union[str, "os.PathLike[str]", Sequence[str]]


def candidate_paths(platform: str = sys.platform, env: Optional[Mapping[str, str]] = None) -> List[str]:
    """Standard install locations of the app executable for ``platform``."""
    env = os.environ if env is None else env
    paths: List[str] = []
    if platform.startswith("win"):
        exe = f"{BINARY}.exe"
        for var in ("ProgramFiles", "ProgramW6432", "ProgramFiles(x86)"):
            if env.get(var):
                paths.append(os.path.join(env[var], "Open PDF Studio", exe))
        if env.get("LOCALAPPDATA"):
            # The per-user NSIS installer.
            paths.append(os.path.join(env["LOCALAPPDATA"], "Open PDF Studio", exe))
            paths.append(os.path.join(env["LOCALAPPDATA"], "Programs", "Open PDF Studio", exe))
    elif platform == "darwin":
        rel = os.path.join("Open PDF Studio.app", "Contents", "MacOS", BINARY)
        paths.append(os.path.join("/Applications", rel))
        if env.get("HOME"):
            paths.append(os.path.join(env["HOME"], "Applications", rel))
    else:
        paths += [f"/usr/bin/{BINARY}", f"/usr/local/bin/{BINARY}", f"/snap/bin/{BINARY}", f"/opt/open-pdf-studio/{BINARY}"]
    # dict.fromkeys: keep order, drop duplicates (ProgramFiles == ProgramW6432).
    return list(dict.fromkeys(paths))


def find_app(
    *,
    platform: str = sys.platform,
    env: Optional[Mapping[str, str]] = None,
    which: Callable[[str], Optional[str]] = shutil.which,
    exists: Callable[[str], bool] = os.path.isfile,
) -> str:
    """Locate the app: ``$OPDS_APP``, then ``PATH``, then the install paths."""
    env = os.environ if env is None else env
    tried: List[str] = []
    override = env.get(APP_ENV)
    if override:
        if exists(override):
            return override
        raise AppNotFoundError(f"{APP_ENV}={override!r} does not point to a file")
    found = which(BINARY)
    if found:
        return found
    tried.append(f"{BINARY} on PATH")
    for path in candidate_paths(platform, env):
        if exists(path):
            return path
        tried.append(path)
    raise AppNotFoundError(
        "Open PDF Studio was not found. Install it, or set "
        f"{APP_ENV} to the executable (or an AppImage). Tried:\n  " + "\n  ".join(tried)
    )


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def build_command(
    app: Sequence[str],
    port: int,
    *,
    platform: str = sys.platform,
    env: Optional[Mapping[str, str]] = None,
    xvfb: Union[bool, str] = "auto",
    which: Callable[[str], Optional[str]] = shutil.which,
) -> List[str]:
    """The command line of a headless instance, wrapped in xvfb-run when needed."""
    env = os.environ if env is None else env
    cmd = [*app, "--mcp-server", "--mcp-port", str(port)]
    linux = platform.startswith("linux") or platform.startswith("freebsd")
    has_display = bool(env.get("DISPLAY") or env.get("WAYLAND_DISPLAY"))
    want = (xvfb is True) or (xvfb == "auto" and linux and not has_display)
    if not want:
        return cmd
    runner = which("xvfb-run")
    if not runner:
        raise AppLaunchError(
            "Open PDF Studio needs a display on Linux and none is set (DISPLAY / WAYLAND_DISPLAY). "
            "Install xvfb (e.g. `apt install xvfb`) so the app can run under xvfb-run, "
            "or start an X server yourself."
        )
    return [runner, "-a", "-s", "-screen 0 1600x1000x24", *cmd]


def instance_env(base: Optional[Mapping[str, str]], data_dir: str, *, headless: bool = True) -> Dict[str, str]:
    env = dict(os.environ if base is None else base)
    env["OPS_ENABLE_MCP"] = "1"
    env["OPDS_DETACHED"] = "1"
    env["OPDS_DATA_DIR"] = data_dir
    if headless:
        env["OPDS_HEADLESS"] = "1"
    else:
        env.pop("OPDS_HEADLESS", None)
    return env


class AppProcess:
    """A started app instance; :meth:`stop` ends it and its child processes."""

    def __init__(self, popen: subprocess.Popen, data_dir: Optional[str]) -> None:
        self.popen = popen
        self._data_dir = data_dir
        self._output: Deque[str] = collections.deque(maxlen=200)
        self.ready_marker = threading.Event()
        self._readers = []
        for stream in (popen.stdout, popen.stderr):
            if stream is not None:
                t = threading.Thread(target=self._read, args=(stream,), daemon=True)
                t.start()
                self._readers.append(t)

    def _read(self, stream) -> None:
        try:
            for raw in stream:
                line = raw.decode("utf-8", "replace").rstrip()
                self._output.append(line)
                if READY_MARKER in line:
                    self.ready_marker.set()
        except (OSError, ValueError):  # the pipe was closed by stop()
            pass

    @property
    def output(self) -> str:
        return "\n".join(self._output)

    @property
    def pid(self) -> int:
        return self.popen.pid

    def running(self) -> bool:
        return self.popen.poll() is None

    def stop(self, timeout: float = 10.0) -> None:
        p = self.popen
        if p.poll() is None:
            if os.name == "nt":
                # /T also ends the PDFium workers and WebView processes.
                subprocess.run(["taskkill", "/PID", str(p.pid), "/T", "/F"], capture_output=True)
            else:
                try:
                    os.killpg(p.pid, signal.SIGTERM)
                except (ProcessLookupError, PermissionError):
                    p.terminate()
            try:
                p.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                if os.name != "nt":
                    try:
                        os.killpg(p.pid, signal.SIGKILL)
                    except (ProcessLookupError, PermissionError):
                        pass
                p.kill()
                p.wait(timeout=timeout)
        for t in self._readers:
            t.join(timeout=2)
        for stream in (p.stdout, p.stderr):
            try:
                if stream:
                    stream.close()
            except OSError:
                pass
        if self._data_dir:
            shutil.rmtree(self._data_dir, ignore_errors=True)
            self._data_dir = None


def launch(
    app: Optional[AppSpec] = None,
    *,
    port: Optional[int] = None,
    headless: bool = True,
    data_dir: Optional[str] = None,
    env: Optional[Mapping[str, str]] = None,
    xvfb: Union[bool, str] = "auto",
    startup_timeout: float = 120.0,
    timeout: float = 120.0,
) -> Client:
    """Start an own Open PDF Studio instance and return a connected client.

    ``app`` is the executable (default: :func:`find_app`) or a command prefix
    such as ``["/path/Open_PDF_Studio.AppImage"]``. The instance gets a free
    port and a temporary data directory unless ``port`` / ``data_dir`` are
    given. Closing the client stops the instance.
    """
    if app is None:
        prefix = [find_app()]
    elif isinstance(app, (str, os.PathLike)):
        prefix = [os.fspath(app)]
    else:
        prefix = [os.fspath(a) for a in app]
    port = port or free_port()
    own_dir = data_dir is None
    data_dir = data_dir or tempfile.mkdtemp(prefix="open-pdf-studio-")
    cmd = build_command(prefix, port, env=env, xvfb=xvfb)
    kwargs: Dict[str, object] = {}
    if os.name == "nt":
        kwargs["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    else:
        kwargs["start_new_session"] = True
    try:
        popen = subprocess.Popen(
            cmd,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=instance_env(env, data_dir, headless=headless),
            **kwargs,  # type: ignore[arg-type]
        )
    except OSError as e:
        if own_dir:
            shutil.rmtree(data_dir, ignore_errors=True)
        raise AppLaunchError(f"cannot start {cmd[0]!r}: {e}") from None
    proc = AppProcess(popen, data_dir if own_dir else None)
    client = Client(HttpTransport(f"http://127.0.0.1:{port}/mcp", timeout=timeout), process=proc, timeout=timeout)
    try:
        _wait_until_ready(client, proc, startup_timeout)
    except BaseException:
        client.close()
        raise
    return client


def _wait_until_ready(client: Client, proc: AppProcess, startup_timeout: float) -> None:
    deadline = time.monotonic() + startup_timeout

    def check_alive() -> None:
        if not proc.running():
            time.sleep(0.2)  # let the reader threads collect the last output
            raise AppLaunchError(f"Open PDF Studio exited during startup (code {proc.popen.returncode})", output=proc.output)

    # 1. The HTTP server is up.
    while True:
        check_alive()
        try:
            client.initialize()
            break
        except AppNotReachableError:
            if time.monotonic() > deadline:
                raise AppLaunchError(f"MCP server did not start within {startup_timeout:.0f}s", output=proc.output) from None
            time.sleep(0.25)
    # 2. The WebView listens: the startup marker, or a tool call that succeeds.
    while not proc.ready_marker.wait(0.25):
        check_alive()
        left = deadline - time.monotonic()
        if left <= 0:
            raise AppLaunchError(f"the app's WebView did not become ready within {startup_timeout:.0f}s", output=proc.output)
        try:
            client.call_tool(PROBE_TOOL, {}, timeout=min(left, 20.0))
            return
        except OpenPdfStudioError:
            time.sleep(0.5)


__all__ = ["AppProcess", "build_command", "candidate_paths", "find_app", "free_port", "instance_env", "launch"]
