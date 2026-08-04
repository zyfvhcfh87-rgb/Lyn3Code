import { SettingsPageContainer, SettingsRow, SettingsSection } from "../settings/settingsLayout";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { RoutingPolicyEditor } from "./RoutingPolicyEditor";
import { RoutingRegistryPanel } from "./RoutingRegistryPanel";
import { RoutingRoleDefaultsPanel } from "./RoutingRoleDefaultsPanel";
import { RoutingSimulator } from "./RoutingSimulator";
import { RoutingOverrideManager } from "./RoutingOverrideManager";
import type {
  RoutingDecisionDetailView,
  CapabilityCorrectionDraft,
  RoutingModelView,
  RoutingOverrideDraft,
  RoutingOverrideView,
  RoutingPolicyDraft,
  RoutingProviderView,
  RoutingRoleDefaultDraft,
  RoutingSelectOption,
  RoutingSimulatorDraft,
} from "./routingView";

export interface RoutingSettingsProps {
  readonly selectedProjectId: string;
  readonly onSelectedProjectIdChange: (projectId: string) => void;
  readonly providers: ReadonlyArray<RoutingProviderView>;
  readonly models: ReadonlyArray<RoutingModelView>;
  readonly isRefreshing: boolean;
  readonly onRefresh: () => void;
  readonly onManageCredentials: (providerId: string) => void;
  readonly isProviderSaving: (providerId: string) => boolean;
  readonly isModelSaving: (modelId: string) => boolean;
  readonly isCapabilitySaving: (modelId: string) => boolean;
  readonly onProviderEnabledChange: (providerId: string, enabled: boolean) => void;
  readonly onModelEnabledChange: (modelId: string, enabled: boolean) => void;
  readonly onModelDeprecatedChange: (modelId: string, deprecated: boolean) => void;
  readonly onModelConcurrencyChange: (modelId: string, limit: number | null) => void;
  readonly onSaveCapabilityCorrection: (modelId: string, draft: CapabilityCorrectionDraft) => void;
  readonly policyDraft: RoutingPolicyDraft;
  readonly providerOptions: ReadonlyArray<RoutingSelectOption>;
  readonly modelOptions: ReadonlyArray<RoutingSelectOption>;
  readonly reasoningOptions: ReadonlyArray<RoutingSelectOption>;
  readonly capabilityOptions: ReadonlyArray<RoutingSelectOption>;
  readonly policyValidationErrors: ReadonlyArray<string>;
  readonly isSavingPolicy: boolean;
  readonly onPolicyChange: (draft: RoutingPolicyDraft) => void;
  readonly onSavePolicy: () => void;
  readonly roleDrafts: ReadonlyArray<RoutingRoleDefaultDraft>;
  readonly isSavingRole: (role: string) => boolean;
  readonly onRoleChange: (draft: RoutingRoleDefaultDraft) => void;
  readonly onSaveRole: (role: string) => void;
  readonly overrideDraft: RoutingOverrideDraft;
  readonly overrides: ReadonlyArray<RoutingOverrideView>;
  readonly overrideScopeOptions: ReadonlyArray<RoutingSelectOption>;
  readonly fallbackOptions: ReadonlyArray<RoutingSelectOption>;
  readonly overrideValidationErrors: ReadonlyArray<string>;
  readonly isSavingOverride: boolean;
  readonly isRevokingOverride: (overrideId: string) => boolean;
  readonly onSaveOverride: (draft: RoutingOverrideDraft) => void;
  readonly onRevokeOverride: (overrideId: string) => void;
  readonly simulatorDraft: RoutingSimulatorDraft;
  readonly projectOptions: ReadonlyArray<RoutingSelectOption>;
  readonly missionOptions: ReadonlyArray<RoutingSelectOption>;
  readonly roleOptions: ReadonlyArray<RoutingSelectOption>;
  readonly taskTypeOptions: ReadonlyArray<RoutingSelectOption>;
  readonly complexityOptions: ReadonlyArray<RoutingSelectOption>;
  readonly privacyOptions: ReadonlyArray<RoutingSelectOption>;
  readonly simulatorResult: RoutingDecisionDetailView | null;
  readonly simulatorError: string | null;
  readonly isSimulating: boolean;
  readonly onSimulate: (draft: RoutingSimulatorDraft) => void;
}

export function RoutingSettings(props: RoutingSettingsProps) {
  return (
    <SettingsPageContainer>
      <SettingsSection title="Project routing scope">
        <SettingsRow
          title="Project"
          description="Policies, role defaults, overrides, and simulations below are evaluated for this project."
          control={
            <Select
              value={props.selectedProjectId}
              onValueChange={(projectId) => projectId && props.onSelectedProjectIdChange(projectId)}
            >
              <SelectTrigger className="w-full sm:w-72" aria-label="Routing project scope">
                <SelectValue>
                  {props.projectOptions.find((option) => option.value === props.selectedProjectId)
                    ?.label ?? "Choose project"}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {props.projectOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />
      </SettingsSection>
      <RoutingRegistryPanel
        providers={props.providers}
        models={props.models}
        isRefreshing={props.isRefreshing}
        onRefresh={props.onRefresh}
        onManageCredentials={props.onManageCredentials}
        isProviderSaving={props.isProviderSaving}
        isModelSaving={props.isModelSaving}
        isCapabilitySaving={props.isCapabilitySaving}
        onProviderEnabledChange={props.onProviderEnabledChange}
        onModelEnabledChange={props.onModelEnabledChange}
        onModelDeprecatedChange={props.onModelDeprecatedChange}
        onModelConcurrencyChange={props.onModelConcurrencyChange}
        onSaveCapabilityCorrection={props.onSaveCapabilityCorrection}
      />
      <RoutingPolicyEditor
        draft={props.policyDraft}
        providerOptions={props.providerOptions}
        modelOptions={props.modelOptions}
        reasoningOptions={props.reasoningOptions}
        capabilityOptions={props.capabilityOptions}
        validationErrors={props.policyValidationErrors}
        isSaving={props.isSavingPolicy}
        onChange={props.onPolicyChange}
        onSave={props.onSavePolicy}
      />
      <RoutingRoleDefaultsPanel
        drafts={props.roleDrafts}
        providerOptions={props.providerOptions}
        modelOptions={props.modelOptions}
        reasoningOptions={props.reasoningOptions}
        fallbackOptions={props.fallbackOptions}
        isSaving={props.isSavingRole}
        onChange={props.onRoleChange}
        onSave={props.onSaveRole}
      />
      <RoutingOverrideManager
        initialDraft={props.overrideDraft}
        overrides={props.overrides}
        scopeOptions={props.overrideScopeOptions}
        providerOptions={props.providerOptions}
        modelOptions={props.modelOptions}
        reasoningOptions={props.reasoningOptions}
        fallbackOptions={props.fallbackOptions}
        validationErrors={props.overrideValidationErrors}
        isSaving={props.isSavingOverride}
        isRevoking={props.isRevokingOverride}
        onSave={props.onSaveOverride}
        onRevoke={props.onRevokeOverride}
      />
      <RoutingSimulator
        initialDraft={props.simulatorDraft}
        projects={props.projectOptions}
        missions={props.missionOptions}
        roles={props.roleOptions}
        taskTypes={props.taskTypeOptions}
        complexities={props.complexityOptions}
        privacyModes={props.privacyOptions}
        capabilities={props.capabilityOptions}
        providers={props.providerOptions}
        models={props.modelOptions}
        result={props.simulatorResult}
        error={props.simulatorError}
        isSimulating={props.isSimulating}
        onSimulate={props.onSimulate}
      />
    </SettingsPageContainer>
  );
}
