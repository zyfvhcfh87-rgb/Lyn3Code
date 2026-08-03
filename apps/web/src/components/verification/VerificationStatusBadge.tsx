import { Badge } from "../ui/badge";
import {
  type VerificationDisplayStatus,
  verificationStatusLabel,
  verificationStatusVariant,
} from "./verificationDisplay";

export function VerificationStatusBadge({
  status,
}: {
  readonly status: VerificationDisplayStatus;
}) {
  return (
    <Badge variant={verificationStatusVariant(status)}>{verificationStatusLabel(status)}</Badge>
  );
}
