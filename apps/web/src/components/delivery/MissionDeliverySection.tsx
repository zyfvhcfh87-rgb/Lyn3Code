import { PackageCheckIcon } from "lucide-react";

import { DeliveryWorkspace, type DeliveryWorkspaceProps } from "./DeliveryWorkspace";
import { missionDeliveryIsEmpty } from "./deliveryScope";

/**
 * Expects a snapshot already narrowed by `scopeDeliverySnapshotToMission`, so emptiness is measured
 * against this mission's activity rather than the project's configuration.
 */
export function MissionDeliverySection({
  delivery,
}: {
  delivery?: DeliveryWorkspaceProps | undefined;
}) {
  if (
    !delivery ||
    delivery.state === "empty" ||
    (delivery.state === "ready" && missionDeliveryIsEmpty(delivery.snapshot))
  ) {
    return null;
  }

  return (
    <section aria-labelledby="mission-delivery-heading" className="grid gap-3">
      <div className="flex items-center gap-2">
        <PackageCheckIcon className="size-4 text-muted-foreground" />
        <h2 id="mission-delivery-heading" className="text-sm font-semibold">
          Delivery
        </h2>
      </div>
      <div className="space-y-6">
        <DeliveryWorkspace {...delivery} />
      </div>
    </section>
  );
}
