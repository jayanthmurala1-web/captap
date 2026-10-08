const FIGMA_URL =
  /https?:\/\/(?:www\.)?figma\.com\/(?:file|design|proto|board)\/[a-zA-Z0-9_-]+[^\s)"'<>\]]*/i;

/** Embed URL for the first Figma link in a document's content, or null if there isn't one. */
export function figmaEmbedFromContent(content: string): string | null {
  const url = content.match(FIGMA_URL)?.[0];
  return url
    ? `https://www.figma.com/embed?embed_host=captap&url=${encodeURIComponent(url)}`
    : null;
}
