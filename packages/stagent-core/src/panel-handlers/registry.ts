import type { PanelHandlerMap } from './types';
import { workspaceHandlers } from './workspace';
import { generationHandlers } from './generation';
import { executionHitlHandlers } from './execution-hitl';
import { executionUpstreamFixHandlers } from './execution-upstream-fix';
import { artifactsHandlers } from './artifacts';

export function buildPanelHandlerMap(): PanelHandlerMap {
  return {
    ...workspaceHandlers,
    ...generationHandlers,
    ...executionHitlHandlers,
    ...executionUpstreamFixHandlers,
    ...artifactsHandlers,
  };
}
