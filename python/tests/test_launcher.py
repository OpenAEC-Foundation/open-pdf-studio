"""Finding and launching the app (with the fake server standing in for the binary)."""

from __future__ import annotations

import os
import sys
import unittest

from helpers import FAKE

import open_pdf_studio as ops
from open_pdf_studio import launcher
from open_pdf_studio.launcher import build_command, candidate_paths, find_app, instance_env

FAKE_APP = [sys.executable, FAKE]


class FindApp(unittest.TestCase):
    def test_opds_app_wins(self):
        self.assertEqual(find_app(env={"OPDS_APP": "/x/app"}, exists=lambda p: p == "/x/app", which=lambda n: "/usr/bin/other"), "/x/app")

    def test_opds_app_pointing_nowhere_is_an_error(self):
        with self.assertRaisesRegex(ops.AppNotFoundError, "OPDS_APP"):
            find_app(env={"OPDS_APP": "/nope"}, exists=lambda p: False, which=lambda n: None)

    def test_path_then_install_locations(self):
        self.assertEqual(find_app(env={}, exists=lambda p: False, which=lambda n: "/usr/bin/open-pdf-studio"), "/usr/bin/open-pdf-studio")
        mac = "/Applications/Open PDF Studio.app/Contents/MacOS/open-pdf-studio"
        self.assertEqual(find_app(platform="darwin", env={"HOME": "/Users/u"}, exists=lambda p: p == mac, which=lambda n: None), mac)

    def test_not_found_lists_what_was_tried(self):
        with self.assertRaises(ops.AppNotFoundError) as cm:
            find_app(platform="linux", env={}, exists=lambda p: False, which=lambda n: None)
        self.assertIn("/usr/bin/open-pdf-studio", str(cm.exception))
        self.assertIn("OPDS_APP", str(cm.exception))

    def test_candidate_paths_per_platform(self):
        # Separators follow the target platform, whatever the host is.
        win = candidate_paths("win32", {"ProgramFiles": r"C:\Program Files", "ProgramW6432": r"C:\Program Files", "LOCALAPPDATA": r"C:\Users\u\AppData\Local"})
        self.assertEqual(win, [
            r"C:\Program Files\Open PDF Studio\open-pdf-studio.exe",
            r"C:\Users\u\AppData\Local\Open PDF Studio\open-pdf-studio.exe",
            r"C:\Users\u\AppData\Local\Programs\Open PDF Studio\open-pdf-studio.exe",
        ])
        self.assertIn("/snap/bin/open-pdf-studio", candidate_paths("linux", {}))
        self.assertEqual(candidate_paths("darwin", {"HOME": "/Users/u"}), [
            "/Applications/Open PDF Studio.app/Contents/MacOS/open-pdf-studio",
            "/Users/u/Applications/Open PDF Studio.app/Contents/MacOS/open-pdf-studio",
        ])


class Command(unittest.TestCase):
    def test_flags(self):
        self.assertEqual(build_command(["app"], 9300, platform="win32", env={}), ["app", "--mcp-server", "--mcp-port", "9300"])

    def test_linux_without_display_uses_xvfb_run(self):
        cmd = build_command(["app"], 1, platform="linux", env={}, which=lambda n: "/usr/bin/xvfb-run")
        self.assertEqual(cmd[:2], ["/usr/bin/xvfb-run", "-a"])
        self.assertEqual(cmd[-4:], ["app", "--mcp-server", "--mcp-port", "1"])

    def test_linux_with_display_runs_directly(self):
        for env in ({"DISPLAY": ":0"}, {"WAYLAND_DISPLAY": "wayland-0"}):
            self.assertEqual(build_command(["app"], 1, platform="linux", env=env, which=lambda n: "/x")[0], "app")

    def test_linux_without_display_or_xvfb_explains(self):
        with self.assertRaisesRegex(ops.AppLaunchError, "xvfb"):
            build_command(["app"], 1, platform="linux", env={}, which=lambda n: None)

    def test_xvfb_can_be_forced_or_disabled(self):
        self.assertEqual(build_command(["app"], 1, platform="linux", env={}, xvfb=False)[0], "app")
        self.assertEqual(build_command(["app"], 1, platform="darwin", env={}, xvfb=True, which=lambda n: "xr")[0], "xr")

    def test_instance_environment(self):
        env = instance_env({"PATH": "/bin", "OPDS_HEADLESS": "0"}, "/tmp/d")
        self.assertEqual((env["OPS_ENABLE_MCP"], env["OPDS_DETACHED"], env["OPDS_HEADLESS"], env["OPDS_DATA_DIR"]), ("1", "1", "1", "/tmp/d"))
        self.assertEqual(env["PATH"], "/bin")
        self.assertNotIn("OPDS_HEADLESS", instance_env({"OPDS_HEADLESS": "1"}, "/d", headless=False))


