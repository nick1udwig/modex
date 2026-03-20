import type { ApprovalPolicy, ModelOption, ReasoningEffort } from './types';

export type SlashCommandAction =
  | { type: 'new' }
  | { type: 'expand'; command: 'approvals' | 'model' | 'reasoning' }
  | { type: 'set-model'; modelId: string }
  | { type: 'set-reasoning'; reasoningEffort: ReasoningEffort }
  | { type: 'set-approval-policy'; approvalPolicy: ApprovalPolicy };

export interface SlashCommandSuggestion {
  action: SlashCommandAction;
  command: string;
  description: string;
  id: string;
  label: string;
}

export interface SlashCommandState {
  query: string;
  suggestions: SlashCommandSuggestion[];
}

interface ResolveSlashCommandStateOptions {
  approvalPolicy: ApprovalPolicy;
  draft: string;
  modelOptions: ModelOption[];
  reasoningEfforts: ReasoningEffort[];
  selectedModelId: string;
}

const APPROVAL_POLICY_LABELS: Record<ApprovalPolicy, string> = {
  never: 'Never ask',
  'on-failure': 'Ask on failure',
  'on-request': 'Ask when requested',
  untrusted: 'Ask for untrusted commands',
};

const APPROVAL_POLICY_DESCRIPTIONS: Record<ApprovalPolicy, string> = {
  never: 'Run without prompting when the sandbox allows it.',
  'on-failure': 'Only prompt after sandboxed commands fail.',
  'on-request': 'Let Codex ask when it wants approval.',
  untrusted: 'Require approval for commands outside the trusted set.',
};

const matchesQuery = (value: string, query: string) => value.toLowerCase().includes(query.toLowerCase());

const topLevelSuggestions = (query: string): SlashCommandSuggestion[] => {
  const suggestions: SlashCommandSuggestion[] = [
    {
      action: { type: 'new' },
      command: '/new',
      description: 'Start a new tab with the current runtime settings.',
      id: 'new',
      label: 'New tab',
    },
    {
      action: { type: 'expand', command: 'model' },
      command: '/model',
      description: 'Switch the active chat model.',
      id: 'model',
      label: 'Model',
    },
    {
      action: { type: 'expand', command: 'reasoning' },
      command: '/reasoning',
      description: 'Change the reasoning level for this chat.',
      id: 'reasoning',
      label: 'Reasoning',
    },
    {
      action: { type: 'expand', command: 'approvals' },
      command: '/approvals',
      description: 'Change the approval policy for this chat.',
      id: 'approvals',
      label: 'Approvals',
    },
  ];

  return suggestions.filter((suggestion) =>
    query.length === 0 || matchesQuery(suggestion.command, query) || matchesQuery(suggestion.label, query),
  );
};

const modelSuggestions = (
  query: string,
  modelOptions: ModelOption[],
  selectedModelId: string,
): SlashCommandSuggestion[] =>
  modelOptions
    .filter((option) => query.length === 0 || matchesQuery(option.id, query) || matchesQuery(option.displayName, query))
    .map((option) => ({
      action: { type: 'set-model', modelId: option.id },
      command: `/model ${option.id}`,
      description:
        option.id === selectedModelId ? `${option.displayName} is active now.` : `Switch to ${option.displayName}.`,
      id: `model:${option.id}`,
      label: option.displayName,
    }));

const reasoningSuggestions = (
  query: string,
  reasoningEfforts: ReasoningEffort[],
): SlashCommandSuggestion[] =>
  reasoningEfforts
    .filter((effort) => query.length === 0 || matchesQuery(effort, query))
    .map((effort) => ({
      action: { type: 'set-reasoning', reasoningEffort: effort },
      command: `/reasoning ${effort}`,
      description: `Set reasoning effort to ${effort}.`,
      id: `reasoning:${effort}`,
      label: effort,
    }));

const approvalSuggestions = (
  query: string,
  selectedPolicy: ApprovalPolicy,
): SlashCommandSuggestion[] =>
  (Object.keys(APPROVAL_POLICY_LABELS) as ApprovalPolicy[])
    .filter((policy) => {
      if (query.length === 0) {
        return true;
      }

      return matchesQuery(policy, query) || matchesQuery(APPROVAL_POLICY_LABELS[policy], query);
    })
    .map((policy) => ({
      action: { type: 'set-approval-policy', approvalPolicy: policy },
      command: `/approvals ${policy}`,
      description:
        policy === selectedPolicy
          ? `${APPROVAL_POLICY_LABELS[policy]} is active now.`
          : APPROVAL_POLICY_DESCRIPTIONS[policy],
      id: `approvals:${policy}`,
      label: APPROVAL_POLICY_LABELS[policy],
    }));

export const resolveSlashCommandState = ({
  approvalPolicy,
  draft,
  modelOptions,
  reasoningEfforts,
  selectedModelId,
}: ResolveSlashCommandStateOptions): SlashCommandState | null => {
  const trimmed = draft.trimStart();
  if (!trimmed.startsWith('/')) {
    return null;
  }

  const body = trimmed.slice(1);
  const spaceIndex = body.indexOf(' ');
  const command = (spaceIndex === -1 ? body : body.slice(0, spaceIndex)).trim().toLowerCase();
  const query = spaceIndex === -1 ? '' : body.slice(spaceIndex + 1).trim();

  if (command.length === 0) {
    return {
      query,
      suggestions: topLevelSuggestions(''),
    };
  }

  if (spaceIndex === -1) {
    const topLevel = topLevelSuggestions(command);
    const exactTopLevel = topLevel.some((suggestion) => suggestion.id === command);
    if (!exactTopLevel) {
      return {
        query,
        suggestions: topLevel,
      };
    }
  }

  switch (command) {
    case 'new':
      return {
        query,
        suggestions: query.length === 0 ? topLevelSuggestions('new').slice(0, 1) : [],
      };

    case 'model':
      return {
        query,
        suggestions: modelSuggestions(query, modelOptions, selectedModelId),
      };

    case 'reasoning':
      return {
        query,
        suggestions: reasoningSuggestions(query, reasoningEfforts),
      };

    case 'approvals':
      return {
        query,
        suggestions: approvalSuggestions(query, approvalPolicy),
      };

    default:
      return {
        query,
        suggestions: topLevelSuggestions(command),
      };
  }
};
