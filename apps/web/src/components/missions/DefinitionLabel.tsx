import type { ReactNode } from "react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { MISSION_GLOSSARY, type MissionGlossaryTerm } from "./missionGlossary";

/**
 * Attaches a mission term's definition to the text that names it.
 *
 * The dotted underline marks the word as explainable without turning it into a control. The
 * definition is also exposed through `title`, so it survives touch input and assistive technology
 * where a hover tooltip alone would not.
 */
export function DefinitionLabel({
  term,
  children,
  className,
}: {
  readonly term: MissionGlossaryTerm;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  const definition = MISSION_GLOSSARY[term];
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className={className}
            title={definition}
            style={{
              textDecoration: "underline dotted",
              textUnderlineOffset: "0.25em",
              textDecorationColor: "var(--color-muted-foreground)",
            }}
          >
            {children}
          </span>
        }
      />
      <TooltipPopup side="bottom" className="max-w-72">
        {definition}
      </TooltipPopup>
    </Tooltip>
  );
}
