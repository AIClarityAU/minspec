import { describe, it, expect, vi } from 'vitest';

// Mock vscode before importing the module under test. Only the enum and a
// minimal Memento shape are needed here.
vi.mock('vscode', () => ({
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
}));

import * as vscode from 'vscode';
import { TreeExpansionMemory } from '../src/views/tree-expansion-memory';

const { None, Collapsed, Expanded } = vscode.TreeItemCollapsibleState;

/** In-memory Memento double capturing the last persisted value. */
function fakeMemento(seed: Record<string, unknown> = {}) {
  const store: Record<string, unknown> = { ...seed };
  return {
    get: vi.fn(<T>(key: string, def: T): T => (key in store ? (store[key] as T) : def)),
    update: vi.fn((key: string, value: unknown) => {
      store[key] = value;
      return Promise.resolve();
    }),
    keys: () => Object.keys(store),
    _store: store,
  };
}

const KEY = 'minspec.test.expansion';

describe('TreeExpansionMemory.apply', () => {
  it('keeps the provider default when the group was never toggled', () => {
    const mem = new TreeExpansionMemory(fakeMemento() as never, KEY);
    const item = { id: 'status:Done', collapsibleState: Collapsed };
    mem.apply(item as never);
    expect(item.collapsibleState).toBe(Collapsed); // untouched
  });

  it('restores a remembered expanded state over a collapsed default', () => {
    const mem = new TreeExpansionMemory(
      fakeMemento({ [KEY]: { 'status:Done': true } }) as never,
      KEY,
    );
    const item = { id: 'status:Done', collapsibleState: Collapsed };
    mem.apply(item as never);
    expect(item.collapsibleState).toBe(Expanded);
  });

  it('restores a remembered collapsed state over an expanded default', () => {
    const mem = new TreeExpansionMemory(
      fakeMemento({ [KEY]: { 'status:Specifying': false } }) as never,
      KEY,
    );
    const item = { id: 'status:Specifying', collapsibleState: Expanded };
    mem.apply(item as never);
    expect(item.collapsibleState).toBe(Collapsed);
  });

  it('never touches a leaf (None) even if an id somehow collides', () => {
    const mem = new TreeExpansionMemory(
      fakeMemento({ [KEY]: { leaf: true } }) as never,
      KEY,
    );
    const item = { id: 'leaf', collapsibleState: None };
    mem.apply(item as never);
    expect(item.collapsibleState).toBe(None);
  });

  it('is a no-op for a node with no id', () => {
    const mem = new TreeExpansionMemory(
      fakeMemento({ [KEY]: { 'status:Done': true } }) as never,
      KEY,
    );
    const item = { collapsibleState: Collapsed };
    mem.apply(item as never);
    expect(item.collapsibleState).toBe(Collapsed);
  });
});

describe('TreeExpansionMemory.record', () => {
  it('persists a toggle under the panel key', async () => {
    const memento = fakeMemento();
    const mem = new TreeExpansionMemory(memento as never, KEY);
    await mem.record('status:Done', true);
    expect(memento.update).toHaveBeenCalledWith(KEY, { 'status:Done': true });
  });

  it('round-trips: a recorded toggle is applied by a fresh instance', async () => {
    const memento = fakeMemento();
    const writer = new TreeExpansionMemory(memento as never, KEY);
    await writer.record('epic:__none__', true);

    const reader = new TreeExpansionMemory(memento as never, KEY);
    const item = { id: 'epic:__none__', collapsibleState: Collapsed };
    reader.apply(item as never);
    expect(item.collapsibleState).toBe(Expanded);
  });

  it('skips the write when the state is unchanged', async () => {
    const memento = fakeMemento({ [KEY]: { 'status:Done': true } });
    const mem = new TreeExpansionMemory(memento as never, KEY);
    await mem.record('status:Done', true); // same value already stored
    expect(memento.update).not.toHaveBeenCalled();
  });

  it('ignores an undefined id (leaf/message node)', async () => {
    const memento = fakeMemento();
    const mem = new TreeExpansionMemory(memento as never, KEY);
    await mem.record(undefined, true);
    expect(memento.update).not.toHaveBeenCalled();
  });

  it('does not mutate the memento-backed object in place before persisting', async () => {
    const seed = { 'status:Done': true };
    const memento = fakeMemento({ [KEY]: seed });
    const mem = new TreeExpansionMemory(memento as never, KEY);
    await mem.record('status:Specifying', false);
    // The originally-seeded object must be untouched (constructor copies it).
    expect(seed).toEqual({ 'status:Done': true });
  });
});

describe('TreeExpansionMemory LRU eviction (#746)', () => {
  it('evicts the least-recently-touched id once MAX_ENTRIES is exceeded', async () => {
    const memento = fakeMemento();
    const mem = new TreeExpansionMemory(memento as never, KEY);
    const max = TreeExpansionMemory.MAX_ENTRIES;

    for (let i = 0; i < max; i++) {
      await mem.record(`epic:${i}`, true);
    }
    // At capacity: nothing evicted yet.
    expect(Object.keys(memento._store[KEY] as Record<string, boolean>)).toHaveLength(max);
    expect((memento._store[KEY] as Record<string, boolean>)['epic:0']).toBe(true);

    // One more distinct id pushes past the cap → oldest ('epic:0') is evicted.
    await mem.record('epic:overflow', true);
    const stored = memento._store[KEY] as Record<string, boolean>;
    expect(Object.keys(stored)).toHaveLength(max);
    expect(stored['epic:0']).toBeUndefined();
    expect(stored['epic:1']).toBe(true);
    expect(stored['epic:overflow']).toBe(true);
  });

  it('re-touching an id refreshes it to the MRU end, sparing it from eviction', async () => {
    const memento = fakeMemento();
    const mem = new TreeExpansionMemory(memento as never, KEY);
    const max = TreeExpansionMemory.MAX_ENTRIES;

    for (let i = 0; i < max; i++) {
      await mem.record(`epic:${i}`, true);
    }
    // Touch epic:0 again (flip its value) — this should move it to MRU end.
    await mem.record('epic:0', false);
    // Now overflow with a new id — the next-oldest ('epic:1') should be evicted instead.
    await mem.record('epic:overflow', true);

    const stored = memento._store[KEY] as Record<string, boolean>;
    expect(stored['epic:0']).toBe(false); // survived, refreshed
    expect(stored['epic:1']).toBeUndefined(); // now the oldest, evicted
  });
});
