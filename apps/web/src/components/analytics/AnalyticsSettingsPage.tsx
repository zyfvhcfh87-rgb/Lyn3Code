import { SettingsPageContainer } from "../settings/settingsLayout";
import { AnalyticsWorkspace, type AnalyticsWorkspaceProps } from "./AnalyticsWorkspace";

export function AnalyticsSettingsPage(props: AnalyticsWorkspaceProps) {
  return (
    <SettingsPageContainer className="max-w-6xl">
      <AnalyticsWorkspace {...props} />
    </SettingsPageContainer>
  );
}
