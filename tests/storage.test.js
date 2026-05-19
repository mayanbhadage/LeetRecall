const { STORAGE_KEYS, DEFAULT_SETTINGS, DEFAULT_STATS } = require('../shared/constants.js');
global.STORAGE_KEYS = STORAGE_KEYS;
global.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
global.DEFAULT_STATS = DEFAULT_STATS;

global.chrome = {
  storage: {
    local: {
      get: jest.fn(),
      set: jest.fn(),
    }
  }
};

const Storage = require('../shared/storage.js');

describe('Storage Wrapper', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Problems', () => {
    it('getProblems returns empty object if no problems exist', async () => {
      global.chrome.storage.local.get.mockResolvedValue({});
      const problems = await Storage.getProblems();
      expect(problems).toEqual({});
      expect(global.chrome.storage.local.get).toHaveBeenCalledWith(STORAGE_KEYS.PROBLEMS);
    });

    it('getProblem returns null if problem does not exist', async () => {
      global.chrome.storage.local.get.mockResolvedValue({ [STORAGE_KEYS.PROBLEMS]: { 'two-sum': {} } });
      const problem = await Storage.getProblem('three-sum');
      expect(problem).toBeNull();
    });

    it('saveProblem updates the existing problems object', async () => {
      global.chrome.storage.local.get.mockResolvedValue({ [STORAGE_KEYS.PROBLEMS]: { 'two-sum': { id: 'two-sum' } } });
      await Storage.saveProblem('three-sum', { id: 'three-sum' });
      expect(global.chrome.storage.local.set).toHaveBeenCalledWith({
        [STORAGE_KEYS.PROBLEMS]: { 
          'two-sum': { id: 'two-sum' }, 
          'three-sum': { id: 'three-sum' } 
        }
      });
    });

    it('deleteProblem removes a problem', async () => {
      global.chrome.storage.local.get.mockResolvedValue({ 
        [STORAGE_KEYS.PROBLEMS]: { 'two-sum': {}, 'three-sum': {} } 
      });
      await Storage.deleteProblem('two-sum');
      expect(global.chrome.storage.local.set).toHaveBeenCalledWith({
        [STORAGE_KEYS.PROBLEMS]: { 'three-sum': {} }
      });
    });
  });

  describe('Due Problems', () => {
    it('getDueProblems correctly identifies problems due today or earlier', async () => {
      const now = new Date();
      const yesterday = new Date(now);
      yesterday.setDate(now.getDate() - 1);
      const tomorrow = new Date(now);
      tomorrow.setDate(now.getDate() + 1);

      global.chrome.storage.local.get.mockResolvedValue({
        [STORAGE_KEYS.PROBLEMS]: {
          'past': { nextDueDate: yesterday.toISOString() },
          'future': { nextDueDate: tomorrow.toISOString() }
        }
      });

      const dueProblems = await Storage.getDueProblems();
      expect(dueProblems.length).toBe(1);
      expect(dueProblems[0].nextDueDate).toBe(yesterday.toISOString());
    });
  });

  describe('Settings & Stats', () => {
    it('getSettings merges with DEFAULT_SETTINGS', async () => {
      global.chrome.storage.local.get.mockResolvedValue({
        [STORAGE_KEYS.SETTINGS]: { theme: 'light' }
      });
      const settings = await Storage.getSettings();
      expect(settings.theme).toBe('light');
      expect(settings.dailyGoal).toBe(DEFAULT_SETTINGS.dailyGoal);
    });
    
    it('saveStats merges with existing stats', async () => {
      global.chrome.storage.local.get.mockResolvedValue({
        [STORAGE_KEYS.STATS]: { totalSolved: 5, streak: 1 }
      });
      await Storage.saveStats({ streak: 2 });
      expect(global.chrome.storage.local.set).toHaveBeenCalledWith({
        [STORAGE_KEYS.STATS]: { 
          totalSolved: 5, 
          streak: 2,
          lastActiveDate: null,
          totalReviews: 0
        }
      });
    });
  });
});
