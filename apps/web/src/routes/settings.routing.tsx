import { createFileRoute } from "@tanstack/react-router";

import { RoutingSettingsPage } from "../components/routing/RoutingSettingsPage";

export const Route = createFileRoute("/settings/routing")({
  component: RoutingSettingsPage,
});
