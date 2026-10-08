"use client";

import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "@tiptap/markdown";
import {
  type Editor,
  EditorContent,
  useEditor,
  useEditorState,
} from "@tiptap/react";
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Loader2,
  Minus,
  Quote,
  Redo2,
  Strikethrough,
  Table as TableIcon,
  Undo2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { uploadImageAction } from "@/app/(app)/documents/actions";
import { contentExtensions } from "@/lib/editor/extensions";
import { tidyMarkdown } from "@/lib/editor/markdown";
import { cn } from "@/lib/utils";

/**
 * Notion-style editor. People edit formatted text; the value in and out is markdown,
 * which is what the PRD linter, drift check and MCP agents read.
 */
export function RichEditor({
  value,
  onChange,
  name,
  placeholder = "Start writing…",
  minHeight = "min-h-[50vh]",
  ariaLabel,
}: {
  value: string;
  onChange?: (markdown: string) => void;
  /** Set to submit the markdown with a plain <form> (hidden input). */
  name?: string;
  placeholder?: string;
  minHeight?: string;
  ariaLabel?: string;
}) {
  const [markdown, setMarkdown] = useState(value);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const editorRef = useRef<Editor | null>(null);
  const emitted = useRef(value); // last markdown this editor produced

  const upload = async (file: File, editor: Editor) => {
    setError(null);
    setUploading(true);
    const form = new FormData();
    form.set("file", file);
    const res = await uploadImageAction(form);
    setUploading(false);
    if (res.url)
      editor
        .chain()
        .focus()
        .setImage({ src: res.url, alt: file.name.replace(/\.[^.]+$/, "") })
        .run();
    else setError(res.error ?? "Upload failed");
  };

  const editor = useEditor({
    immediatelyRender: false, // server-rendered page; mount on the client
    extensions: [
      ...contentExtensions,
      Markdown,
      Placeholder.configure({ placeholder }),
    ],
    content: value,
    contentType: "markdown",
    editorProps: {
      attributes: {
        class: cn(
          "prose-doc rich-editor px-5 py-4 outline-none sm:px-8",
          minHeight,
        ),
        ...(ariaLabel ? { "aria-label": ariaLabel } : {}),
      },
      handlePaste: (_view, event) => {
        const file = [...(event.clipboardData?.files ?? [])].find((f) =>
          f.type.startsWith("image/"),
        );
        if (!file || !editorRef.current) return false;
        void upload(file, editorRef.current);
        return true;
      },
      handleDrop: (_view, event) => {
        const file = [...(event.dataTransfer?.files ?? [])].find((f) =>
          f.type.startsWith("image/"),
        );
        if (!file || !editorRef.current) return false;
        event.preventDefault();
        void upload(file, editorRef.current);
        return true;
      },
    },
    onUpdate: ({ editor }) => {
      const md = tidyMarkdown(editor.getMarkdown());
      emitted.current = md;
      setMarkdown(md);
      onChange?.(md);
    },
  });
  editorRef.current = editor;

  // A parent can replace the content (e.g. switching document templates). Values this
  // editor emitted itself are ignored, so typing never round-trips back into setContent.
  useEffect(() => {
    if (!editor || value === emitted.current) return;
    emitted.current = value;
    setMarkdown(value);
    editor.commands.setContent(value, {
      contentType: "markdown",
      emitUpdate: false,
    });
  }, [editor, value]);

  return (
    <div className="flex flex-col rounded-xl border bg-card">
      {editor ? (
        <Toolbar
          editor={editor}
          uploading={uploading}
          onPickImage={(f) => upload(f, editor)}
        />
      ) : (
        <div className="h-11 border-b" />
      )}
      <EditorContent editor={editor} />
      {error && (
        <p role="alert" className="border-t px-4 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {name && <input type="hidden" name={name} value={markdown} />}
    </div>
  );
}

function Toolbar({
  editor,
  uploading,
  onPickImage,
}: {
  editor: Editor;
  uploading: boolean;
  onPickImage: (file: File) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      h1: e.isActive("heading", { level: 1 }),
      h2: e.isActive("heading", { level: 2 }),
      h3: e.isActive("heading", { level: 3 }),
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      strike: e.isActive("strike"),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      task: e.isActive("taskList"),
      quote: e.isActive("blockquote"),
      code: e.isActive("codeBlock"),
      link: e.isActive("link"),
      table: e.isActive("table"),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });
  const c = () => editor.chain().focus();

  const setLink = () => {
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", prev ?? "https://");
    if (url === null) return;
    if (url === "") c().unsetLink().run();
    else c().extendMarkRange("link").setLink({ href: url }).run();
  };

  return (
    <div className="sticky top-14 z-10 flex flex-col border-b bg-card/95 backdrop-blur lg:top-0">
      <div
        role="toolbar"
        aria-label="Formatting"
        className="flex flex-wrap items-center gap-0.5 p-1.5"
      >
        <Tool
          label="Heading 1"
          active={s.h1}
          onClick={() => c().toggleHeading({ level: 1 }).run()}
          icon={Heading1}
        />
        <Tool
          label="Heading 2"
          active={s.h2}
          onClick={() => c().toggleHeading({ level: 2 }).run()}
          icon={Heading2}
        />
        <Tool
          label="Heading 3"
          active={s.h3}
          onClick={() => c().toggleHeading({ level: 3 }).run()}
          icon={Heading3}
        />
        <Sep />
        <Tool
          label="Bold"
          active={s.bold}
          onClick={() => c().toggleBold().run()}
          icon={Bold}
        />
        <Tool
          label="Italic"
          active={s.italic}
          onClick={() => c().toggleItalic().run()}
          icon={Italic}
        />
        <Tool
          label="Strikethrough"
          active={s.strike}
          onClick={() => c().toggleStrike().run()}
          icon={Strikethrough}
        />
        <Tool label="Link" active={s.link} onClick={setLink} icon={Link2} />
        <Sep />
        <Tool
          label="Bulleted list"
          active={s.bullet}
          onClick={() => c().toggleBulletList().run()}
          icon={List}
        />
        <Tool
          label="Numbered list"
          active={s.ordered}
          onClick={() => c().toggleOrderedList().run()}
          icon={ListOrdered}
        />
        <Tool
          label="Checklist"
          active={s.task}
          onClick={() => c().toggleTaskList().run()}
          icon={ListChecks}
        />
        <Tool
          label="Quote"
          active={s.quote}
          onClick={() => c().toggleBlockquote().run()}
          icon={Quote}
        />
        <Tool
          label="Code block"
          active={s.code}
          onClick={() => c().toggleCodeBlock().run()}
          icon={Code}
        />
        <Tool
          label="Divider"
          onClick={() => c().setHorizontalRule().run()}
          icon={Minus}
        />
        <Sep />
        <Tool
          label="Insert table"
          active={s.table}
          onClick={() =>
            c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
          }
          icon={TableIcon}
        />
        <Tool
          label={uploading ? "Uploading image…" : "Insert image"}
          onClick={() => fileRef.current?.click()}
          icon={uploading ? Loader2 : ImagePlus}
          spin={uploading}
          disabled={uploading}
        />
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onPickImage(f);
            e.target.value = "";
          }}
        />
        <span className="ml-auto flex gap-0.5">
          <Tool
            label="Undo"
            disabled={!s.canUndo}
            onClick={() => c().undo().run()}
            icon={Undo2}
          />
          <Tool
            label="Redo"
            disabled={!s.canRedo}
            onClick={() => c().redo().run()}
            icon={Redo2}
          />
        </span>
      </div>
      {s.table && (
        <div className="flex flex-wrap gap-1 border-t px-2 py-1.5 text-xs">
          <span className="self-center px-1 text-muted-foreground">Table:</span>
          {[
            ["Row above", () => c().addRowBefore().run()],
            ["Row below", () => c().addRowAfter().run()],
            ["Column left", () => c().addColumnBefore().run()],
            ["Column right", () => c().addColumnAfter().run()],
            ["Delete row", () => c().deleteRow().run()],
            ["Delete column", () => c().deleteColumn().run()],
            ["Delete table", () => c().deleteTable().run()],
          ].map(([label, run]) => (
            <button
              key={label as string}
              type="button"
              onClick={run as () => void}
              className="rounded-md px-2 py-1 hover:bg-accent"
            >
              {label as string}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Tool({
  label,
  icon: Icon,
  onClick,
  active,
  disabled,
  spin,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  spin?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()} // keep the editor selection
      onClick={onClick}
      className={cn(
        "flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40",
        active && "bg-accent text-foreground",
      )}
    >
      <Icon className={cn("size-4", spin && "animate-spin")} />
    </button>
  );
}

const Sep = () => <span className="mx-1 h-5 w-px bg-border" />;
