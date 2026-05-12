/**
 * LeetRecall — Storage Wrapper
 * Abstracts chrome.storage.local with typed getters/setters.
 */

const Storage = {
  /**
   * Get all tracked problems.
   * @returns {Promise<Record<string, object>>}
   */
  async getProblems() {
    const result = await chrome.storage.local.get(STORAGE_KEYS.PROBLEMS);
    return result[STORAGE_KEYS.PROBLEMS] || {};
  },

  /**
   * Save all problems (full replace).
   * @param {Record<string, object>} problems
   */
  async setProblems(problems) {
    await chrome.storage.local.set({ [STORAGE_KEYS.PROBLEMS]: problems });
  },

  /**
   * Get a single problem by slug.
   * @param {string} slug
   * @returns {Promise<object|null>}
   */
  async getProblem(slug) {
    const problems = await this.getProblems();
    return problems[slug] || null;
  },

  /**
   * Save or update a single problem.
   * @param {string} slug
   * @param {object} problemData
   */
  async saveProblem(slug, problemData) {
    const problems = await this.getProblems();
    problems[slug] = problemData;
    await this.setProblems(problems);
  },

  /**
   * Delete a single problem.
   * @param {string} slug
   */
  async deleteProblem(slug) {
    const problems = await this.getProblems();
    delete problems[slug];
    await this.setProblems(problems);
  },

  /**
   * Get user settings.
   * @returns {Promise<object>}
   */
  async getSettings() {
    const result = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
    return { ...DEFAULT_SETTINGS, ...(result[STORAGE_KEYS.SETTINGS] || {}) };
  },

  /**
   * Save user settings (partial merge).
   * @param {object} settings
   */
  async saveSettings(settings) {
    const current = await this.getSettings();
    await chrome.storage.local.set({
      [STORAGE_KEYS.SETTINGS]: { ...current, ...settings },
    });
  },

  /**
   * Get aggregate stats.
   * @returns {Promise<object>}
   */
  async getStats() {
    const result = await chrome.storage.local.get(STORAGE_KEYS.STATS);
    return { ...DEFAULT_STATS, ...(result[STORAGE_KEYS.STATS] || {}) };
  },

  /**
   * Save aggregate stats (partial merge).
   * @param {object} stats
   */
  async saveStats(stats) {
    const current = await this.getStats();
    await chrome.storage.local.set({
      [STORAGE_KEYS.STATS]: { ...current, ...stats },
    });
  },

  /**
   * Get problems due today (nextDueDate <= end of today).
   * @returns {Promise<object[]>}
   */
  async getDueProblems() {
    const problems = await this.getProblems();
    const now = new Date();
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

    return Object.values(problems)
      .filter(p => new Date(p.nextDueDate) <= endOfDay)
      .sort((a, b) => new Date(a.nextDueDate) - new Date(b.nextDueDate));
  },

  /**
   * Get upcoming problems (not due today, sorted by next due).
   * @returns {Promise<object[]>}
   */
  async getUpcomingProblems() {
    const problems = await this.getProblems();
    const now = new Date();
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

    return Object.values(problems)
      .filter(p => new Date(p.nextDueDate) > endOfDay)
      .sort((a, b) => new Date(a.nextDueDate) - new Date(b.nextDueDate));
  },
};
