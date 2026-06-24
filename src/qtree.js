/**
 * qtree-js - Render TikZ-qtree trees in the browser using TikZJax
 */

// Use local tikzjax build with tikz-qtree support
const TIKZJAX_DEFAULT = '/syntree-tikzqtree/dist/tikzjax/tikzjax.js';

/**
 * Default TikZ preamble for qtree trees.
 *
 * Includes Cyrillic (T2A fontenc + cm-unicode), IPA (tipa), and amsmath.
 * All of these packages are bundled inside tikzjax.js and load correctly.
 */
const DEFAULT_PREAMBLE = `\\usepackage[T3,T2A,T1]{fontenc}\\usepackage[utf8]{inputenc}\\usepackage{cm-unicode}\\usepackage{amsmath}\\usepackage[noenc]{tipa}\\usetikzlibrary{positioning}`;

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
        if (window.TikzJax) { tikzjaxLoaded = true; resolve(); return; }
        existingScript.addEventListener('load', function() {
          tikzjaxLoaded = true; resolve();
        }, { once: true });
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

  // Convert any CJK/East-Asian characters to plain TeX font commands so the
  // TeX engine can render them without the CJK LaTeX package (which has missing
  // dependencies in the bundled TikZJax). TFM data for CJK subfonts (gbsnuXX)
  // is available synchronously via dvi2html's tfmData(). The remapCJKChars()
  // post-processor in run-tex.ts reconstructs Unicode from the raw char codes.
  const finalCode = cjkToTex(tikzCode);

  const preamble = options.preamble !== undefined ? options.preamble : config.preamble;

  // Create the script element
  const script = createTikZScript(finalCode, preamble);

  // Place script in a hidden off-screen div attached to body.
  const tempHolder = document.createElement('div');
  tempHolder.style.cssText = 'position:absolute;left:-99999px;top:-99999px;' +
                             'width:1px;height:1px;overflow:hidden;' +
                             'visibility:hidden;pointer-events:none';
  document.body.appendChild(tempHolder);
  tempHolder.appendChild(script);

  // Explicitly invoke tikzjax's processing pipeline so the MO isn't the
  // sole trigger (MO timing on cold load can be unreliable).
  // tikzjax.js is patched so D() guards `if(!A.loader)` before creating the
  // spinner, meaning only the first D() call wins — the MO's duplicate call
  // is a no-op, avoiding the A.loader overwrite race.
  if (typeof window._tjProcessScripts === 'function') {
    window._tjProcessScripts([script]);
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
 * Create qtree bracket notation from nested arrays.
 * @param {Array|string} node - [label, ...children] or a leaf string
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
 * Parse qtree bracket notation into nested arrays.
 * @param {string} qtree - Tree in bracket notation
 * @returns {Array} Nested array representation
 */
function toArray(qtree) {
  return parseTokens(tokenize(qtree));
}

/** @private */
function tokenize(str) {
  const tokens = [];
  let current = '';
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (char === '[' || char === ']') {
      if (current.trim()) { tokens.push(current.trim()); current = ''; }
      tokens.push(char);
    } else if (/\s/.test(char)) {
      if (current.trim()) { tokens.push(current.trim()); current = ''; }
    } else {
      current += char;
    }
  }
  if (current.trim()) tokens.push(current.trim());
  return tokens;
}

/** @private */
function parseTokens(tokens) {
  let pos = 0;
  function parse() {
    if (tokens[pos] === '[') {
      pos++;
      let label = tokens[pos];
      if (label.startsWith('.')) label = label.substring(1);
      pos++;
      const children = [];
      while (pos < tokens.length && tokens[pos] !== ']') children.push(parse());
      pos++; // skip ']'
      return [label, ...children];
    } else {
      return tokens[pos++];
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

export default QTree;
export {
  render,
  renderToString,
  processAll,
  configure,
  init,
  loadTikZJax,
  generateTikZCode,
  fromArray,
  toArray
};
