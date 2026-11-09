# Keyboard shortcuts

All shortcuts can be changed, exported and imported under **Preferences →
Keyboard Shortcuts**. **Load preset → Markup-style shortcuts** switches to the
single-letter drawing keys and Alt+Shift measurement keys that are common in
drawing markup and take-off tools (for example H for Highlight, R for Rectangle
and Alt+Shift+L for Length). A command whose default key the preset takes over
gets another key (Hand moves to Shift+V). If you have your own shortcuts, the app
asks before replacing them. Nothing changes until you click **Save**; **Reset
all** restores the defaults.

The defaults:

| Shortcut | Action |
|----------|--------|
| `Ctrl+N` | New document |
| `Ctrl+O` | Open file |
| `Ctrl+S` | Save |
| `Ctrl+Shift+S` | Save As |
| `Ctrl+P` | Print |
| `Ctrl+Z` | Undo |
| `Ctrl+Y` / `Ctrl+Shift+Z` | Redo |
| `Ctrl+F` | Find |
| `F3` | Find next |
| `Ctrl+A` | Select all annotations on the page |
| `Ctrl+C` / `Ctrl+V` | Copy / paste annotations |
| `Delete` | Delete the selected annotations |
| `Ctrl+D` | Document properties |
| `Ctrl+W` | Close the active tab |
| `Ctrl+Tab` / `Ctrl+PgDn` | Next tab (wraps around) |
| `Ctrl+Shift+Tab` / `Ctrl+PgUp` | Previous tab (wraps around) |
| `V` | Select tool |
| `H` | Hand tool |
| `T` | Text box tool |
| `N` | Sticky note tool |
| `D` then `L` | Line tool (key sequence) |
| `Ctrl+=` / `Ctrl+-` | Zoom in / zoom out |
| `Ctrl+0` | Actual size (physical paper size once the display is calibrated in Preferences > Page Display) |
| `Ctrl+1` | Fit width |
| `Ctrl+2` | Fit page |
| `F9` | Navigation panel on or off |
| `F11` | Annotations list on or off |
| `F12` | Properties panel on or off |
| `F1` | Keyboard shortcuts |
| Arrow keys | Nudge an annotation (1 px, with Shift 10 px) |
| `Enter` | Finish an area or perimeter measurement |

## Key sequences

A shortcut can also be a short key sequence: two or three letters typed one
after the other, without Ctrl, Alt or Shift, like the command aliases of CAD
programs. `D` then `L` starts the Line tool. Type the letters within about a
second; after a pause the sequence starts over. Sequences never fire while you
type in a text field or a text box, or while a dialog is open; `Esc` forgets
the letters typed so far.

Sequences are changed like any other shortcut: select the command under
**Preferences → Keyboard Shortcuts**, click **Add shortcut** and type the
letters (the recorder waits briefly after a letter for the next one). They
are written as letters with a space (`D L`) in exported shortcut files.

If a single letter has a shortcut of its own and also starts a sequence (for
example when you give `D` to a command), that letter waits for the next letter
or the pause before it runs, so both stay usable. No built-in single-letter
shortcut starts a built-in sequence, so the single keys work as before.

In a browser some keys (such as `Ctrl+N`, `Ctrl+W` and `Ctrl+Tab`) belong to the
browser itself and do not reach the page.
