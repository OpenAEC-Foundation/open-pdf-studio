# Contributing to Open PDF Studio

Thanks for wanting to help improve Open PDF Studio! This project is developed at
a fast pace with AI-assisted tooling, and that shapes how contributions work best
here. Please take two minutes to read this before you start — it will make your
contribution land faster.

## TL;DR

1. **Open an issue.** A clear, well-described issue is the single most valuable
   contribution — for both bugs and feature requests.
2. **Prefer a clear description over a pull request.** Because the codebase moves
   quickly, PRs tend to go stale and drift into conflict before they can be
   merged. A precise, implementation-ready description can be picked up and
   shipped against the *current* code immediately.

---

## 1. Open a great issue

Issues are how almost everything gets done here. A good issue is one that a
maintainer — or an AI-assisted workflow — can act on **without having to guess**.

Please include:

- **What you want / what's wrong** — the behaviour you expected versus what
  actually happens.
- **Steps to reproduce** (for bugs) — the exact actions, in order.
- **A sample** — the PDF that triggers it (or a minimal one that reproduces it)
  plus screenshots or a short screen recording. Visuals help enormously.
- **Your environment** — operating system, the app version (shown in the title
  bar), and, for crashes, the full crash log.
- **One topic per issue** — split unrelated things into separate issues.

## 2. Why we prefer instructions over pull requests

We know this is unusual for an open-source project, so here's the honest reasoning:

Development happens quickly and with heavy AI assistance. At that pace, external
pull requests tend to **go stale fast** — the surrounding code changes underneath
them, they drift out of sync, and they end up in conflict before they can be
reviewed and merged. That wastes the effort you put in and slows everyone down.

So the most effective thing you can do is **describe the change you want as if you
were briefing someone who will implement it.** A clear, self-contained description
can be handed straight to our AI-assisted workflow, folded into the current code,
kept in sync, and shipped — often the same day.

### How to write an implementation-ready description

Put this in a new issue (or a comment on an existing one):

- **Goal** — one sentence: what should be possible after this change.
- **Expected behaviour** — concretely, step by step: what the user does and what
  happens. Include the edge cases you care about.
- **Acceptance criteria** — how we'll know it's done right ("when I do X, Y
  happens").
- **Context** — screenshots, example files, and where in the UI you'd expect it
  to live. Describe the *outcome*, not the internal implementation — you don't
  need to know the code.
- **Out of scope** — anything you explicitly do *not* want changed.

The clearer and more complete this is, the faster and more accurately it lands.

### "But I'd really like to send code"

Code is welcome too — it's a great way to make your intent unambiguous. Just be
aware that, given the pace, we may take the **idea** from your PR and re-implement
it against the current code rather than merging the branch directly, and the PR
may then be closed with a note once its useful parts are incorporated. If you do
open a PR, please add the description above so the intent is crystal clear.

## Symbol libraries and content — the exception where PRs are encouraged

The "prefer a description over a PR" advice is about **code**. **Content is different.**
Symbol libraries, hatch patterns, and similar reusable content don't go stale the
way code does, so **content pull requests are actively welcome**. We want every
symbol library in the world — bring the standards and libraries from your country,
industry, and discipline. Symbols are organised by industry (e.g. AEC) and country
(e.g. NL), and localisation keeps expanding, so contributions for any region are
welcome.

We are also looking for someone to **own and maintain the extensions and the
content repository** — curating incoming libraries and keeping the ecosystem
organised as it grows. If you're interested, open an issue to introduce yourself.

## Adding your extension to the catalogue

The Extensions window (File > Extensions > Browse) lists the extensions in
[`extensions.json`](extensions.json) at the root of this repository. Like symbol
libraries, catalogue entries are content, so pull requests are welcome:

1. Publish the extension in its own public GitHub repository.
2. Create a release tagged with the version from `plugin.json` (for example
   `v1.2.0`) and attach the `.oppx` package. New releases are offered to users as
   updates.
3. Open a pull request that adds one entry to `extensions.json`:

   ```json
   {
     "id": "my-extension",
     "name": "My Extension",
     "description": "One or two sentences on what it does (up to 400 characters).",
     "author": "Your name",
     "repo": "https://github.com/owner/my-extension",
     "tags": ["markup", "measure"]
   }
   ```

   `id` must match the `id` in `plugin.json`; the app refuses a package whose id
   differs. Instead of `repo` you can give a fixed `package` link to a `.oppx`
   with its `version` and `sha256`. The full format is in
   [`extensions.schema.json`](extensions.schema.json), and the unit tests check the
   file on every pull request.

Maintainers review each entry before merging: the extension should do what its
description says and its source should be public. Extensions installed through
Add custom (any link) are not reviewed, and the app says so.

## Ground rules

- **Be respectful and constructive.** Assume good intent and keep the discussion
  focused on the work.
- **One topic per issue.**
- **Don't name competing or commercial products** in issues, code, or docs where
  a generic description works — refer to file formats and open standards, not to
  other tools.
- **Security problems:** please report these privately to the maintainers instead
  of opening a public issue.

## Running the app locally (optional)

You don't need to build anything to contribute a good issue. If you *do* want to
run it yourself, see the [README](README.md) for the prerequisites and the
`npm run tauri:dev` / `npm run tauri:build` scripts.

---

A well-written issue with a clear description is worth its weight in gold — thank
you for helping make Open PDF Studio better.
