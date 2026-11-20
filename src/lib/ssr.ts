// Build-time values for the initial HTML. The browser script derives the same
// values from the same initial state, so the first paint already matches.

import { emptyData } from '../data/sample';
import { derive, initialState, type Vals } from './derive';

// First paint = "starting soon, nothing yet"; live data or the ?demo sample
// replaces it as soon as the script runs.
export const v = derive(initialState(), emptyData());

type BoolKey = { [K in keyof Vals]: Vals[K] extends boolean ? K : never }[keyof Vals];

/** Attributes for an element shown only while `key` is true. */
export const iff = (key: BoolKey) => ({ 'data-if': key, hidden: !v[key] });
