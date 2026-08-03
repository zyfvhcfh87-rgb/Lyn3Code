import { Badge } from "../ui/badge";
import { MISSION_STATUS_LABELS, type MissionPresentationStatus } from "./MissionBoard.logic";

const STATUS_VARIANTS = {
  backlog: "secondary",
  planning: "info",
  ready: "info",
  running: "default",
  verification: "warning",
  review: "warning",
  blocked: "warning",
  completed: "success",
  failed: "error",
  cancelled: "secondary",
} as const;

export function MissionStatusBadge({ status }: { readonly status: MissionPresentationStatus }) {
  return <Badge variant={STATUS_VARIANTS[status]}>{MISSION_STATUS_LABELS[status]}</Badge>;
}
