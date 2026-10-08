# 015 — Rich editing: Notion-style editor, images, editable ERD canvas

**Problem:** Spec 014 made editing honest but raw: people edit documents, task descriptions and agent playbooks as markdown text. Agency staff and clients don't write markdown. The ERD is a static picture; tables can't be moved or edited.
**Who pays / why it matters to revenue:** The PRD is the product's center (linter, drift check, client approval). If a PM can't comfortably write and edit it in Captap, they write it in Notion/Docs and Captap never sees the source of truth.
**Success metric:** A non-technical PM creates and edits a PRD with headings, tables and a screenshot without ever seeing markdown; it still passes the linter and drift check. An ERD can be rearranged and edited on a canvas and the layout is the same for every viewer.

## Decisions (founder, 2026-09-28)
- Editor everywhere people write: documents (edit + new), task descriptions, agent playbooks (name/description as plain fields).
- Images: **Cloudinary**. Keys in `.env` (`CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`), set by the founder.
- ERD: **full visual editing** (tables, columns, relationships) + layout **saved for the whole team**.

## Design
1. **Storage stays markdown.** The linter (011), drift check (012), client page (013) and MCP agents all read markdown. The editor converts markdown ⇄ rich text; people never see the syntax. Legacy HTML documents open in the editor and are saved back as markdown.
2. **Editor:** Tiptap 3 (ProseMirror) + `@tiptap/markdown`. Toolbar + "/" menu: headings, bold/italic, lists, checklists, tables, code, quotes, links, images (upload, paste, drag-drop).
3. **Images:** browser → our server action → Cloudinary signed upload over REST (SHA-1 signature, no SDK). Only image MIME types, size-capped, project member only. The document stores the `https://res.cloudinary.com/...` URL; the sanitizer already allows https images.
4. **ERD:** the document's mermaid `erDiagram` block stays the source (agents write it). The canvas (React Flow) parses it into tables/relations; edits serialize back to mermaid. Layout is saved inside the same block as a mermaid comment (`%% captap-layout {...}`), so it's versioned with the document and needs no migration.

## Acceptance criteria
- [ ] Editing any document shows formatted content, never markdown; saving produces markdown the PRD linter accepts (tests: round-trip keeps headings, lists, tables, images).
- [ ] New document, task description and agent playbook use the same editor.
- [ ] Image upload/paste/drop works when Cloudinary keys are set; clear "not configured" message when they aren't; non-images and oversized files rejected (tests for validation + signature).
- [ ] ERD canvas: drag tables, add/rename tables and columns, add/remove relationships; save writes valid `erDiagram` + layout; reload shows the same layout for everyone (parser/serializer round-trip tests).
- [ ] Client approval page renders images and tables.

## Out of scope
Real-time co-editing, comments, image editing/cropping, ERD → SQL migrations.

## Research (decision point: new dependencies)
- `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/markdown`, `@tiptap/extension-table`, `@tiptap/extension-image`: v3.31.3, MIT, updated 2026-09-04. Official markdown extension (replaces community `tiptap-markdown`, last updated 2025-09). Most-used headless editor for React; stores ProseMirror JSON, converts to/from markdown.
- `@xyflow/react` (React Flow): v12.12.0, MIT, updated 2026-09-24. Standard for node/edge canvases.
- Cloudinary: REST upload API with signed params — no SDK needed (`node:crypto` SHA-1).
- Alternatives rejected: BlockNote (Notion-like out of the box, but markdown export is lossy — tables/structure the linter needs can drift), Milkdown (markdown-native but smaller ecosystem), S3 (more setup; founder chose Cloudinary).

## Evals / tests
- `markdown round-trip`: PRD template → editor → markdown passes `validatePrdStructure`; tables and images survive.
- `cloudinary`: signature matches Cloudinary's documented algorithm; rejects non-image / oversized / non-member.
- `erd`: parse → serialize round-trip of a mermaid erDiagram incl. relationship cardinalities and the layout comment.
