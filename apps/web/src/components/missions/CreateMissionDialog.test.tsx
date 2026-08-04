import { describe, expect, it } from "vite-plus/test";

import { missionProjectTitle } from "./CreateMissionDialog";

describe("CreateMissionDialog", () => {
  it("renders the selected project title instead of its internal id", () => {
    const projects = [{ id: "56cd8c83-d275-4846-8ff8-5c6e2c6a4bb3", title: "Lyn3Code" }];

    expect(missionProjectTitle(projects, projects[0]!.id)).toBe("Lyn3Code");
    expect(missionProjectTitle(projects, "missing-project")).toBeUndefined();
  });
});
