# open-pdf-studio (Python)

Script [Open PDF Studio](https://github.com/OpenAEC-Foundation/open-pdf-studio)
from Python. The package is a thin, dependency-free client over the app's MCP
tools: every PDF operation runs in the app itself, so a script gets exactly the
output the app produces. The typed API is generated from the app's tool
catalogue, so each new app tool shows up here with the next release.

```python
import open_pdf_studio as ops

with ops.launch() as app:                    # own headless instance of the app
    doc = app.open("plan.pdf")
    doc.annotations.add("box", page=1, x=40, y=40, width=200, height=80,
                        strokeColor="#e81123")
    doc.export_image("plan-p1.png", page=1, dpi=300)
    doc.save("plan-marked.pdf")

app = ops.connect()                          # or: the app that is already running
print(app.tools.list_tabs())                 # every MCP tool as a typed method
```

Requirements: Python 3.10+ and an installed Open PDF Studio (found on `PATH`, in
the standard install location, or via `OPDS_APP`). On Linux without a display,
install `xvfb`; the launcher then runs the app under `xvfb-run`.

Full documentation, the coverage table and the design decision:
[docs/python-library.md](https://github.com/OpenAEC-Foundation/open-pdf-studio/blob/main/docs/python-library.md).
