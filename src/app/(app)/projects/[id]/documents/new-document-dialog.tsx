"use client";

import { CircleAlert, Plus } from "lucide-react";
import { useActionState, useState } from "react";
import { RichEditor } from "@/components/rich-editor";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OptionSelect } from "@/components/ui/option-select";
import { docTemplate, docTypeLabel } from "@/lib/doc-types";
import {
  createDocumentAction,
  type FormState,
} from "../../../documents/actions";

const TYPES = [
  "prd",
  "brief",
  "brd",
  "pr_faq",
  "strategy_memo",
  "hld",
  "lld",
  "erd",
  "general",
];

export function NewDocumentDialog({ projectId }: { projectId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    createDocumentAction,
    undefined,
  );
  const [docType, setDocType] = useState("prd");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState(docTemplate("prd"));
  const [touched, setTouched] = useState(false);

  const pickType = (t: string) => {
    setDocType(t);
    // Swap the starter text only if the user hasn't started writing.
    if (!touched) setContent(docTemplate(t));
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus />
          New document
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New document</DialogTitle>
          <DialogDescription>
            {docType === "prd"
              ? "PRDs are checked on save: a Problem & Context of 50+ words, at least 2 Non-Goals, and Acceptance Criteria."
              : "Write in markdown. You can keep editing after it's created."}
          </DialogDescription>
        </DialogHeader>
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="projectId" value={projectId} />
          <input
            type="hidden"
            name="kind"
            value={docType === "prd" ? "prd" : "doc"}
          />
          <input type="hidden" name="visibility" value="draft" />
          <div className="grid gap-4 sm:grid-cols-[1fr_200px]">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="doc-title">Title</Label>
              <Input
                id="doc-title"
                name="title"
                required
                maxLength={200}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Checkout PRD"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="doc-type">Type</Label>
              <OptionSelect
                id="doc-type"
                name="docType"
                value={docType}
                onValueChange={pickType}
                options={TYPES.map((t) => ({
                  value: t,
                  label: docTypeLabel(t),
                }))}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Content</span>
            <RichEditor
              name="content"
              value={content}
              minHeight="min-h-72"
              ariaLabel="Document content"
              onChange={(md) => {
                setContent(md);
                setTouched(true);
              }}
            />
          </div>
          {state?.error && (
            <div
              role="alert"
              className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm"
            >
              <p className="flex items-center gap-2 font-medium text-destructive">
                <CircleAlert className="size-4" />
                Not created yet
              </p>
              <ul className="mt-1.5 list-disc pl-6">
                {state.error.split("; ").map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </div>
          )}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Creating…" : "Create draft"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
