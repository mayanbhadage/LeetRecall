const { QUALITY_MAP } = require('../shared/constants.js');
global.QUALITY_MAP = QUALITY_MAP;

const { calculateSM2, createProblemRecord } = require('../background/sm2.js');

describe('SM2 Engine', () => {
  describe('createProblemRecord', () => {
    it('creates a new record with default SM-2 values', () => {
      const info = { slug: 'two-sum', title: 'Two Sum', url: 'https://...', difficulty: 'Easy', tags: ['array'] };
      const record = createProblemRecord(info);
      expect(record.id).toBe('two-sum');
      expect(record.repetition).toBe(0);
      expect(record.interval).toBe(0);
      expect(record.efactor).toBe(2.5);
      expect(record.solveCount).toBe(1);
      expect(record.nextDueDate).toBeDefined();
    });

    it('stores the frontend id and formats unnumbered titles consistently', () => {
      const info = { slug: 'three-sum', frontendId: '15', title: '3Sum', url: 'https://...', difficulty: 'Medium', tags: [] };
      const record = createProblemRecord(info);
      expect(record.frontendId).toBe('15');
      expect(record.title).toBe('15. 3Sum');
    });
  });

  describe('calculateSM2', () => {
    it('handles rating 1 (Again) - complete failure resets progress', () => {
      const problem = { repetition: 2, interval: 6, efactor: 2.5 };
      const next = calculateSM2(problem, 1);
      expect(next.repetition).toBe(0);
      expect(next.interval).toBe(1);
      expect(next.efactor).toBeLessThan(2.5);
    });

    it('handles rating 2 (Hard) - struggled', () => {
      const problem = { repetition: 1, interval: 1, efactor: 2.5 };
      const next = calculateSM2(problem, 2);
      expect(next.repetition).toBe(0);
      expect(next.interval).toBe(1);
      expect(next.efactor).toBeLessThan(2.5);
    });

    it('handles rating 3 (Good) - correct with effort', () => {
      const problem = { repetition: 0, interval: 0, efactor: 2.5 };
      const next = calculateSM2(problem, 3);
      expect(next.repetition).toBe(1);
      expect(next.interval).toBe(1);
      expect(next.efactor).toBe(2.5);
    });
    
    it('handles rating 4 (Easy) - effortless recall', () => {
      const problem = { repetition: 1, interval: 1, efactor: 2.5 };
      const next = calculateSM2(problem, 4);
      expect(next.repetition).toBe(2);
      expect(next.interval).toBe(6);
      expect(next.efactor).toBeGreaterThan(2.5);
    });

    it('handles correct recall after 2 repetitions', () => {
      const problem = { repetition: 2, interval: 6, efactor: 2.6 };
      const next = calculateSM2(problem, 3);
      expect(next.repetition).toBe(3);
      expect(next.interval).toBe(16); // 6 * 2.6 = 15.6 -> Math.round = 16
      expect(next.efactor).toBe(2.6);
    });

    it('prevents efactor from going below 1.3', () => {
      const problem = { repetition: 5, interval: 14, efactor: 1.3 };
      const next = calculateSM2(problem, 1);
      expect(next.efactor).toBe(1.3);
    });
  });
});
