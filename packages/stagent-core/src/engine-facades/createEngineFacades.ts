import type { HostExtensionContext } from '../platform/HostTypes';
import type { WorkflowEngineDiagnostics } from '../WorkflowEngineDiagnostics';
import type { WorkflowEngineGenerationFacade } from './WorkflowEngineFacades';
import type { WorkflowEngineHostRegistry } from '../WorkflowEngineHostRegistry';
import type { WorkflowEngineInternals } from '../WorkflowEngineInternals';
import type { WorkflowGenerationService } from '../WorkflowGenerationService';
import type { WorkflowInstanceManager } from '../WorkflowInstanceManager';
import type { WorkflowUiBridge } from '../WorkflowUiBridge';
import type { EngineLlmPort } from '../platform/EngineLlmPort';
import { WorkflowInstanceFacadeImpl } from './WorkflowInstanceFacadeImpl';
import { WorkflowExecutionFacadeImpl } from './WorkflowExecutionFacadeImpl';
import { WorkflowHitlFacadeImpl } from './WorkflowHitlFacadeImpl';
import { WorkflowArtifactFacadeImpl } from './WorkflowArtifactFacadeImpl';

export interface CreateEngineFacadesParams {
  context: HostExtensionContext;
  instanceManager: WorkflowInstanceManager;
  generationService: WorkflowGenerationService;
  ui: WorkflowUiBridge;
  diagnostics: WorkflowEngineDiagnostics;
  llm: EngineLlmPort;
  hostRegistry: WorkflowEngineHostRegistry;
  getInternals: () => WorkflowEngineInternals;
  getExecutionDepth: () => number;
  getPreferredModelFamily: () => string;
  setPreferredModelFamily: (modelFamily: string) => void;
}

export interface EngineFacades {
  instances: WorkflowInstanceFacadeImpl;
  generation: WorkflowEngineGenerationFacade;
  execution: WorkflowExecutionFacadeImpl;
  hitl: WorkflowHitlFacadeImpl;
  artifacts: WorkflowArtifactFacadeImpl;
}

export function createEngineFacades(params: CreateEngineFacadesParams): EngineFacades {
  return {
    instances: new WorkflowInstanceFacadeImpl(params.instanceManager),
    generation: params.generationService,
    execution: new WorkflowExecutionFacadeImpl({
      ui: params.ui,
      hostRegistry: params.hostRegistry,
      getInternals: params.getInternals,
      getExecutionDepth: params.getExecutionDepth,
      getPreferredModelFamily: params.getPreferredModelFamily,
      setPreferredModelFamily: params.setPreferredModelFamily,
    }),
    hitl: new WorkflowHitlFacadeImpl({
      hostRegistry: params.hostRegistry,
      instanceManager: params.instanceManager,
      diagnostics: params.diagnostics,
    }),
    artifacts: new WorkflowArtifactFacadeImpl({
      context: params.context,
      hostRegistry: params.hostRegistry,
      instanceManager: params.instanceManager,
      diagnostics: params.diagnostics,
    }),
  };
}
