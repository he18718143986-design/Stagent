/**
 * QualityGate dependsOn 与 priority 启动期自检 — 防止重排 priority 时静默破坏执行顺序。
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { QualityGateRegistry } from '../QualityGate';
import { registerBuiltinQualityGates } from '../BuiltinQualityGates';

test('registerBuiltinQualityGates: builtin dependsOn 与 priority 无矛盾', () => {
  const registry = new QualityGateRegistry();
  registerBuiltinQualityGates(registry);
  const issues = registry.validateDependencies();
  assert.equal(
    issues.length,
    0,
    issues.map((i) => `${i.kind} ${i.gateId}->${i.dependsOnId}: ${i.message}`).join('\n'),
  );
});

test('validateDependencies: priority-order 矛盾可被检出', () => {
  const registry = new QualityGateRegistry();
  registry.register({
    id: 'gate-a',
    label: 'a',
    phase: 'pre-stage',
    priority: 30,
    when: 'before-test-run',
    evaluate: () => null,
  });
  registry.register({
    id: 'gate-b',
    label: 'b',
    phase: 'pre-stage',
    priority: 10,
    when: 'before-test-run',
    dependsOn: ['gate-a'],
    evaluate: () => null,
  });
  const issues = registry.validateDependencies();
  assert.equal(issues.length, 1);
  assert.equal(issues[0]!.kind, 'priority-order');
  assert.equal(issues[0]!.gateId, 'gate-b');
  assert.equal(issues[0]!.dependsOnId, 'gate-a');
});

test('validateDependencies: 合法依赖链通过', () => {
  const registry = new QualityGateRegistry();
  registry.register({
    id: 'early',
    label: 'early',
    phase: 'pre-stage',
    priority: 10,
    when: 'before-test-run',
    evaluate: () => null,
  });
  registry.register({
    id: 'late',
    label: 'late',
    phase: 'pre-stage',
    priority: 20,
    when: 'before-test-run',
    dependsOn: ['early'],
    evaluate: () => null,
  });
  assert.equal(registry.validateDependencies().length, 0);
});
