export type MissionDependencyPreflight =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: "self" | "duplicate" | "cycle" };

export function preflightMissionDependency<TaskId extends string>(
  edges: ReadonlyArray<Readonly<{ taskId: TaskId; dependsOnTaskId: TaskId }>>,
  taskId: TaskId,
  dependsOnTaskId: TaskId,
): MissionDependencyPreflight {
  if (taskId === dependsOnTaskId) {
    return { allowed: false, reason: "self" };
  }

  if (edges.some((edge) => edge.taskId === taskId && edge.dependsOnTaskId === dependsOnTaskId)) {
    return { allowed: false, reason: "duplicate" };
  }

  const dependenciesByTask = new Map<TaskId, TaskId[]>();
  for (const edge of edges) {
    const dependencies = dependenciesByTask.get(edge.taskId);
    if (dependencies) {
      dependencies.push(edge.dependsOnTaskId);
    } else {
      dependenciesByTask.set(edge.taskId, [edge.dependsOnTaskId]);
    }
  }

  const pending = [dependsOnTaskId];
  const visited = new Set<TaskId>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || visited.has(current)) continue;
    if (current === taskId) {
      return { allowed: false, reason: "cycle" };
    }
    visited.add(current);
    pending.push(...(dependenciesByTask.get(current) ?? []));
  }

  return { allowed: true };
}

export function missionDependencyLayers<TaskId extends string>(
  taskIds: ReadonlyArray<TaskId>,
  edges: ReadonlyArray<Readonly<{ taskId: TaskId; dependsOnTaskId: TaskId }>>,
): ReadonlyArray<ReadonlyArray<TaskId>> {
  const knownTaskIds = new Set(taskIds);
  const dependenciesByTask = new Map<TaskId, Set<TaskId>>(
    taskIds.map((taskId) => [taskId, new Set<TaskId>()]),
  );
  for (const edge of edges) {
    if (!knownTaskIds.has(edge.taskId) || !knownTaskIds.has(edge.dependsOnTaskId)) continue;
    dependenciesByTask.get(edge.taskId)?.add(edge.dependsOnTaskId);
  }

  const remaining = new Set(taskIds);
  const completed = new Set<TaskId>();
  const layers: TaskId[][] = [];

  while (remaining.size > 0) {
    const layer = taskIds.filter(
      (taskId) =>
        remaining.has(taskId) &&
        [...(dependenciesByTask.get(taskId) ?? [])].every((dependencyId) =>
          completed.has(dependencyId),
        ),
    );

    if (layer.length === 0) {
      layers.push(taskIds.filter((taskId) => remaining.has(taskId)));
      break;
    }

    layers.push(layer);
    for (const taskId of layer) {
      remaining.delete(taskId);
      completed.add(taskId);
    }
  }

  return layers;
}
