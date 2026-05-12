/**
 * LeetRecall — Problem Metadata Extractor
 * 
 * Extracts problem title, slug, difficulty, and tags from the LeetCode DOM.
 */

const Extractor = {
  /**
   * Extract problem slug from the current URL.
   * @returns {string} e.g., "two-sum"
   */
  getSlug() {
    const parts = window.location.pathname.split('/');
    // URL pattern: /problems/{slug}/...
    const idx = parts.indexOf('problems');
    return idx !== -1 ? parts[idx + 1] : '';
  },

  /**
   * Extract problem title from the page.
   * @returns {string}
   */
  getTitle() {
    // Try multiple selectors — LeetCode changes their DOM frequently
    const selectors = [
      '[data-cy="question-title"]',
      'div[class*="text-title-large"] a',
      'div[class*="flexlayout__tab"] span[class*="text-label"]',
      'a[href*="/problems/"] span',
    ];

    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el && el.textContent.trim()) {
        return el.textContent.trim();
      }
    }

    // Fallback: parse from page title
    const pageTitle = document.title;
    const match = pageTitle.match(/^(.+?)\s*[-–|]/);
    if (match) return match[1].trim();

    // Last resort: slugify the slug
    const slug = this.getSlug();
    return slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  },

  /**
   * Extract problem difficulty.
   * @returns {string} "Easy" | "Medium" | "Hard" | "Unknown"
   */
  getDifficulty() {
    // Try color-coded difficulty indicators
    const difficultySelectors = [
      { selector: 'div[class*="text-difficulty-easy"], div[class*="text-olive"]', value: 'Easy' },
      { selector: 'div[class*="text-difficulty-medium"], div[class*="text-yellow"]', value: 'Medium' },
      { selector: 'div[class*="text-difficulty-hard"], div[class*="text-pink"]', value: 'Hard' },
    ];

    for (const { selector, value } of difficultySelectors) {
      if (document.querySelector(selector)) {
        return value;
      }
    }

    // Try text-based detection
    const allText = document.body.innerText;
    const diffSection = document.querySelector('div[class*="DifficultyBadge"], div[diff]');
    if (diffSection) {
      const text = diffSection.textContent.trim().toLowerCase();
      if (text.includes('easy')) return 'Easy';
      if (text.includes('medium')) return 'Medium';
      if (text.includes('hard')) return 'Hard';
    }

    return 'Unknown';
  },

  /**
   * Extract problem tags/topics.
   * @returns {string[]}
   */
  getTags() {
    const tags = [];

    // Try to find topic tags
    const tagSelectors = [
      'a[href*="/tag/"] span',
      'div[class*="topic-tag"]',
      'a[class*="topic-tag"]',
    ];

    for (const selector of tagSelectors) {
      const elements = document.querySelectorAll(selector);
      elements.forEach(el => {
        const text = el.textContent.trim();
        if (text && !tags.includes(text)) {
          tags.push(text);
        }
      });
      if (tags.length > 0) break;
    }

    return tags;
  },

  /**
   * Extract all problem information.
   * @returns {object}
   */
  extractAll() {
    return {
      slug: this.getSlug(),
      title: this.getTitle(),
      url: `https://leetcode.com/problems/${this.getSlug()}/`,
      difficulty: this.getDifficulty(),
      tags: this.getTags(),
    };
  },
};
