import type { WorkflowInstance } from '../WorkflowDefinition';
import {
  createInstanceSession,
  resolveSessionForAction,
  type InstanceSession,
} from '../InstanceSession';

export interface InstanceActiveState {
  instance: WorkflowInstance | undefined;
  currentInstanceKey: string | undefined;
}

export class InstanceLifecycle {
  constructor(private readonly state: InstanceActiveState) {}

  getInstance(): WorkflowInstance | undefined {
    return this.state.instance;
  }

  getActiveInstanceKey(): string | undefined {
    return this.state.currentInstanceKey;
  }

  getActiveSession(): InstanceSession | undefined {
    if (!this.state.currentInstanceKey || !this.state.instance) {
      return undefined;
    }
    return createInstanceSession(this.state.currentInstanceKey, this.state.instance);
  }

  getActiveSessionId(): string | undefined {
    return this.state.currentInstanceKey;
  }

  resolveWebviewSessionId(
    webviewSessionId: string | undefined,
    executionDepth: number,
  ): string | undefined {
    const resolved = resolveSessionForAction({
      activeSessionId: this.state.currentInstanceKey,
      activeInstance: this.state.instance,
      webviewSessionId,
      executionDepth,
    });
    return resolved.sessionId;
  }

  setActive(key: string, inst: WorkflowInstance): void {
    this.state.currentInstanceKey = key;
    this.state.instance = inst;
  }

  clearActive(): void {
    this.state.instance = undefined;
    this.state.currentInstanceKey = undefined;
  }
}
