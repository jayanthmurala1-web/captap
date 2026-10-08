"use client";

import { CircleAlert, Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";
import { RichEditor } from "@/components/rich-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OptionSelect } from "@/components/ui/option-select";
import { saveDocumentDirectAction } from "../actions";

type Doc = {
  id: string;
  title: string;
  content: string;
  visibility: string;
  currentVersion: number;
};

export function DocumentBody({
  doc,
  canEdit,
  rendered,
}: {
  doc: Doc;
  canEdit: boolean;
  rendered: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [savedFrom, setSavedFrom] = useState<number | null>(null);

  // Close the editor only once the refreshed page delivers the new version,
  // so the reader never sees the old content flash back after saving.
  useEffect(() => {
    if (savedFrom !== null && doc.currentVersion > savedFrom) {
      setEditing(false);
      setSavedFrom(null);
    }
  }, [doc.currentVersion, savedFrom]);

  if (!editing) {
    return (
      <div className="flex flex-col gap-4">
        {canEdit && (
          <Button
            variant="outline"
            size="sm"
            className="self-end"
            onClick={() => setEditing(true)}
          >
            <Pencil />
            Edit
          </Button>
        )}
        <article className="rounded-2xl border bg-card px-5 py-6 sm:px-8 sm:py-8">
          {rendered}
        </article>
      </div>
    );
  }
  return (
    <Editor
      doc={doc}
      onCancel={() => setEditing(false)}
      onSaved={() => setSavedFrom(doc.currentVersion)}
    />
  );
}

function Editor({
  doc,
  onCancel,
  onSaved,
}: {
  doc: Doc;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(doc.title);
  const [content, setContent] = useState(doc.content);
  const [visibility, setVisibility] = useState(doc.visibility);
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, start] = useTransition();
  const dirty =
    title !== doc.title ||
    content !== doc.content ||
    visibility !== doc.visibility;

  const save = useCallback(
    () =>
      start(async () => {
        setErrors([]);
        const res = await saveDocumentDirectAction({
          id: doc.id,
          baseVersion: doc.currentVersion,
          title,
          content,
          note: note.trim() || undefined,
          visibility: visibility === "published" ? "published" : "draft",
        });
        if (!res.ok) {
          // The PRD linter reports several problems joined with "; ".
          setErrors((res.error ?? "Couldn't save").split("; "));
          return;
        }
        onSaved();
        router.refresh();
      }),
    [
      doc.id,
      doc.currentVersion,
      title,
      content,
      note,
      visibility,
      router,
      onSaved,
    ],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (dirty && !pending) save();
      }
    };
    const onLeave = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("beforeunload", onLeave);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("beforeunload", onLeave);
    };
  }, [dirty, pending, save]);

  return (
    <div className="flex flex-col gap-4">
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        aria-label="Title"
        className="h-10 text-base font-medium"
      />

      <RichEditor
        value={doc.content}
        onChange={setContent}
        ariaLabel="Document content"
        minHeight="min-h-[60vh]"
      />

      {errors.length > 0 && (
        <div
          role="alert"
          className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm"
        >
          <p className="flex items-center gap-2 font-medium text-destructive">
            <CircleAlert className="size-4" />
            Not saved
          </p>
          <ul className="mt-1.5 list-disc pl-6">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-end">
        <label htmlFor="version-note" className="flex-1 text-sm">
          <span className="mb-1 block text-muted-foreground">
            What changed? (optional)
          </span>
          <Input
            id="version-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Added Apple Pay to acceptance criteria"
          />
        </label>
        <div className="text-sm">
          <span className="mb-1 block text-muted-foreground">Status</span>
          <OptionSelect
            label="Status"
            value={visibility}
            onValueChange={setVisibility}
            className="w-36"
            options={[
              { value: "draft", label: "Draft" },
              { value: "published", label: "Published" },
            ]}
          />
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={save} disabled={pending || !dirty}>
            {pending ? "Saving…" : `Save as v${doc.currentVersion + 1}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
