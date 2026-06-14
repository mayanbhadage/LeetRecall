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
  },
  storage: {
    onChanged: { addListener: jest.fn() }
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
    expect(global.Storage.recordActivity).toHaveBeenCalledWith('attempted');
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
    expect(global.Storage.recordActivity).toHaveBeenCalledWith('attempted');
  });
});

describe('Service Worker - Message Handlers', () => {
  const { handleMessage } = require('../background/service-worker.js');
  
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should handle OPEN_DASHBOARD message', async () => {
    global.chrome.tabs = { create: jest.fn() };
    global.chrome.runtime.getURL = jest.fn().mockReturnValue('chrome-extension://id/dashboard/dashboard.html');
    
    const res = await handleMessage({ type: 'OPEN_DASHBOARD' }, {});
    expect(global.chrome.tabs.create).toHaveBeenCalledWith({ url: 'chrome-extension://id/dashboard/dashboard.html' });
    expect(res).toEqual({ success: true });
  });

  it('should handle RATE_CONFIDENCE message and append custom tags', async () => {
    global.Storage.getProblem.mockResolvedValue({ 
      slug: 'two-sum', 
      tags: ['Array', 'Hash Table'],
      repetition: 0,
      interval: 0,
      efactor: 2.5,
      history: []
    });
    
    // We mock calculateSM2 because the real sm2.js is mocked out
    global.calculateSM2 = jest.fn().mockReturnValue({
      repetition: 1, interval: 1, efactor: 2.6, nextDueDate: new Date().toISOString()
    });
    
    const res = await handleMessage({ 
      type: 'RATE_CONFIDENCE', 
      data: { slug: 'two-sum', rating: 4, customTags: ['Two Pointer', 'BFS'] }
    }, {});
    
    expect(global.Storage.saveProblem).toHaveBeenCalledWith(
      'two-sum',
      expect.objectContaining({ 
        tags: ['Array', 'Hash Table', 'Two Pointer', 'BFS'] 
      })
    );
    expect(res.success).toBe(true);
  });

  it('should update problem tags with multiple values and remove duplicates', async () => {
    global.Storage.getProblem.mockResolvedValue({
      slug: 'two-sum',
      tags: ['Array']
    });

    const res = await handleMessage({
      type: 'UPDATE_PROBLEM_TAGS',
      data: { slug: 'two-sum', tags: ['Array', 'Graph', 'graph', 'BFS'] }
    }, {});

    expect(global.Storage.saveProblem).toHaveBeenCalledWith(
      'two-sum',
      expect.objectContaining({
        tags: ['Array', 'graph', 'BFS']
      })
    );
    expect(res.success).toBe(true);
  });
});
