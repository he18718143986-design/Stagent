export async function resolvePriorFailurePattern(_input: {
  taskType: string;
  stageId: string;
  workspaceRoot?: string;
  enabled: boolean;
  warn?: (message: string) => void;
}): Promise<string | undefined> {
  return undefined;
}