class Launch(unittest.TestCase):
    def launch(self, **env):
        base = dict(os.environ)
        base.update(env)
        return ops.launch(FAKE_APP, env=base, xvfb=False, startup_timeout=300, timeout=20)

    def test_starts_a_headless_instance_and_stops_it(self):
        app = self.launch()
        try:
            state = app.request("fake/state")
            self.assertEqual(state["argv"][0], "--mcp-server")
            self.assertEqual(state["argv"][2], str(app.transport.endpoint.split(":")[2].split("/")[0]))
            self.assertEqual(state["env"]["OPS_ENABLE_MCP"], "1")
            self.assertEqual(state["env"]["OPDS_DETACHED"], "1")
            self.assertEqual(state["env"]["OPDS_HEADLESS"], "1")
            data_dir = state["env"]["OPDS_DATA_DIR"]
            self.assertTrue(os.path.isdir(data_dir))
            self.assertTrue(app.tools.list_tabs()["ok"])
            proc = app.process
        finally:
            app.close()
        self.assertFalse(proc.running())
        self.assertFalse(os.path.exists(data_dir))

    def test_ready_without_the_log_marker_via_a_probe_call(self):
        with self.launch(FAKE_NO_MARKER="1", FAKE_READY_DELAY="1") as app:
            self.assertFalse(app.process.ready_marker.is_set())
            self.assertTrue(app.tools.list_tabs()["ok"])

    def test_exit_during_startup_reports_the_output(self):
        with self.assertRaises(ops.AppLaunchError) as cm:
            self.launch(FAKE_EXIT_EARLY="1")
        self.assertIn("simulated startup failure", cm.exception.output)

    def test_webview_that_never_gets_ready_times_out(self):
        # Generous time for the (fake) MCP server to come up on a slow runner,
        # a short bound for the WebView phase that is under test.
        base = dict(os.environ, FAKE_NO_MARKER="1", FAKE_READY_DELAY="600")
        with self.assertRaisesRegex(ops.AppLaunchError, "did not become ready within 2s"):
            ops.launch(FAKE_APP, env=base, xvfb=False, startup_timeout=300, webview_timeout=2, timeout=5)

    def test_missing_executable(self):
        with self.assertRaises(ops.AppLaunchError):
            ops.launch([os.path.join(os.path.dirname(FAKE), "no-such-app")], xvfb=False, startup_timeout=5)

    def test_document_workflow_on_a_launched_instance(self):
        import tempfile

        with self.launch() as app, tempfile.TemporaryDirectory() as tmp:
            src = os.path.join(tmp, "in.pdf")
            with open(src, "wb") as f:
                f.write(b"%PDF-1.7\n")
            doc = app.open(src)
            doc.annotations.add("textbox", x=10, y=10, width=80, height=20, text="hi")
            doc.save(os.path.join(tmp, "out.pdf"))
            self.assertTrue(os.path.isfile(os.path.join(tmp, "out.pdf")))


class LauncherModule(unittest.TestCase):
    def test_free_port_is_bindable(self):
        self.assertGreater(launcher.free_port(), 0)


if __name__ == "__main__":
    unittest.main()
