import type { LineageNode, LineageTask } from '../../shared/types';

export function quickActionState(node: LineageNode, selectionFull: boolean, selectedCount = 3, selectionLimit = 3) {
  const branchLocked = taskIsLocked(node.lineage_tasks?.iterate);
  const branchLimitReached = !node.user_selected && selectionFull;
  const rerollLocked = taskIsLocked(node.lineage_tasks?.reroll);
  const rerollSelected = node.reroll_request?.status === 'pending';
  const socialSelected = node.social_mark?.active === true;
  const discussionSelected = node.discussion_mark?.active === true;
  return {
    discussionDisabled: false,
    discussionSelected,
    discussionTitle: discussionSelected ? 'Remove discussion flag (F)' : 'Flag for discussion (F)',
    branchDisabled: branchLocked || branchLimitReached,
    branchLimitReached,
    branchLocked,
    branchTitle: branchLocked
      ? 'An agent is working on this branch task. Manage it in the task queue.'
      : !node.user_selected && selectionFull
        ? `${selectedCount} of ${selectionLimit} branches queued. Raise the maximum in Canvas settings or remove a branch.`
        : node.user_selected ? 'Remove from the next branch (B)' : 'Use as a base for the next branch (B)',
    rerollDisabled: rerollLocked,
    rerollLocked,
    rerollSelected,
    rerollTitle: rerollLocked
      ? 'An agent is working on this re-roll. Manage it in the task queue.'
      : rerollSelected ? 'Remove from the re-roll queue (R)' : 'Add to the re-roll queue (R)',
    socialDisabled: false,
    socialSelected,
    socialTitle: socialSelected ? 'Unmark from Social (S)' : 'Mark for Social (S)',
  };
}

function taskIsLocked(task?: LineageTask): boolean {
  return task?.status === 'claimed' || task?.status === 'in_progress';
}
