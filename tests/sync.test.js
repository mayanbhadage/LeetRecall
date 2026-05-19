const { STORAGE_KEYS, DEFAULT_SETTINGS, DEFAULT_STATS } = require('../shared/constants.js');
global.STORAGE_KEYS = STORAGE_KEYS;
global.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
global.DEFAULT_STATS = DEFAULT_STATS;

// Mock chrome.storage with both local and sync
const localStore = {};
const syncStore = {};

global.chrome = {
  storage: {
    local: {
      get: jest.fn((key) => {
        if (typeof key === 'string') {
          return Promise.resolve({ [key]: localStore[key] });
        }
        return Promise.resolve({ ...localStore });
      }),
      set: jest.fn((obj) => {
        Object.assign(localStore, obj);
        return Promise.resolve();
      }),
    },
    sync: {
      get: jest.fn((key, cb) => {
        if (cb) { cb({ ...syncStore }); return; }
        return Promise.resolve({ ...syncStore });
      }),
      set: jest.fn((obj) => {
        Object.assign(syncStore, obj);
        return Promise.resolve();
      }),
      remove: jest.fn((keys) => {
        keys.forEach(k => delete syncStore[k]);
        return Promise.resolve();
      }),
    },
    onChanged: { addListener: jest.fn() },
  },
};

const Storage = require('../shared/storage.js');

