# Privacy

Open PDF Studio is a desktop application that works on your files, on your
computer. This page lists everything the app sends over the network, what it
writes into your files, and how you can check both yourself.

`open-pdf-studio/js/core/geen-telemetrie.test.mjs` checks these statements
on every test run: it fails when the shipped source contains an internet
address that is not listed on this page, when a telemetry or analytics
package is added as a dependency, when the website statistics script ends
up in a desktop build, or when saving adds anything to the pages of a file.

## No telemetry

The desktop app collects no usage statistics, no crash reports and no
identifiers, and sends nothing in the background. There is no analytics or
error-reporting library among its dependencies. Log files stay on your
computer unless you send them yourself.

## No watermark

Saving, exporting and printing never add a mark of the app to your pages:
no watermark, no stamp, no footer, no extra text or image. A watermark,
header or footer is only there when you add one yourself with the
Watermark or Header/Footer tools.

What a save does change in a file, besides your own edits:

- the modification date in the document information;
- the Producer entry, which names the PDF library that wrote the file;
- annotations you create or edit carry your author name and the date. The
  author name comes from Preferences and starts as your login name on the
  computer; change it there before you share files if you prefer.

## Network connections

The app only connects to the internet when you use a feature that needs it.
Each request is an ordinary HTTPS request, so the server sees your IP
address and the app's user agent; the app adds no identifier of its own.

| When | Address | What is sent |
| --- | --- | --- |
| Help → Check for updates | `github.com` | a request for the release manifest and, when you install, the installer download |
| First start after an update: What's New | `api.github.com` | a request for the list of releases (cached for an hour) |
| Help → Previous version | `api.github.com`, `github.com` | a request for the list of releases, then the download you choose |
| Extensions panel: catalogue, install and update | `raw.githubusercontent.com`, `api.github.com`, `github.com`, and the catalogues and links you add | requests for the catalogue and the package you choose |
| Symbol library: online collections | `raw.githubusercontent.com`, `api.github.com` | requests for the collection index and the collections you download |
| Help → Feedback, when you press Send | `open-feedback-studio.pages.dev` | the text you typed and what you chose to attach |
| Sign in with OpenAEC | the OpenAEC Accounts server you sign in to; a development build defaults to `kubernetes.docker.internal` | the standard sign-in exchange (OAuth with PKCE) |
| Signing with a timestamp | the timestamp server you configure | a hash of the signature, never the document |
| File → Open from URL | the address you enter | a request for that file |
| Links in About and in messages (`open-aec.com`, `github.com`, `developer.microsoft.com`) | opened in your web browser, only when you click them | nothing from the app |

Addresses that only appear as identifiers inside exported files, and are
never contacted: `ifcx.dev` and `identifier.buildingsmart.org` (IFCX export).

Local only, never the internet:

- the automation server (MCP) is off by default and listens on `127.0.0.1`
  (`localhost`) when you switch it on;
- printing on Linux and macOS talks to the local print service;
- the sign-in flow returns to the app through `localhost`;
- `ipc.localhost` is the internal channel between the window and the app.

### Managed mode

With the environment variable `OPENAEC_BEHEERD=1` the app makes no update
check and does not fetch What's New; IT departments use it to control
versions centrally.

## The web version

The public web version on the OpenAEC website loads the website statistics
script of that site. That script is added after the build by
`open-pdf-studio/scripts/web-statistics.mjs`, only in the deployment
workflow of that website (`.github/workflows/live.yml`). The desktop
installers, the portable version and a web bundle you host yourself do not
contain it.

## Checking it yourself

- Run the check: `cd open-pdf-studio && node --test js/core/geen-telemetrie.test.mjs`.
- Build the app from this repository; the release workflows build the
  installers from the same source.
- Watch the network traffic of the app with a firewall or a proxy: with the
  features above unused, it makes no connection.
