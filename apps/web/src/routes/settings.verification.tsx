import { createFileRoute } from "@tanstack/react-router";

import { VerificationSettingsPanel } from "../components/settings/VerificationSettings";

export const Route = createFileRoute("/settings/verification")({
  component: VerificationSettingsPanel,
});
