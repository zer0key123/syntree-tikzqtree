/**
 * qtree-js - Render TikZ-qtree trees in the browser using TikZJax
 */

export interface RenderOptions {
  /** Custom LaTeX preamble */
  preamble?: string;
  /** TikZ picture options (e.g., "scale=1.5") */
  tikzOptions?: string;
  /** Tree options for \\Tree command */
  treeOptions?: string;
}

export interface ConfigOptions {
  /** URL to load TikZJax from */
  tikzjaxUrl?: string;
  /** Default LaTeX preamble */
  preamble?: string;
  /** Auto-initialize on DOM ready */
  autoInit?: boolean;
}

export type TreeNode = string | [string, ...TreeNode[]];

/**
 * Render a qtree into a container element
 * @param container - Container element or CSS selector
 * @param tree - Tree in qtree bracket notation
 * @param options - Rendering options
 * @returns The rendered SVG element
 */
export function render(
  container: string | HTMLElement,
  tree: string,
  options?: RenderOptions
): Promise<SVGElement>;

/**
 * Render a qtree and return the SVG as a string
 * @param tree - Tree in qtree bracket notation
 * @param options - Rendering options
 * @returns SVG markup string
 */
export function renderToString(
  tree: string,
  options?: RenderOptions
): Promise<string>;

/**
 * Process all elements with data-qtree attribute
 */
export function processAll(): Promise<void>;

/**
 * Configure qtree-js global options
 * @param options - Configuration options
 */
export function configure(options: ConfigOptions): void;

/**
 * Initialize qtree-js
 * Loads TikZJax and processes any existing qtree elements
 */
export function init(): Promise<void>;

/**
 * Load TikZJax library
 */
export function loadTikZJax(): Promise<void>;

/**
 * Generate TikZ code for a qtree
 * @param tree - Tree in qtree bracket notation
 * @param options - Rendering options
 * @returns Complete TikZ code
 */
export function generateTikZCode(tree: string, options?: RenderOptions): string;

/**
 * Create qtree bracket notation from nested arrays
 * @param node - Nested array tree structure
 * @returns qtree bracket notation string
 */
export function fromArray(node: TreeNode): string;

/**
 * Parse qtree bracket notation into nested arrays
 * @param qtree - Tree in bracket notation
 * @returns Nested array representation
 */
export function toArray(qtree: string): TreeNode;

declare const QTree: {
  render: typeof render;
  renderToString: typeof renderToString;
  processAll: typeof processAll;
  configure: typeof configure;
  init: typeof init;
  loadTikZJax: typeof loadTikZJax;
  generateTikZCode: typeof generateTikZCode;
  fromArray: typeof fromArray;
  toArray: typeof toArray;
  version: string;
};

export default QTree;

declare global {
  interface Window {
    QTree: typeof QTree;
  }
}
