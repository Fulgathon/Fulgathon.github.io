// Build-time values for the initial HTML. The browser script derives the same
// values from the same initial state, so the first paint already matches.

import { sample } from '../data/sample';
import { derive, initialState, type Vals } from './derive';

export const v = derive(initialState(sample), sample);

type BoolKey = { [K in keyof Vals]: Vals[K] extends boolean ? K : never }[keyof Vals];

/** Attributes for an element shown only while `key` is true. */
export const iff = (key: BoolKey) => ({ 'data-if': key, hidden: !v[key] });
