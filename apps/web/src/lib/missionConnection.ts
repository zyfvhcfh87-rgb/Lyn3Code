export function isMissionEnvironmentUnavailable(
  environmentCatalogReady: boolean,
  connectionPhase: string | undefined,
): boolean {
  if (connectionPhase === undefined) return environmentCatalogReady;
  return connectionPhase !== "connected" && connectionPhase !== "connecting";
}
