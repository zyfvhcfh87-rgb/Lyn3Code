import { describe, expect, it } from "@effect/vitest";
import { MissionTaskId, TaskRoutingAssessmentId } from "@t3tools/contracts";

import {
  assessTaskDeterministically,
  persistedAssessmentForRouting,
  toTaskRoutingAssessment,
} from "./TaskAssessment.ts";

describe("TaskAssessment", () => {
  it("classifies a cross-package architectural migration deterministically", () => {
    const input = {
      roleKind: "implementer" as const,
      title: "Implement architecture migration",
      description: "Move the mission scheduler across packages.",
      writeAccessRequired: true,
      architectureChange: true,
      databaseMigration: true,
      crossPackageImpact: true,
      verificationBreadth: "broad" as const,
      estimatedSourceTokens: 60_000,
    };

    expect(assessTaskDeterministically(input)).toEqual(assessTaskDeterministically(input));
    expect(assessTaskDeterministically(input)).toMatchObject({
      taskType: "architecture",
      complexity: "very_high",
      recommendedReasoningLevel: "extra_high",
      source: "deterministic",
    });
  });

  it("keeps model and harness requirements separate", () => {
    const assessment = assessTaskDeterministically({
      roleKind: "implementer",
      title: "Fix image attachment editing",
      description: "Use the existing tool harness.",
      writeAccessRequired: true,
      attachmentKinds: ["image", "file", "audio"],
      structuredOutputRequired: true,
      requiredTools: ["shell"],
    });

    expect(assessment.requiredModelCapabilities).toEqual([
      "audio_input",
      "file_input",
      "structured_output",
      "tool_calling",
      "vision_input",
    ]);
    expect(assessment.requiredHarnessCapabilities).toEqual(["codeEditing", "toolExecution"]);
    expect(assessment.requiredModalities).toEqual(["image", "audio", "file"]);
  });

  it("classifies repair work from verification evidence without text guessing", () => {
    expect(
      assessTaskDeterministically({
        roleKind: "repair_agent",
        title: "Do the thing",
        description: "The verifier supplied a focused handoff.",
        writeAccessRequired: true,
        verificationCategory: "test_failure",
      }).taskType,
    ).toBe("repair");
  });

  it("materializes the exact durable assessment contract", () => {
    const deterministic = assessTaskDeterministically({
      roleKind: "researcher",
      title: "Research an API",
      description: "Compare official sources.",
      writeAccessRequired: false,
    });
    const persisted = toTaskRoutingAssessment({
      assessment: deterministic,
      id: TaskRoutingAssessmentId.make("assessment-1"),
      taskId: MissionTaskId.make("task-1"),
      version: 1,
      createdAt: "2026-08-03T10:00:00.000Z",
      updatedAt: "2026-08-03T10:00:00.000Z",
    });

    expect(persisted).toMatchObject({
      taskType: "research",
      assessmentSource: "system",
      version: 1,
      supersededById: null,
    });
    expect(persistedAssessmentForRouting(persisted)).toMatchObject({
      taskType: "research",
      source: "system",
      requiredHarnessCapabilities: [],
    });
  });
});
