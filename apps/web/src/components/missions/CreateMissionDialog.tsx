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
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";

export interface CreateMissionInput {
  readonly projectId: string;
  readonly title: string;
  readonly description: string;
}

export interface CreateMissionProjectOption {
  readonly id: string;
  readonly title: string;
}

export const missionProjectTitle = (
  projects: ReadonlyArray<CreateMissionProjectOption>,
  projectId: string,
) => projects.find((project) => project.id === projectId)?.title;

export function CreateMissionDialog({
  open,
  projects,
  selectedProjectId,
  onOpenChange,
  onCreate,
}: {
  readonly open: boolean;
  readonly projects: ReadonlyArray<CreateMissionProjectOption>;
  readonly selectedProjectId: string | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onCreate: (input: CreateMissionInput) => Promise<boolean>;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState(selectedProjectId ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const normalizedTitle = title.trim();
  const selectedProjectTitle = missionProjectTitle(projects, projectId);

  const setOpen = (nextOpen: boolean) => {
    if (!nextOpen && !isSubmitting) {
      setTitle("");
      setDescription("");
      setProjectId(selectedProjectId ?? "");
    }
    onOpenChange(nextOpen);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!projectId || normalizedTitle.length === 0 || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const created = await onCreate({
        projectId,
        title: normalizedTitle,
        description: description.trim(),
      });
      if (!created) return;
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
            <DialogTitle>Create mission</DialogTitle>
            <DialogDescription>
              Define the outcome. You can add and order tasks in the mission workspace.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="grid gap-4">
            <label className="grid gap-1.5">
              <span className="text-sm font-medium">Project</span>
              <Select
                value={projectId || null}
                onValueChange={(value) => setProjectId(value ?? "")}
              >
                <SelectTrigger aria-label="Mission project">
                  <SelectValue placeholder="Choose a project">{selectedProjectTitle}</SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.title}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </label>
            <label className="grid gap-1.5">
              <span className="text-sm font-medium">Title</span>
              <Input
                autoFocus
                value={title}
                onChange={(event) => setTitle(event.currentTarget.value)}
                placeholder="Ship the new onboarding flow"
                maxLength={200}
              />
            </label>
            <label className="grid gap-1.5">
              <span className="text-sm font-medium">Description</span>
              <Textarea
                value={description}
                onChange={(event) => setDescription(event.currentTarget.value)}
                placeholder="What should the agent accomplish?"
                rows={5}
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
            <Button
              type="submit"
              disabled={!projectId || normalizedTitle.length === 0 || isSubmitting}
            >
              {isSubmitting ? "Creating..." : "Create mission"}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
