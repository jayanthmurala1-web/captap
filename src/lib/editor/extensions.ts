import Image from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import StarterKit from "@tiptap/starter-kit";

/**
 * The content model shared by the editor and the markdown converter. Documents are
 * stored as markdown (the PRD linter, drift check and MCP agents read it), so every
 * node here must round-trip through markdown.
 */
export const contentExtensions = [
  StarterKit.configure({ link: { openOnClick: false, autolink: true } }),
  TableKit.configure({ table: { resizable: false } }),
  Image,
  TaskList,
  TaskItem.configure({ nested: true }),
];
