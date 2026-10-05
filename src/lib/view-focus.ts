/**
 * VIEW FOCUS — which person the operator is currently following.
 *
 * PROJECT_CONTEXT.md §4.5: clicking a person opens their event history **and
 * highlights their location on the Mission Map**. §2 rule 10: every person
 * detection links to a mission event and a map position. That requires one
 * piece of state the module views share, because the person is chosen in
 * Vision, Personnel or the command palette and shown in the Map.
 *
 * It is deliberately not in the telemetry store: that store holds what the
 * rover reported, and this holds what the operator is looking at. Mixing them
 * would make a UI selection look like mission data in the report.
 */

import { create } from "zustand";

interface ViewFocusState {
  /** Person the operator is following, or null. */
  personId: string | null;
  focusPerson(personId: string | null): void;
}

export const useViewFocus = create<ViewFocusState>()((set) => ({
  personId: null,
  focusPerson(personId) {
    set({ personId });
  },
}));

/** Follow a person, from outside React. */
export function focusPerson(personId: string | null): void {
  useViewFocus.getState().focusPerson(personId);
}

export function useFocusedPersonId(): string | null {
  return useViewFocus((state) => state.personId);
}
