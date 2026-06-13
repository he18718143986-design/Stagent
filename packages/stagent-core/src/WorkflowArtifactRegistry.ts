import type { WorkflowDefinition } from './WorkflowDefinition';

/** M20.1：从工作流定义汇总将落盘到工作区/实例的相对路径与 Python 顶层模块名 */
export interface WorkflowArtifactRegistry {
  paths: string[];
  pythonModules: string[];
  pathSet: Set<string>;
  moduleSet: Set<string>;
}

export function normalizeArtifactRelativePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

/** `reader.py` → `reader`；`pkg/mod.py` → `mod`；`indicators/__init__.py` → `indicators` */
export function relativePathToPythonTopModule(relPath: string): string | undefined {
  const norm = normalizeArtifactRelativePath(relPath);
  if (!norm.endsWith('.py')) {
    return undefined;
  }
  if (norm.endsWith('/__init__.py')) {
    const pkg = norm.slice(0, -'/__init__.py'.length);
    if (!pkg) {
      return undefined;
    }
    const slash = pkg.lastIndexOf('/');
    return slash >= 0 ? pkg.slice(slash + 1) : pkg;
  }
  const withoutExt = norm.slice(0, -3);
  const slash = withoutExt.lastIndexOf('/');
  const base = slash >= 0 ? withoutExt.slice(slash + 1) : withoutExt;
  return base || undefined;
}

export function collectWorkflowArtifacts(wf: WorkflowDefinition): WorkflowArtifactRegistry {
  const pathSet = new Set<string>();
  const moduleSet = new Set<string>();

  const addPath = (filePath: string | undefined) => {
    if (!filePath?.trim()) {
      return;
    }
    const norm = normalizeArtifactRelativePath(filePath);
    pathSet.add(norm);
    const mod = relativePathToPythonTopModule(norm);
    if (mod) {
      moduleSet.add(mod);
    }
  };

  for (const s of wf.stages ?? []) {
    if (s.tool === 'llm-text') {
      const tc = s.toolConfig as { writeOutputToFile?: string };
      addPath(tc.writeOutputToFile);
    }
    if (s.tool === 'file-write') {
      const tc = s.toolConfig as { filePath?: string };
      addPath(tc.filePath);
    }
    if (s.tool === 'file-read') {
      const tc = s.toolConfig as { filePath?: string };
      addPath(tc.filePath);
    }
  }

  return {
    paths: [...pathSet].sort(),
    pythonModules: [...moduleSet].sort(),
    pathSet,
    moduleSet,
  };
}

export function artifactHasPythonModule(registry: WorkflowArtifactRegistry, moduleName: string): boolean {
  return registry.moduleSet.has(moduleName);
}

export function artifactHasRelativePath(registry: WorkflowArtifactRegistry, relPath: string): boolean {
  return registry.pathSet.has(normalizeArtifactRelativePath(relPath));
}
