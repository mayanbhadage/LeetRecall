/**
 * LeetRecall — Problem Metadata Extractor
 * 
 * Extracts problem title, slug, difficulty, and tags from the LeetCode DOM.
 */

const NUMBERED_TITLE_RE = /^(?:[A-Za-z]+\s*)*\d+[A-Za-z]?(?:\.\d+)?\.\s+/;

function formatProblemTitle(frontendId, title) {
  const cleanTitle = String(title || '').trim();
  const cleanFrontendId = String(frontendId || '').trim();

  if (!cleanTitle || NUMBERED_TITLE_RE.test(cleanTitle)) return cleanTitle;
  if (!cleanFrontendId) return cleanTitle;

  return `${cleanFrontendId}. ${cleanTitle.replace(NUMBERED_TITLE_RE, '')}`;
}

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
   * Find the question metadata embedded by LeetCode's Next.js payload.
   * @returns {object|null}
   */
  getNextQuestionData() {
    try {
      const nextData = document.getElementById('__NEXT_DATA__');
      if (!nextData || !nextData.textContent) return null;

      const payload = JSON.parse(nextData.textContent);
      const slug = this.getSlug();
      const stack = [payload];

      while (stack.length > 0) {
        const item = stack.pop();
        if (!item || typeof item !== 'object') continue;

        if (item.questionFrontendId && item.title && (!slug || !item.titleSlug || item.titleSlug === slug)) {
          return item;
        }

        Object.values(item).forEach(value => {
          if (value && typeof value === 'object') stack.push(value);
        });
      }
    } catch (e) {}

    return null;
  },

  /**
   * Extract the frontend problem id, e.g. "1" for Two Sum.
   * @returns {string}
   */
  getFrontendId() {
    const question = this.getNextQuestionData();
    if (question?.questionFrontendId) return String(question.questionFrontendId).trim();

    try {
      const nextData = document.getElementById('__NEXT_DATA__');
      if (nextData && nextData.textContent) {
        const idMatch = nextData.textContent.match(/"questionFrontendId"\s*:\s*"([^"]+)"/);
        if (idMatch) return idMatch[1].trim();
      }
    } catch (e) {}

    return '';
  },

  /**
   * Extract problem title from the page.
   * @returns {string}
   */
  getTitle() {
    const frontendId = this.getFrontendId();

    // 1. Try Next.js __NEXT_DATA__ first for the most accurate "1. Two Sum" format
    try {
      const question = this.getNextQuestionData();
      if (question?.title) {
        return formatProblemTitle(frontendId || question.questionFrontendId, question.title);
      }
    } catch (e) {}

    // 2. Try DOM selectors
    const selectors = [
      'div[class*="text-title-large"] a',
      'div[class*="text-title-large"]',
      '[data-cy="question-title"]',
    ];

    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el) {
        const text = el.textContent.trim();
        // Prevent single digit numbers or empty strings
        if (text && text.length > 1 && isNaN(Number(text))) {
          return formatProblemTitle(frontendId, text);
        }
      }
    }

    // Fallback: parse from page title
    const pageTitle = document.title;
    const match = pageTitle.match(/^(.+?)\s*[-–|]/);
    if (match) {
        const title = match[1].trim();
        if (title.length > 1 && isNaN(Number(title))) return formatProblemTitle(frontendId, title);
    }

    // Last resort: slugify the slug
    const slug = this.getSlug();
    const title = slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return formatProblemTitle(frontendId, title);
  },

  /**
   * Extract problem difficulty.
   * @returns {string} "Easy" | "Medium" | "Hard" | "Unknown"
   */
  getDifficulty() {
    const difficulties = [
      { value: 'Easy', classes: ['easy', 'olive', 'success', '00b8a3'] },
      { value: 'Medium', classes: ['medium', 'yellow', 'warning', 'ffc01e', 'brand-orange'] },
      { value: 'Hard', classes: ['hard', 'pink', 'danger', 'ff375f', 'red'] }
    ];

    // Try color-coded difficulty indicators using TreeWalker for exact text matches
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
    let node;
    while ((node = walker.nextNode())) {
      const text = node.nodeValue.trim();
      if (text === 'Easy' || text === 'Medium' || text === 'Hard') {
        const parent = node.parentElement;
        if (parent) {
          const className = (typeof parent.className === 'string' ? parent.className : '').toLowerCase();
          const diffMap = difficulties.find(d => d.value === text);
          if (diffMap && diffMap.classes.some(c => className.includes(c))) {
            return text;
          }
        }
      }
    }

    // Fallback: Check Next.js __NEXT_DATA__ script payload
    try {
      const nextData = document.getElementById('__NEXT_DATA__');
      if (nextData && nextData.textContent) {
        const match = nextData.textContent.match(/"difficulty"\s*:\s*"([^"]+)"/);
        if (match && ['Easy', 'Medium', 'Hard'].includes(match[1])) {
          return match[1];
        }
      }
    } catch (e) {}

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
      frontendId: this.getFrontendId(),
      title: this.getTitle(),
      url: `https://leetcode.com/problems/${this.getSlug()}/`,
      difficulty: this.getDifficulty(),
      tags: this.getTags(),
    };
  },
};
