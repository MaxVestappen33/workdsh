import { type ReactNode } from 'react';

/**
 * SkillHub keeps the plaza entry in its own sidebar row, which duplicates the
 * WorkDSH account-menu entry that opens the same overlay. Hide the duplicate
 * row; the plaza itself stays untouched and is driven from the account menu.
 */
export function PlazaEntryInSidebarHidden(): ReactNode {
  return <style>{'.sh-plaza-trigger { display: none !important; }'}</style>;
}