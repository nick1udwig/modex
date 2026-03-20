import type { ChatStatus } from './types';

export const isChatActiveStatus = (status: ChatStatus) => status !== 'idle';

export const chatStatusLabel = (status: ChatStatus) => {
  switch (status) {
    case 'waiting-approval':
      return 'Needs approval';
    case 'waiting-input':
      return 'Needs input';
    case 'running':
      return 'In progress';
    default:
      return 'Ready';
  }
};

export const chatStatusMetaLabel = (status: ChatStatus) => {
  switch (status) {
    case 'waiting-approval':
      return 'Awaiting approval';
    case 'waiting-input':
      return 'Awaiting input';
    case 'running':
      return 'Running';
    default:
      return 'Ready';
  }
};
