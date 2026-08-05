import type {
  AnalyticsAggregateRebuildInput,
  AnalyticsAlertAcknowledgeInput,
  AnalyticsAnnotationSaveInput,
  AnalyticsExportCreateInput,
  AnalyticsRetentionStartInput,
  AnalyticsSettingsUpdateInput,
  BudgetEventAcknowledgeInput,
  BudgetOverrideCreateInput,
  BudgetPolicySaveInput,
  HumanDispositionRecordInput,
  ExchangeRateSnapshotSaveInput,
  PricingSnapshotSaveInput,
  SubscriptionAttributionRuleSaveInput,
} from "@t3tools/contracts";

export interface AnalyticsWorkspaceActions {
  readonly updateSettings: (input: AnalyticsSettingsUpdateInput) => Promise<boolean>;
  readonly savePricingSnapshot: (input: PricingSnapshotSaveInput) => Promise<boolean>;
  readonly saveSubscriptionAttributionRule: (
    input: SubscriptionAttributionRuleSaveInput,
  ) => Promise<boolean>;
  readonly saveExchangeRateSnapshot: (input: ExchangeRateSnapshotSaveInput) => Promise<boolean>;
  readonly saveBudget: (input: BudgetPolicySaveInput) => Promise<boolean>;
  readonly acknowledgeBudgetEvent: (input: BudgetEventAcknowledgeInput) => Promise<boolean>;
  readonly createBudgetOverride: (input: BudgetOverrideCreateInput) => Promise<boolean>;
  readonly acknowledgeAlert: (input: AnalyticsAlertAcknowledgeInput) => Promise<boolean>;
  readonly saveAnnotation: (input: AnalyticsAnnotationSaveInput) => Promise<boolean>;
  readonly recordHumanDisposition: (input: HumanDispositionRecordInput) => Promise<boolean>;
  readonly createExport: (input: AnalyticsExportCreateInput) => Promise<boolean>;
  readonly startRetention: (input: AnalyticsRetentionStartInput) => Promise<boolean>;
  readonly rebuildAggregates: (input: AnalyticsAggregateRebuildInput) => Promise<boolean>;
}
