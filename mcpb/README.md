# Open PDF Studio for Claude Desktop

Connects Claude to [Open PDF Studio](https://open-aec.com/open-pdf-studio/),
the free, open-source PDF editor for the construction industry. Claude can open
PDF drawings, navigate pages, place scale regions, measure areas and lengths,
create and edit annotations, cut vector snippets from one drawing into another,
fill title blocks, place a quantity schedule on the sheet and save the result.

Everything runs on your own computer: the extension talks to the app on
`127.0.0.1`.

## Setup

1. Install Open PDF Studio (Windows, macOS, Linux) from
   [open-aec.com](https://open-aec.com/open-pdf-studio/#download).
2. In Open PDF Studio, open **Settings > General > AI link (MCP)**, tick
   *Allow AI assistants to operate this app* and click **Save**. The status
   line shows *Active on 127.0.0.1:9223*.
3. Install this extension in Claude Desktop (double-click
   `open-pdf-studio.mcpb`, or add it under **Settings > Extensions**).
4. If you changed the port in the app, set the same port in the extension's
   settings.

Keep Open PDF Studio running while you work with Claude. When the app is not
running, the tools still appear in Claude, and a tool call tells you to start
the app and turn on the AI link.

Tools that change a document (for example *Update annotation*, *Save PDF*,
*Run app command*) are marked as such, so Claude asks for your permission
before using them. Read-only tools (listing annotations, reading page counts,
capturing the page view) run without asking.

## Examples

### Measure the facades of an elevation drawing

> Open `C:\Projects\Barn\Elevations.pdf`, go to page 4 and set the scale from
> the drawing's scale bar. Then measure the net area of each facade, with the
> windows cut out, and list the results per facade.

Claude opens the drawing, reads the scale, places the areas and reports the
totals from the app's own take-off.

### Put a quantity schedule on the sheet

> Make a quantity schedule of all measured areas on this page, grouped by IFC
> category, and place it in the empty space at the bottom right.

Claude builds the schedule in the app and places it on the drawing as a table.

### Copy a detail from one drawing into another

> Cut the window detail from page 2 of `Details.pdf` as a vector snippet and
> paste it at the top left of the current sheet. Then fill in the title block:
> project name "Barn relocation", scale "1:20", status "Draft".

Claude cuts the detail as vector data (not a screenshot), pastes it, fills the
title block fields by name and asks before saving.

## Troubleshooting

- **"Open PDF Studio is not reachable"** — start the app and turn on
  Settings > General > AI link (MCP). Check that the port matches.
- **"Not started: … address in use"** in the app's status line — another
  program uses the port. Pick another port in the app and in the extension.

## Privacy Policy

The full policy is published at
<https://open-aec.com/open-pdf-studio/privacy/>. In short:

- **Data collection.** Neither this extension nor Open PDF Studio collects
  personal data, telemetry or usage statistics.
- **Use and storage.** The extension only relays requests between Claude
  Desktop and Open PDF Studio on your own computer (`127.0.0.1`). Your PDF
  files stay on your computer; the extension stores nothing.
- **Third-party sharing.** We share nothing with third parties. What Claude
  asks the app for — for example a picture of the current page view, a list
  of annotations or a measurement — is returned to Claude and becomes part of
  your conversation. That conversation is handled by Anthropic under its own
  terms and privacy policy.
- **Retention.** We retain no data. The app keeps its own settings locally on
  your computer.
- **Contact.** OpenAEC Foundation — info@open-aec.com — or open an issue at
  <https://github.com/OpenAEC-Foundation/open-pdf-studio/issues>.

## License

GNU Lesser General Public License v3.0 or later — source code at
<https://github.com/OpenAEC-Foundation/open-pdf-studio>.
