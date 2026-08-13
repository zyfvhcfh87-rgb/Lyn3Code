import type { ReactElement, ReactNode } from "react";
import { ArrowUpRightIcon } from "lucide-react";

import { Button } from "../ui/button";

/**
 * A quiet link from a mission section to the workspace that configures or extends it.
 *
 * Mission work spans routing, verification, GitHub, memory, and analytics, each of which shipped as
 * its own route. Without these, reaching any of them from a mission means knowing where it lives.
 * Styled as a low-emphasis trailing action so it stays subordinate to the section's own controls.
 *
 * Takes the `Link` element through `render` rather than proxying its props, so each call site keeps
 * the router's own checking of `to` against `params`.
 */
export function MissionSectionLink({
  render,
  children,
}: {
  readonly render: ReactElement;
  readonly children: ReactNode;
}) {
  return (
    <Button className="ml-auto text-muted-foreground" size="sm" variant="ghost" render={render}>
      {children}
      <ArrowUpRightIcon />
    </Button>
  );
}