describe('Cross-Device Sync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Clear stores
    Object.keys(localStore).forEach(k => delete localStore[k]);
    Object.keys(syncStore).forEach(k => delete syncStore[k]);
  });

  describe('compactProblem / expandProblem', () => {
    it('should roundtrip a problem record with minimal data loss', () => {
      const original = {
        id: 'two-sum',
        frontendId: '1',
        title: '1. Two Sum',
        url: 'https://leetcode.com/problems/two-sum/',
        difficulty: 'Easy',
        tags: ['Array', 'Hash Table'],
        addedAt: '2026-05-19T00:00:00.000Z',
        repetition: 3,
        interval: 16,
        efactor: 2.6,
        nextDueDate: '2026-06-04T00:00:00.000Z',
        lastSolvedAt: '2026-05-19T00:00:00.000Z',
        solveCount: 4,
        failedAttempts: 2,
        history: [{ date: '2026-05-19', rating: 3 }],
        submissions: [{ date: '2026-05-19', status: 'Accepted' }],
      };

      const compact = Storage.compactProblem(original);
      const expanded = Storage.expandProblem('two-sum', compact);

      // SM-2 state should survive
      expect(expanded.repetition).toBe(3);
      expect(expanded.interval).toBe(16);
      expect(expanded.efactor).toBe(2.6);
      expect(expanded.solveCount).toBe(4);
      expect(expanded.failedAttempts).toBe(2);
      expect(expanded.difficulty).toBe('Easy');
      expect(expanded.title).toBe('1. Two Sum');
      expect(expanded.frontendId).toBe('1');
      expect(expanded.tags).toEqual(['Array', 'Hash Table']);

      // History/submissions are not synced (too large)
      expect(expanded.history).toEqual([]);
      expect(expanded.submissions).toEqual([]);
    });

    it('should abbreviate difficulty to single char', () => {
      expect(Storage.compactProblem({ difficulty: 'Easy' }).d).toBe('E');
      expect(Storage.compactProblem({ difficulty: 'Medium' }).d).toBe('M');
      expect(Storage.compactProblem({ difficulty: 'Hard' }).d).toBe('H');
      expect(Storage.compactProblem({ difficulty: 'Unknown' }).d).toBe('U');
    });

    it('should cap tags at 5 for size', () => {
      const compact = Storage.compactProblem({ tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] });
      expect(compact.tg.length).toBe(5);
    });
  });

  describe('syncPush', () => {
    it('should write problems in chunks to sync storage', async () => {
      const problems = {};
      for (let i = 0; i < 3; i++) {
        problems[`problem-${i}`] = {
          title: `Problem ${i}`,
          difficulty: 'Easy',
          repetition: 1,
          interval: 6,
          efactor: 2.5,
          nextDueDate: '2026-06-01T00:00:00.000Z',
          lastSolvedAt: '2026-05-19T00:00:00.000Z',
          solveCount: 1,
          tags: [],
        };
      }

      await Storage.syncPush(problems);

      expect(chrome.storage.sync.set).toHaveBeenCalled();
      // Should have meta chunk
      expect(syncStore['lr_sync_meta']).toBeDefined();
      expect(syncStore['lr_sync_meta'].totalProblems).toBe(3);
      expect(syncStore['lr_sync_meta'].totalChunks).toBe(1);
      // Should have data chunk
      expect(syncStore['lr_sync_0']).toBeDefined();
      expect(Object.keys(syncStore['lr_sync_0']).length).toBe(3);
    });
  });

  describe('syncPull', () => {
    it('should add new problems from sync to local', async () => {
      // Set up sync with a problem that doesn't exist locally
      syncStore['lr_sync_meta'] = { totalChunks: 1, lastSyncAt: new Date().toISOString(), totalProblems: 1 };
      syncStore['lr_sync_0'] = {
        'two-sum': {
          t: '1. Two Sum',
          d: 'E',
          r: 2, i: 6, ef: 2.5,
          nd: '2026-06-01',
          sc: 3, fa: 0,
          ls: '2026-05-19',
          tg: ['Array'],
          fi: '1',
          url: 'https://leetcode.com/problems/two-sum/',
        },
      };

      // Local has no problems
      localStore[STORAGE_KEYS.PROBLEMS] = {};

      const result = await Storage.syncPull();

      expect(result.added).toBe(1);
      expect(result.merged).toBe(0);
      // Verify the problem was written to local
      expect(localStore[STORAGE_KEYS.PROBLEMS]['two-sum']).toBeDefined();
      expect(localStore[STORAGE_KEYS.PROBLEMS]['two-sum'].title).toBe('1. Two Sum');
      expect(localStore[STORAGE_KEYS.PROBLEMS]['two-sum'].repetition).toBe(2);
    });

    it('should update local with newer sync data', async () => {
      // Sync has a newer version
      syncStore['lr_sync_meta'] = { totalChunks: 1, lastSyncAt: new Date().toISOString(), totalProblems: 1 };
      syncStore['lr_sync_0'] = {
        'two-sum': {
          t: '1. Two Sum', d: 'E',
          r: 5, i: 30, ef: 2.8,  // more advanced SM-2 state
          nd: '2026-07-01',
          sc: 10, fa: 1,
          ls: '2026-05-20',      // newer than local
          tg: ['Array'],
          fi: '1',
          url: 'https://leetcode.com/problems/two-sum/',
        },
      };

      // Local has older data
      localStore[STORAGE_KEYS.PROBLEMS] = {
        'two-sum': {
          id: 'two-sum',
          title: '1. Two Sum',
          difficulty: 'Easy',
          repetition: 2, interval: 6, efactor: 2.5,
          nextDueDate: '2026-06-01T00:00:00.000Z',
          lastSolvedAt: '2026-05-15T00:00:00.000Z', // older
          solveCount: 5,
          failedAttempts: 0,
          history: [{ date: '2026-05-15', rating: 3 }],
          submissions: [{ date: '2026-05-15', status: 'Accepted' }],
        },
      };

      const result = await Storage.syncPull();

      expect(result.merged).toBe(1);
      const updated = localStore[STORAGE_KEYS.PROBLEMS]['two-sum'];
      // SM-2 state should be updated from sync
      expect(updated.repetition).toBe(5);
      expect(updated.interval).toBe(30);
      expect(updated.efactor).toBe(2.8);
      // Solve count should be max of both
      expect(updated.solveCount).toBe(10);
      expect(updated.failedAttempts).toBe(1);
      // History should be preserved from local (not overwritten)
      expect(updated.history.length).toBe(1);
      expect(updated.submissions.length).toBe(1);
    });

    it('should keep local data when local is newer', async () => {
      syncStore['lr_sync_meta'] = { totalChunks: 1, lastSyncAt: new Date().toISOString(), totalProblems: 1 };
      syncStore['lr_sync_0'] = {
        'two-sum': {
          t: '1. Two Sum', d: 'E',
          r: 1, i: 1, ef: 2.5,
          nd: '2026-05-16',
          sc: 2, fa: 0,
          ls: '2026-05-10', // older than local
          tg: ['Array'],
          fi: '1',
          url: 'https://leetcode.com/problems/two-sum/',
        },
      };

      localStore[STORAGE_KEYS.PROBLEMS] = {
        'two-sum': {
          id: 'two-sum',
          title: '1. Two Sum',
          difficulty: 'Easy',
          repetition: 5, interval: 30, efactor: 2.8,
          nextDueDate: '2026-07-01T00:00:00.000Z',
          lastSolvedAt: '2026-05-19T00:00:00.000Z', // newer
          solveCount: 8,
          failedAttempts: 1,
          history: [],
          submissions: [],
        },
      };

      const result = await Storage.syncPull();

      // Should not merge (local is newer)
      expect(result.merged).toBe(0);
      const local = localStore[STORAGE_KEYS.PROBLEMS]['two-sum'];
      // SM-2 state should be unchanged
      expect(local.repetition).toBe(5);
      expect(local.interval).toBe(30);
      // But counts should still be max'd
      expect(local.solveCount).toBe(8); // local 8 > sync 2
    });

    it('should return zeros when no sync data exists', async () => {
      const result = await Storage.syncPull();
      expect(result.added).toBe(0);
      expect(result.merged).toBe(0);
    });
  });
});
