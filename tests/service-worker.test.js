global.importScripts = jest.fn();

global.Storage = {
  getProblem: jest.fn(),
  saveProblem: jest.fn(),
  getStats: jest.fn().mockResolvedValue({ totalSolved: 0 }),
  saveStats: jest.fn(),
  recordActivity: jest.fn(),
  getDueProblems: jest.fn().mockResolvedValue([])
};

global.createProblemRecord = jest.fn((data) => ({ ...data, solveCount: 1, history: [] }));
global.updateStreak = jest.fn();
global.updateBadge = jest.fn();

global.chrome = {
  runtime: {
    onInstalled: { addListener: jest.fn() },
    onMessage: { addListener: jest.fn() },
    onStartup: { addListener: jest.fn() }
  },
  alarms: {
    create: jest.fn(),
    onAlarm: { addListener: jest.fn() }
  },
  action: {
    setBadgeText: jest.fn(),
    setBadgeBackgroundColor: jest.fn()
  },
  notifications: {
    onClicked: { addListener: jest.fn() },
    clear: jest.fn()
  }
};

const { handleProblemSubmitted } = require('../background/service-worker.js');

describe('Service Worker - handleProblemSubmitted', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should increment solveCount on Accepted for existing problem', async () => {
    global.Storage.getProblem.mockResolvedValue({ slug: 'two-sum', solveCount: 1, failedAttempts: 0 });
    
    await handleProblemSubmitted({
      slug: 'two-sum',
      title: 'Two Sum',
      status: 'Accepted'
    });

    expect(global.Storage.saveProblem).toHaveBeenCalledWith(
      'two-sum',
      expect.objectContaining({ solveCount: 2, failedAttempts: 0 })
    );
  });

  it('should increment failedAttempts on Wrong Answer for existing problem', async () => {
    global.Storage.getProblem.mockResolvedValue({ slug: 'two-sum', solveCount: 1, failedAttempts: 0 });
    
    await handleProblemSubmitted({
      slug: 'two-sum',
      title: 'Two Sum',
      status: 'Wrong Answer'
    });

    expect(global.Storage.saveProblem).toHaveBeenCalledWith(
      'two-sum',
      expect.objectContaining({ solveCount: 1, failedAttempts: 1 })
    );
  });

  it('should set solveCount to 0 and failedAttempts to 1 for NEW failed problem', async () => {
    global.Storage.getProblem.mockResolvedValue(null);
    
    await handleProblemSubmitted({
      slug: 'two-sum',
      title: 'Two Sum',
      status: 'Time Limit Exceeded'
    });

    expect(global.Storage.saveProblem).toHaveBeenCalledWith(
      'two-sum',
      expect.objectContaining({ solveCount: 0, failedAttempts: 1 })
    );
  });
});
