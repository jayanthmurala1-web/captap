"use client";

import { LogOut, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  leaveOrganizationAction,
  removeMemberAction,
  renameOrganizationAction,
} from "./role-actions";

export function RemoveMemberButton({
  userId,
  name,
}: {
  userId: string;
  name: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const remove = () =>
    start(async () => {
      const res = await removeMemberAction(userId);
      setError(res?.error ?? null);
      if (!res?.error) setOpen(false);
    });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-destructive"
        >
          <Trash2 />
          Remove
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove {name}?</DialogTitle>
          <DialogDescription>
            They lose access to this workspace immediately and are taken off
            every project. Tasks assigned to them become unassigned, and work
            they&apos;d claimed but not yet submitted goes back to To do so
            someone else can pick it up. Work already in review is left as it
            is.
          </DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button variant="destructive" onClick={remove} disabled={pending}>
            {pending ? "Removing…" : "Remove"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RenameOrgForm({ orgName }: { orgName: string }) {
  const [name, setName] = useState(orgName);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = () =>
    start(async () => {
      setSaved(false);
      const res = await renameOrganizationAction(name);
      setError(res?.error ?? null);
      if (!res?.error) setSaved(true);
    });

  return (
    <div className="flex items-end gap-2">
      <div className="flex flex-1 flex-col gap-1.5">
        <Label htmlFor="org-name">Workspace name</Label>
        <Input
          id="org-name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setSaved(false);
          }}
          maxLength={120}
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        {saved && <p className="text-sm text-success">Saved</p>}
      </div>
      <Button
        onClick={save}
        disabled={pending || !name.trim() || name.trim() === orgName}
      >
        {pending ? "Saving…" : "Save"}
      </Button>
    </div>
  );
}

export function LeaveOrgButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const leave = () =>
    start(async () => {
      const res = await leaveOrganizationAction();
      if (res?.error) {
        setError(res.error);
        return;
      }
      router.push("/");
      router.refresh();
    });

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="self-start text-destructive hover:text-destructive"
        >
          <LogOut />
          Leave workspace
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Leave this workspace?</DialogTitle>
          <DialogDescription>
            You lose access immediately. Someone with an invite link (or another
            owner) would need to re-invite you to come back.
          </DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button variant="destructive" onClick={leave} disabled={pending}>
            {pending ? "Leaving…" : "Leave workspace"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
