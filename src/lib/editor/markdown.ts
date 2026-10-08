/**
 * Post-process the editor's markdown before saving. The serializer HTML-encodes `&`
 * (so "Problem & Context" became "Problem &amp; Context" and the PRD linter no longer
 * recognised the heading). A bare `&` is valid markdown, so undo that — except where
 * the `&` would then read as an entity, which keeps typed "&amp;" text intact.
 */
export function tidyMarkdown(markdown: string) {
  return markdown.replace(/&amp;(?!#?\w+;)/g, "&");
}
