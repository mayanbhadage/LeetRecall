global.importScripts = jest.fn();

global.Storage = {
  getProblem: jest.fn(),
  saveProblem: jest.fn(),
  setProblems: jest.fn(),
  getProblems: jest.fn().mockResolvedValue({}),
  getStats: jest.fn().mockResolvedValue({ totalSolved: 0 }),
  saveStats: jest.fn(),
  getSettings: jest.fn().mockResolvedValue({}),
  saveSettings: jest.fn(),
  recordActivity: jest.fn(),
  getDueProblems: jest.fn().mockResolvedValue([]),
  getActivity: jest.fn().mockResolvedValue({}),
};

global.createProblemRecord = jest.fn((data) => ({ ...data, solveCount: 1, history: [] }));
global.updateStreak = jest.fn();
global.updateBadge = jest.fn();

global.chrome = {
  runtime: {
    onInstalled: { addListener: jest.fn() },
    onMessage: { addListener: jest.fn() },
    onStartup: { addListener: jest.fn() },
  },
  alarms: {
    create: jest.fn(),
    onAlarm: { addListener: jest.fn() },
  },
  action: {
    setBadgeText: jest.fn(),
    setBadgeBackgroundColor: jest.fn(),
  },
  notifications: {
    onClicked: { addListener: jest.fn() },
    clear: jest.fn(),
  },
  storage: {
    local: { get: jest.fn(), set: jest.fn() },
    onChanged: { addListener: jest.fn() },
  },
};

const { handleImportData, mergeHistory, mergeSubmissions } = require('../background/service-worker.js');

describe('Import Data — Merge Logic', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should reject invalid data', async () => {
    const res = await handleImportData(null);
    expect(res.success).toBe(false);
    expect(res.error).toContain('Invalid');
  });

  it('should reject unsupported version', async () => {
    const res = await handleImportData({ version: '2.0.0' });
    expect(res.success).toBe(false);
    expect(res.error).toContain('Unsupported');
  });

  it('should add new problems from import', async () => {
    global.Storage.getProblems.mockResolvedValue({});

    await handleImportData({
      version: '1.1.0',
      problems: {
        'two-sum': {
          id: 'two-sum',
          title: 'Two Sum',
          lastSolvedAt: '2026-05-19T00:00:00.000Z',
          solveCount: 1,
          failedAttempts: 0,
          history: [],
          submissions: [],
        },
      },
    });

    expect(global.Storage.setProblems).toHaveBeenCalledWith(
      expect.objectContaining({
        'two-sum': expect.objectContaining({ title: 'Two Sum' }),
      })
    );
  });

  it('should merge problems using latest-wins strategy', async () => {
    global.Storage.getProblems.mockResolvedValue({
      'two-sum': {
        id: 'two-sum',
        title: 'Two Sum',
        lastSolvedAt: '2026-05-15T00:00:00.000Z',
        solveCount: 3,
        failedAttempts: 1,
        history: [{ date: '2026-05-15T00:00:00.000Z', rating: 3 }],
        submissions: [{ date: '2026-05-15T00:00:00.000Z', status: 'Accepted' }],
      },
    });

    await handleImportData({
      version: '1.1.0',
      problems: {
        'two-sum': {
          id: 'two-sum',
          title: 'Two Sum Updated',
          lastSolvedAt: '2026-05-19T00:00:00.000Z', // newer
          solveCount: 5,
          failedAttempts: 0,
          history: [
            { date: '2026-05-15T00:00:00.000Z', rating: 3 }, // duplicate
            { date: '2026-05-19T00:00:00.000Z', rating: 4 }, // new
          ],
          submissions: [
            { date: '2026-05-19T00:00:00.000Z', status: 'Accepted' }, // new
          ],
        },
      },
    });

    const savedProblems = global.Storage.setProblems.mock.calls[0][0];
    const merged = savedProblems['two-sum'];

    // imported is newer, so its base data should win
    expect(merged.title).toBe('Two Sum Updated');
    // solveCount should be max(5, 3) = 5
    expect(merged.solveCount).toBe(5);
    // failedAttempts should be max(0, 1) = 1
    expect(merged.failedAttempts).toBe(1);
    // History should be deduplicated
    expect(merged.history.length).toBe(2);
    // Submissions should be merged
    expect(merged.submissions.length).toBe(2);
  });

  it('should keep existing when local is newer', async () => {
    global.Storage.getProblems.mockResolvedValue({
      'two-sum': {
        id: 'two-sum',
        title: 'Two Sum Local',
        lastSolvedAt: '2026-05-19T00:00:00.000Z', // newer
        solveCount: 5,
        failedAttempts: 2,
        history: [{ date: '2026-05-19T00:00:00.000Z', rating: 4 }],
        submissions: [],
      },
    });

    await handleImportData({
      version: '1.1.0',
      problems: {
        'two-sum': {
          id: 'two-sum',
          title: 'Two Sum Older',
          lastSolvedAt: '2026-05-10T00:00:00.000Z', // older
          solveCount: 2,
          failedAttempts: 3,
          history: [],
          submissions: [],
        },
      },
    });

    const saved = global.Storage.setProblems.mock.calls[0][0]['two-sum'];
    // Local title should be kept (local is newer)
    expect(saved.title).toBe('Two Sum Local');
    // But failedAttempts should still be max'd
    expect(saved.failedAttempts).toBe(3);
    expect(saved.solveCount).toBe(5);
  });
});

describe('Merge Helpers', () => {
  describe('mergeHistory', () => {
    it('should deduplicate by date+rating', () => {
      const existing = [
        { date: '2026-05-15T00:00:00.000Z', rating: 3 },
        { date: '2026-05-16T00:00:00.000Z', rating: 4 },
      ];
      const incoming = [
        { date: '2026-05-15T00:00:00.000Z', rating: 3 }, // dupe
        { date: '2026-05-17T00:00:00.000Z', rating: 2 }, // new
      ];

      const merged = mergeHistory(existing, incoming);
      expect(merged.length).toBe(3);
      // Should be sorted by date
      expect(merged[0].date).toBe('2026-05-15T00:00:00.000Z');
      expect(merged[2].date).toBe('2026-05-17T00:00:00.000Z');
    });

    it('should handle null/undefined inputs', () => {
      expect(mergeHistory(null, null)).toEqual([]);
      expect(mergeHistory(undefined, [{ date: '2026-01-01', rating: 3 }]).length).toBe(1);
    });
  });

  describe('mergeSubmissions', () => {
    it('should deduplicate by date+status', () => {
      const existing = [{ date: '2026-05-15T00:00:00.000Z', status: 'Accepted' }];
      const incoming = [
        { date: '2026-05-15T00:00:00.000Z', status: 'Accepted' }, // dupe
        { date: '2026-05-15T00:00:00.000Z', status: 'Wrong Answer' }, // different status, keep
      ];

      const merged = mergeSubmissions(existing, incoming);
      expect(merged.length).toBe(2);
    });
  });
});
