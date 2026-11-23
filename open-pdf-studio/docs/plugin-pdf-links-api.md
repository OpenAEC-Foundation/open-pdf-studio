# Plugin API: the links in a PDF

Check `api.features.pdfLinks` before calling the methods below.

All page numbers are 1-based. Coordinates are annotation-space units: the
page viewport at scale 1, with origin at the displayed top-left, the same
space as `getPageInfo` and `readPageContent`.

## Reading the links a page has

```js
const links = await api.getPageLinks(3);
// [{ x, y, width, height, kind: 'page' | 'uri' | 'other', app }]
```

`getPageLinks(pageNum)` returns every link annotation of the page as the file
has it, also the links other programs wrote. `kind` says where the link
leads: a place in the document, a web address, or something else. `app` is
true for a link the app made and edits itself; those are also in
`getAnnotations()`. A page number outside the document gives an empty list.

## Adding plain PDF links

```js
const { added } = await api.addPdfLinks([
  { page: 1, rect: { x: 40, y: 60, width: 120, height: 18 }, target: { page: 5 } },
  { page: 1, rect: { x: 40, y: 90, width: 120, height: 18 }, target: { page: 7, x: 0, y: 300 } },
]);
```

`addPdfLinks(links)` adds standard `/Link` annotations with a destination, the
kind other programs export: invisible, highlighted on hover, followed with a
click, and not selectable or editable in the app. A target with `x` and `y`
opens at that point and keeps the zoom; without them the link fits the whole
page.

- The call is one undo step.
- At most 5000 links per call. A page outside the document, a rectangle
  without a positive size, or a target with only one of `x` and `y` rejects
  the whole call with a `TypeError`; nothing is added then.
- The call is refused in a read-only PDF/A and in a protected document.

To make links the user can select, move and edit, create annotations of type
`link` instead.
