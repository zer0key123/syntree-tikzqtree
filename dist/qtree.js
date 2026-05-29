(function (global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) :
  typeof define === 'function' && define.amd ? define(['exports'], factory) :
  (global = typeof globalThis !== 'undefined' ? globalThis : global || self, factory(global.QTree = {}));
})(this, (function (exports) { 'use strict';

  /**
   * qtree-js - Render TikZ-qtree trees in the browser using TikZJax
   */

  // Use local tikzjax build with tikz-qtree support
  const TIKZJAX_DEFAULT = '/syntree-tikzqtree/dist/tikzjax/tikzjax.js';

  /**
   * Default TikZ preamble for qtree trees.
   *
   * Kept minimal so that TeX compilation succeeds on the first cold-cache render.
   * Extra packages (e.g. Cyrillic or IPA support) can be added via the
   * "extra preamble" field in the UI or via QTree.configure({ preamble: '...' }).
   *
   * For Cyrillic add:
   *   \usepackage[T2A]{fontenc}\usepackage[utf8]{inputenc}\usepackage{cm-unicode}
   * For IPA add:
   *   \usepackage[noenc]{tipa}
   */
  const DEFAULT_PREAMBLE = `\\usepackage{amsmath}\\usetikzlibrary{positioning}`;

  /**
   * Configuration options
   */
  let config = {
    tikzjaxUrl: TIKZJAX_DEFAULT,
    fontsUrl: '/syntree-tikzqtree/dist/tikzjax/fonts.css',
    preamble: DEFAULT_PREAMBLE,
    autoInit: true
  };

  /**
   * Track if TikZJax has been loaded
   */
  let tikzjaxLoaded = false;
  let tikzjaxLoading = null;

  /**
   * Load TikZJax library dynamically
   * @returns {Promise<void>}
   */
  function loadTikZJax() {
    if (tikzjaxLoaded) {
      return Promise.resolve();
    }

    // If tikzjax was pre-loaded via a <script> tag in the page HTML,
    // window.TikzJax will already be true — skip creating a second script element.
    if (typeof window !== 'undefined' && window.TikzJax) {
      tikzjaxLoaded = true;
      return Promise.resolve();
    }

    if (tikzjaxLoading) {
      return tikzjaxLoading;
    }

    // Check if a <script> element pointing to tikzjax.js already exists in the
    // document (added by the page's HTML before qtree.js loaded). If it does,
    // avoid injecting a second copy — just wait for it to execute. This prevents
    // a double-load race where both scripts execute, the second skips the H-init
    // guard (window.TikzJax already true), and window._tjProcessScripts gets
    // overwritten with a broken I() closure where H is undefined.
    if (typeof document !== 'undefined') {
      const existingScript = Array.prototype.find.call(
        document.querySelectorAll('script[src]'),
        function(s) { return s.src && s.src.indexOf('tikzjax') !== -1; }
      );
      if (existingScript) {
        tikzjaxLoading = new Promise(function(resolve) {
          // Already executed (readyState complete or window.TikzJax set)?
          if (window.TikzJax) { tikzjaxLoaded = true; resolve(); return; }
          // Still loading — wait for its load event.
          existingScript.addEventListener('load', function() {
            tikzjaxLoaded = true; resolve();
          }, { once: true });
          // Safety: also poll in case the load event already fired without us.
          setTimeout(function() {
            if (window.TikzJax) { tikzjaxLoaded = true; resolve(); }
          }, 50);
        });
        return tikzjaxLoading;
      }
    }

    tikzjaxLoading = new Promise((resolve, reject) => {
      // Add the required link element for TikZJax CSS
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.type = 'text/css';
      link.href = config.fontsUrl;
      document.head.appendChild(link);

      // Load the TikZJax script
      const script = document.createElement('script');
      script.src = config.tikzjaxUrl;
      script.async = true;

      script.onload = () => {
        tikzjaxLoaded = true;
        resolve();
      };

      script.onerror = () => {
        tikzjaxLoading = null;
        reject(new Error('Failed to load TikZJax'));
      };

      document.head.appendChild(script);
    });

    return tikzjaxLoading;
  }

  /**
   * Generate TikZ code for a qtree or raw TikZ input
   * @param {string} tree - qtree bracket notation, raw TikZ body, or complete tikzpicture
   * @param {object} options - Rendering options
   * @param {boolean} [options.raw] - If true, treat tree as raw TikZ body (no \Tree prefix)
   * @returns {string} Complete TikZ code
   */
  function generateTikZCode(tree, options = {}) {
    const {
      tikzOptions = '',
      treeOptions = '',
      afterTree = '',
      raw = false
    } = options;

    // Complete tikzpicture passed directly — return verbatim
    if (tree.trim().startsWith('\\begin{tikzpicture}')) {
      return tree;
    }

    const tikzOptionsStr = tikzOptions ? `[${tikzOptions}]` : '';
    let code = `\\begin{tikzpicture}${tikzOptionsStr}\n`;

    if (raw) {
      // Raw TikZ body: multiple \Tree commands, \begin{scope}, \draw, etc.
      code += `${tree}\n`;
      if (afterTree) {
        code += `${afterTree}\n`;
      }
    } else {
      // qtree bracket notation: single tree, prepend \Tree
      // Auto-fix missing spaces before ] (e.g. "cat]" → "cat ]")
      const fixedTree = tree.replace(/([^\s])\]/g, '$1 ]');
      const treeOptionsStr = treeOptions ? `[${treeOptions}]` : '';
      code += `\\Tree ${treeOptionsStr}${fixedTree}\n`;
      if (afterTree) {
        code += `${afterTree}\n`;
      }
    }

    code += `\\end{tikzpicture}`;
    return code;
  }

  /**
   * Convert CJK/East-Asian characters in a TeX string to plain TeX font commands.
   *
   * Each character U+XXYY (page=XX, position=YY) becomes:
   *   {\font\qtreecjk=gbsnuXX\qtreecjk\charYY}
   *
   * This bypasses the CJK LaTeX package entirely. TFM data for gbsnuXX fonts is
   * served synchronously by dvi2html's tfmData() call in library.ts, so no async
   * file loading is needed. The remapCJKChars() post-processor in run-tex.ts then
   * converts the raw char codes back to Unicode code points in the final SVG.
   *
   * Characters not in the CJK Unicode block (U+3000-U+9FFF) are passed through unchanged.
   */
  function cjkToTex(str) {
    let result = '';
    for (const char of str) {
      const cp = char.codePointAt(0);
      if (cp >= 0x3000 && cp <= 0x9FFF) {
        const page = (cp >> 8) & 0xFF;
        const pos = cp & 0xFF;
        const pageHex = page.toString(16).padStart(2, '0');
        result += `{\\font\\qtreecjk=gbsnu${pageHex}\\qtreecjk\\char${pos}}`;
      } else {
        result += char;
      }
    }
    return result;
  }

  /**
   * Create a script element for TikZJax rendering
   * @param {string} tikzCode - The TikZ code to render
   * @param {string} preamble - LaTeX preamble
   * @returns {HTMLScriptElement}
   */
  function createTikZScript(tikzCode, preamble = config.preamble) {
    const script = document.createElement('script');
    script.type = 'text/tikz';
    // TikZJax uses data-add-to-preamble for raw preamble additions
    if (preamble) {
      script.setAttribute('data-add-to-preamble', preamble);
    }
    script.textContent = tikzCode;
    return script;
  }

  /**
   * Render a qtree into a container element
   * @param {string|HTMLElement} container - Container element or selector
   * @param {string} tree - Tree in qtree bracket notation
   * @param {object} options - Rendering options
   * @returns {Promise<HTMLElement>} The rendered SVG element
   */
  async function render(container, tree, options = {}) {
    // Get container element
    const containerEl = typeof container === 'string'
      ? document.querySelector(container)
      : container;

    if (!containerEl) {
      throw new Error('Container element not found');
    }

    // Ensure TikZJax is loaded
    await loadTikZJax();

    // TikZJax's c() runs on window.load (or immediately if readyState === 'complete').
    // Wait for the page to be fully loaded before proceeding.
    if (document.readyState !== 'complete') {
      await new Promise(resolve => window.addEventListener('load', resolve, { once: true }));
    }

    // Generate TikZ code
    const tikzCode = generateTikZCode(tree, options);

    // Convert any CJK/East-Asian characters to plain TeX font commands.
    const finalCode = cjkToTex(tikzCode);

    const preamble = options.preamble !== undefined ? options.preamble : config.preamble;

    // Create the script element
    const script = createTikZScript(finalCode, preamble);

    // Place the script in a hidden off-screen div attached directly to body.
    // tikzjax's processing pipeline (window._tjProcessScripts) is called
    // explicitly below — we no longer rely on tikzjax's MutationObserver.
    // The tempHolder must be in the live DOM so tikzjax's D() can call
    // script.replaceWith(spinner) successfully.
    const tempHolder = document.createElement('div');
    tempHolder.style.cssText = 'position:absolute;left:-99999px;top:-99999px;' +
                               'width:1px;height:1px;overflow:hidden;' +
                               'visibility:hidden;pointer-events:none';
    document.body.appendChild(tempHolder);
    tempHolder.appendChild(script);

    // --- Direct invocation ---
    // window._tjProcessScripts is I() from tikzjax, exposed by our one-line
    // patch in tikzjax.js: window._tjProcessScripts = I;
    // Calling it directly bypasses the MutationObserver entirely.
    if (typeof window._tjProcessScripts === 'function') {
      window._tjProcessScripts([script]);
    } else {
      // Fallback: tikzjax.js wasn't patched — try the MO-intercept trigger.
      Promise.resolve().then(() => {
        if (window._tjTrigger) {
          const s = tempHolder.querySelector('script[type="text/tikz"]');
          if (s === script) window._tjTrigger(script);
        }
      });
    }

    // Wait for TikZJax to process
    return new Promise((resolve, reject) => {
      let timeoutId;

      // TikZJax fires 'tikzjax-load-finished' on the final SVG (bubbles:true)
      // once rendering is complete — for both cached results and fresh TeX runs.
      const onFinished = () => {
        tempHolder.removeEventListener('tikzjax-load-finished', onFinished);
        clearTimeout(timeoutId);
        const svgEl = tempHolder.querySelector('svg');
        if (svgEl) {
          if (!svgEl.querySelector('title')) {
            const titleEl = document.createElementNS('http://www.w3.org/2000/svg', 'title');
            titleEl.textContent = tree;
            svgEl.insertBefore(titleEl, svgEl.firstChild);
          }
          svgEl.setAttribute('role', 'img');
          svgEl.setAttribute('aria-label', tree);
          // Move the finished SVG into the visible container
          containerEl.innerHTML = '';
          containerEl.appendChild(svgEl);
          containerEl.dataset.qtreeSource = tree;
          if (tempHolder.parentNode) document.body.removeChild(tempHolder);
          resolve(svgEl);
        } else {
          if (tempHolder.parentNode) document.body.removeChild(tempHolder);
          reject(new Error('TikZJax finished but no SVG found'));
        }
      };

      tempHolder.addEventListener('tikzjax-load-finished', onFinished);

      // Timeout after 90 seconds (TeX compilation is slow on first cold render:
      // the Worker must decompress ~70 MB of pre-built format + run WebAssembly).
      timeoutId = setTimeout(() => {
        tempHolder.removeEventListener('tikzjax-load-finished', onFinished);
        if (tempHolder.parentNode) document.body.removeChild(tempHolder);
        reject(new Error('TikZJax rendering timed out'));
      }, 90000);
    });
  }

  /**
   * Render a qtree and return the SVG as a string
   * @param {string} tree - Tree in qtree bracket notation
   * @param {object} options - Rendering options
   * @returns {Promise<string>} SVG markup
   */
  async function renderToString(tree, options = {}) {
    // Create a temporary container
    const temp = document.createElement('div');
    temp.style.position = 'absolute';
    temp.style.left = '-9999px';
    temp.style.top = '-9999px';
    document.body.appendChild(temp);

    try {
      const svg = await render(temp, tree, options);
      return svg.outerHTML;
    } finally {
      document.body.removeChild(temp);
    }
  }

  /**
   * Process all elements with data-qtree or data-tikz attributes
   * - data-qtree: qtree bracket notation, wrapped as \begin{tikzpicture}\Tree ...\end{tikzpicture}
   * - data-tikz: raw TikZ body or complete \begin{tikzpicture}...\end{tikzpicture} block
   * @returns {Promise<void>}
   */
  async function processAll() {
    const elements = document.querySelectorAll('[data-qtree], [data-tikz]');

    for (const el of elements) {
      const isRaw = el.hasAttribute('data-tikz');
      const content = isRaw
        ? (el.getAttribute('data-tikz') || el.textContent)
        : (el.getAttribute('data-qtree') || el.textContent);

      const options = {
        tikzOptions: el.getAttribute('data-tikz-options') || '',
        treeOptions: el.getAttribute('data-tree-options') || '',
        preamble: el.getAttribute('data-preamble') || config.preamble,
        raw: isRaw
      };

      try {
        await render(el, content, options);
      } catch (error) {
        console.error('Failed to render:', error);
        el.innerHTML = `<span class="qtree-error">Error: ${error.message}</span>`;
      }
    }
  }

  /**
   * Configure qtree-js
   * @param {object} options - Configuration options
   */
  function configure(options) {
    Object.assign(config, options);
  }

  /**
   * Initialize qtree-js
   * Loads TikZJax and processes any existing qtree elements
   */
  async function init() {
    await loadTikZJax();

    if (config.autoInit) {
      // Process existing elements
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', processAll);
      } else {
        await processAll();
      }
    }
  }

  /**
   * Create a simple tree from nested arrays
   * @param {Array|string} node - Node data
   * @returns {string} qtree bracket notation
   */
  function fromArray(node) {
    if (typeof node === 'string') {
      return node;
    }

    if (!Array.isArray(node) || node.length === 0) {
      throw new Error('Invalid tree structure');
    }

    const [label, ...children] = node;

    if (children.length === 0) {
      return label;
    }

    const childrenStr = children.map(fromArray).join(' ');
    return `[.${label} ${childrenStr} ]`;
  }

  /**
   * Parse qtree bracket notation into nested arrays
   * @param {string} qtree - Tree in bracket notation
   * @returns {Array} Nested array representation
   */
  function toArray(qtree) {
    const tokens = tokenize(qtree);
    const result = parseTokens(tokens);
    return result;
  }

  /**
   * Tokenize qtree string
   * @param {string} str - qtree string
   * @returns {Array<string>} tokens
   */
  function tokenize(str) {
    const tokens = [];
    let current = '';
    let i = 0;

    while (i < str.length) {
      const char = str[i];

      if (char === '[' || char === ']') {
        if (current.trim()) {
          tokens.push(current.trim());
          current = '';
        }
        tokens.push(char);
        i++;
      } else if (/\s/.test(char)) {
        if (current.trim()) {
          tokens.push(current.trim());
          current = '';
        }
        i++;
      } else {
        current += char;
        i++;
      }
    }

    if (current.trim()) {
      tokens.push(current.trim());
    }

    return tokens;
  }

  /**
   * Parse tokens into tree structure
   * @param {Array<string>} tokens - tokens
   * @returns {Array} tree structure
   */
  function parseTokens(tokens) {
    let pos = 0;

    function parse() {
      if (tokens[pos] === '[') {
        pos++; // skip '['

        // Get the label (may start with '.')
        let label = tokens[pos];
        if (label.startsWith('.')) {
          label = label.substring(1);
        }
        pos++;

        const children = [];
        while (pos < tokens.length && tokens[pos] !== ']') {
          children.push(parse());
        }

        pos++; // skip ']'

        return [label, ...children];
      } else {
        // Leaf node
        const value = tokens[pos];
        pos++;
        return value;
      }
    }

    return parse();
  }

  // Export API
  const QTree = {
    render,
    renderToString,
    processAll,
    configure,
    init,
    loadTikZJax,
    generateTikZCode,
    fromArray,
    toArray,
    defaultPreamble: DEFAULT_PREAMBLE,
    version: '1.0.0'
  };

  // Auto-init if script is loaded directly in browser
  if (typeof window !== 'undefined') {
    window.QTree = QTree;

    // Auto-init on DOMContentLoaded if not disabled
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        if (config.autoInit && document.querySelector('[data-qtree]')) {
          init();
        }
      });
    }
  }

  exports.configure = configure;
  exports.default = QTree;
  exports.fromArray = fromArray;
  exports.generateTikZCode = generateTikZCode;
  exports.init = init;
  exports.loadTikZJax = loadTikZJax;
  exports.processAll = processAll;
  exports.render = render;
  exports.renderToString = renderToString;
  exports.toArray = toArray;

  Object.defineProperty(exports, '__esModule', { value: true });

}));
