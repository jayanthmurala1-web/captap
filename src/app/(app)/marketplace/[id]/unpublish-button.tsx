"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { unpublishSkillAction } from "../actions";

export function UnpublishButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const unpublish = async () => {
    setPending(true);
    const form = new FormData();
    form.set("id", id);
    await unpublishSkillAction(form);
    router.push("/marketplace");
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={unpublish}
      disabled={pending}
      className="self-start text-destructive hover:text-destructive"
    >
      {pending ? "Unpublishing…" : "Unpublish from marketplace"}
    </Button>
  );
}
