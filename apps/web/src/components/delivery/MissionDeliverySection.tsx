import { PackageCheckIcon } from "lucide-react";
import type { ReactNode } from "react";

import { DefinitionLabel } from "../missions/DefinitionLabel";
import { DeliveryWorkspace, type DeliveryWorkspaceProps } from "./DeliveryWorkspace";
import { deliveryConfigurationIsEmpty, missionDeliveryIsEmpty } from "./deliveryScope";
import { DeliveryNotice } from "./DeliveryPrimitives";

function DeliverySection({ children }: { readonly children: ReactNode }) {
  return (
    <section aria-labelledby="mission-delivery-heading" className="grid gap-3">
      <div className="flex items-center gap-2">
        <PackageCheckIcon className="size-4 text-muted-foreground" />
        <h2 id="mission-delivery-heading" className="text-sm font-semibold">
          <DefinitionLabel term="delivery">Delivery</DefinitionLabel>
        </h2>
      </div>
      {children}
    </section>
  );
}

/**
 * Expects a snapshot already narrowed by `scopeDeliverySnapshotToMission`, so emptiness is measured
 * against this mission's activity rather than the project's configuration.
 *
 * An absent `delivery` prop means the snapshot has not arrived yet, which is a loading state and
 * says nothing about delivery. Every other case renders the heading, so the capability stays
 * discoverable instead of disappearing until someone configures it elsewhere.
 */
export function MissionDeliverySection({
  delivery,
}: {
  readonly delivery?: DeliveryWorkspaceProps | undefined;
}) {
  if (!delivery) return null;

  const unconfigured =
    delivery.state === "empty" ||
    (delivery.state === "ready" &&
      missionDeliveryIsEmpty(delivery.snapshot) &&
      deliveryConfigurationIsEmpty(delivery.snapshot));

  if (unconfigured) {
    return (
      <DeliverySection>
        <DeliveryNotice title="No controlled delivery configured" tone="neutral" role="status">
          Controlled delivery carries verified mission work through merge, release, deployment, and
          rollback as separate approved steps. It needs a delivery policy and a repository-backed
          release or deployment target for this project before a promotion can be planned.
        </DeliveryNotice>
      </DeliverySection>
    );
  }

  // A mission with no delivery records of its own still renders the workspace, because that is
  // where the release and deployment proposal forms live - hiding it behind the notice would leave
  // a configured project no way to start a mission's first delivery.
  const missionIdle = delivery.state === "ready" && missionDeliveryIsEmpty(delivery.snapshot);

  return (
    <DeliverySection>
      {missionIdle ? (
        <DeliveryNotice title="No delivery activity for this mission" tone="neutral" role="status">
          Nothing has been assessed, approved, released, or deployed for this mission yet. Delivery
          begins with a merge-readiness assessment of a verified source revision; the
          project&rsquo;s configured release and deployment targets are available below.
        </DeliveryNotice>
      ) : null}
      <div className="space-y-6">
        <DeliveryWorkspace {...delivery} />
      </div>
    </DeliverySection>
  );
}
