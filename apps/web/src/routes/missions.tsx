import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
  useLocation,
  useNavigate,
} from "@tanstack/react-router";
import { ServerIcon } from "lucide-react";
import { useEffect } from "react";

import { Button } from "../components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../components/ui/empty";
import { SidebarInset } from "../components/ui/sidebar";
import { useActiveEnvironmentId } from "../state/entities";
import { useEnvironments } from "../state/environments";

function MissionEnvironmentLanding() {
  const navigate = useNavigate();
  const activeEnvironmentId = useActiveEnvironmentId();
  const { environments, isReady } = useEnvironments();
  const targetEnvironmentId =
    (activeEnvironmentId &&
    environments.some((environment) => environment.environmentId === activeEnvironmentId)
      ? activeEnvironmentId
      : environments[0]?.environmentId) ?? null;

  useEffect(() => {
    if (!targetEnvironmentId) return;
    void navigate({
      to: "/missions/$environmentId",
      params: { environmentId: targetEnvironmentId },
      replace: true,
    });
  }, [navigate, targetEnvironmentId]);

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden bg-background text-foreground">
      {isReady && targetEnvironmentId === null ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ServerIcon />
            </EmptyMedia>
            <EmptyTitle>Connect an environment</EmptyTitle>
            <EmptyDescription>
              Missions execute on a T3 server, so an environment must be connected first.
            </EmptyDescription>
            <Button className="mt-4" render={<Link to="/settings/connections" />}>
              Open connections
            </Button>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid flex-1 place-items-center text-sm text-muted-foreground" role="status">
          Opening missions...
        </div>
      )}
    </SidebarInset>
  );
}

function MissionsRouteLayout() {
  const pathname = useLocation({ select: (location) => location.pathname });
  return pathname === "/missions" ? <MissionEnvironmentLanding /> : <Outlet />;
}

export const Route = createFileRoute("/missions")({
  beforeLoad: async ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  component: MissionsRouteLayout,
});
