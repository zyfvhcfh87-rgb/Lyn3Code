import { useState, type FormEvent } from "react";

import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";

export interface CreateMissionTaskInput {
  readonly title: string;
  readonly description: string;
}

export function CreateTaskDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onCreate: (input: CreateMissionTaskInput) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const normalizedTitle = title.trim();

  const setOpen = (nextOpen: boolean) => {
    if (!nextOpen && !isSubmitting) {
      setTitle("");
      setDescription("");
    }
    onOpenChange(nextOpen);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (normalizedTitle.length === 0 || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await onCreate({ title: normalizedTitle, description: description.trim() });
      setTitle("");
      setDescription("");
      onOpenChange(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogPopup>
        <form onSubmit={(event) => void handleSubmit(event)}>
          <DialogHeader>
            <DialogTitle>Add task</DialogTitle>
            <DialogDescription>
              Add a concrete unit of work to this mission. Tasks run one at a time in Phase 1.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="grid gap-4">
            <label className="grid gap-1.5">
              <span className="text-sm font-medium">Title</span>
              <Input
                autoFocus
                value={title}
                onChange={(event) => setTitle(event.currentTarget.value)}
                placeholder="Implement the server operation"
                maxLength={200}
              />
            </label>
            <label className="grid gap-1.5">
              <span className="text-sm font-medium">Description</span>
              <Textarea
                value={description}
                onChange={(event) => setDescription(event.currentTarget.value)}
                placeholder="Acceptance notes for the agent"
                rows={4}
              />
            </label>
          </DialogPanel>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isSubmitting}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={normalizedTitle.length === 0 || isSubmitting}>
              {isSubmitting ? "Adding..." : "Add task"}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
