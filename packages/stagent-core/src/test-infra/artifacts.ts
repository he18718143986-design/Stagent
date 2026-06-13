export interface TestInfraArtifacts {
  jest: boolean;
  babel: boolean;
  tsconfig: boolean;
}

export function emptyTestInfraArtifacts(): TestInfraArtifacts {
  return { jest: false, babel: false, tsconfig: false };
}

export function mergeInfra(a: TestInfraArtifacts, b: TestInfraArtifacts): TestInfraArtifacts {
  return {
    jest: a.jest || b.jest,
    babel: a.babel || b.babel,
    tsconfig: a.tsconfig || b.tsconfig,
  };
}

/** M39.1 / M38.1 共用：Expo 须 jest+babel；否则 jest、babel、tsconfig 三选一。 */
export function testInfraSatisfied(expo: boolean, artifacts: TestInfraArtifacts): boolean {
  if (expo) {
    return artifacts.jest && artifacts.babel;
  }
  return artifacts.jest || artifacts.babel || artifacts.tsconfig;
}
