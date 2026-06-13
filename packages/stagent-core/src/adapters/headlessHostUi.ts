/** autoAI headless stubs for vscode.window / workspace / commands / env. */

export async function showWarningMessage(_message: string): Promise<void> {}

export async function showInformationMessage(_message: string): Promise<void> {}

export async function openTextDocument(_source: string | { content: string; language?: string }): Promise<{ uri: { fsPath: string } }> {
  return { uri: { fsPath: '' } };
}

export async function showTextDocument(
  _doc: { uri: { fsPath: string } },
  _opts?: { preview?: boolean },
): Promise<void> {}

export async function executeCommand(_command: string, ..._args: unknown[]): Promise<void> {}

export async function clipboardWriteText(_text: string): Promise<void> {}
