# OpenPDFStudio - Development Guidelines

**READ THIS FILE BEFORE MAKING ANY CHANGES.**

---

## Cursor Rules

- **DO NOT** change cursor. it shall be default cursor. except for the area that the pdf file is shown.

---

## Modals / Dialogs

- Use **Windows-style** appearance (squared corners, no border-radius)
- Title bar: gradient `#ffffff` to `#f5f5f5`, border `#d4d4d4`
- Close button: turns red (`#e81123`) on hover
- **No move cursor** on draggable headers

## Running the App

- When running `tauri dev` or any long-running process, always run it in the background and do NOT wait/block for it to finish.

## General

- Match Windows Forms / Visual Studio aesthetic
- Avoid rounded corners except where specified
- Keep UI compact and functional
- No unnecessary animations or effects
- When creating a modal window, the window shall be movable and do not disappear when user click on somewhere outside of it. just like a default behaviour of modal form.
- Do not run app when some changes are implimented when app is running and hot reload is true.

## Github commit
- Remove all comments that reference to Adobe, pdf-xchange, foxit or any third parties that are not opensource
- Create a commit comment by comparing the current files to the commited changes.
- Do not include the Codex and Anthropic stuff in the commit comment
- Show the commit comment to user and ask for approval.
- when wanted to commit and push, increase the minor revision, for example 0.1.0 to 0.2.0 everywhere.
- For every push, run github action to create a new installers. wait to the end make sure they are created successfully.
- also publish the a new draft release