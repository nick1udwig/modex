import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveSlashCommandState } from '../src/app/slashCommands.ts';

const modelOptions = [
  {
    defaultReasoningEffort: 'medium' as const,
    displayName: 'GPT-5.4',
    id: 'gpt-5.4',
    isDefault: true,
    supportedReasoningEfforts: ['low', 'medium', 'xhigh'] as const,
  },
];

test('resolveSlashCommandState returns top-level commands for a bare slash', () => {
  const state = resolveSlashCommandState({
    approvalPolicy: 'on-request',
    draft: '/',
    modelOptions,
    reasoningEfforts: ['low', 'medium', 'xhigh'],
    selectedModelId: 'gpt-5.4',
  });

  assert.deepEqual(
    state?.suggestions.map((suggestion) => suggestion.command),
    ['/new', '/model', '/reasoning', '/approvals'],
  );
  assert.equal(state?.suggestions[1]?.action.type, 'expand');
});

test('resolveSlashCommandState expands model and approval options', () => {
  const modelState = resolveSlashCommandState({
    approvalPolicy: 'on-request',
    draft: '/model gpt',
    modelOptions,
    reasoningEfforts: ['low', 'medium', 'xhigh'],
    selectedModelId: 'gpt-5.4',
  });
  const approvalState = resolveSlashCommandState({
    approvalPolicy: 'on-request',
    draft: '/approvals never',
    modelOptions,
    reasoningEfforts: ['low', 'medium', 'xhigh'],
    selectedModelId: 'gpt-5.4',
  });

  assert.equal(modelState?.suggestions[0]?.command, '/model gpt-5.4');
  assert.equal(approvalState?.suggestions[0]?.command, '/approvals never');
  assert.equal(approvalState?.suggestions[0]?.action.type, 'set-approval-policy');
});

test('resolveSlashCommandState ignores normal prompts', () => {
  assert.equal(
    resolveSlashCommandState({
      approvalPolicy: 'on-request',
      draft: 'Explain the tabs',
      modelOptions,
      reasoningEfforts: ['low', 'medium', 'xhigh'],
      selectedModelId: 'gpt-5.4',
    }),
    null,
  );
});
