/**
 * HTML Evaluation Service
 * Evaluates student HTML code against teacher-defined constraints:
 *   1. Required Tags (flat rules) — tag must appear N times
 *   2. Nesting Constraints (tree rules) — tag must contain children in proper structure
 *
 * Returns results in the same format as the execution service so the frontend
 * can display them identically.
 */

import { JSDOM } from 'jsdom';

// ─── Required Tags Evaluator ───────────────────────────────────────────────

/**
 * Evaluate flat required-tag constraints.
 * @param {Document} doc - parsed DOM document
 * @param {Array} requiredTags - [{tag, minCount, maxCount, message}]
 * @returns {Array} results [{constraint, type, passed, message, count}]
 */
function evaluateRequiredTags(doc, requiredTags) {
  const results = [];

  for (const rule of requiredTags) {
    const tag = rule.tag.toLowerCase();
    const elements = doc.querySelectorAll(tag);
    const count = elements.length;
    const min = rule.minCount ?? 1;
    const max = rule.maxCount ?? 0; // 0 = no max

    let passed = count >= min;
    if (max > 0 && count > max) passed = false;

    let message;
    if (passed) {
      message = `Found ${count} <${tag}> element(s) — meets requirement.`;
    } else if (count < min) {
      message = rule.message || `Expected at least ${min} <${tag}> element(s), found ${count}.`;
    } else {
      message = rule.message || `Expected at most ${max} <${tag}> element(s), found ${count}.`;
    }

    results.push({
      constraint: `<${tag}>`,
      type: 'Required Tag',
      passed,
      message,
      count,
      expected: max > 0 ? `${min}-${max}` : `≥${min}`
    });
  }

  return results;
}

// ─── Nesting Constraints Evaluator ─────────────────────────────────────────

/**
 * Recursively evaluate a nesting constraint node against a set of parent elements.
 *
 * @param {NodeList|Array} parentElements - DOM elements that matched the parent
 * @param {Object} node - nesting constraint node {tag, minCount, message, children}
 * @param {string} path - human-readable path for reporting (e.g. "ul > li > img")
 * @returns {Array} flat array of result objects
 */
function evaluateNestingNode(parentElements, node, path) {
  const results = [];
  const tag = node.tag.toLowerCase();
  const min = node.minCount ?? 1;
  const currentPath = path ? `${path} > ${tag}` : tag;

  // Count how many times the tag appears as a *direct or nested* child of any parent
  let totalCount = 0;
  const matchedElements = [];

  for (const parent of parentElements) {
    // Use querySelectorAll scoped to the parent — finds at any depth below parent
    const found = parent.querySelectorAll(`:scope > ${tag}`);
    totalCount += found.length;
    matchedElements.push(...found);
  }

  const passed = totalCount >= min;
  const message = passed
    ? `Found ${totalCount} <${tag}> inside ${path || 'root'} — meets requirement.`
    : (node.message || `Expected at least ${min} <${tag}> inside ${path || 'root'}, found ${totalCount}.`);

  results.push({
    constraint: currentPath,
    type: 'Nesting',
    passed,
    message,
    count: totalCount,
    expected: `≥${min}`
  });

  // Recurse into children
  if (node.children && node.children.length > 0 && matchedElements.length > 0) {
    for (const child of node.children) {
      const childResults = evaluateNestingNode(matchedElements, child, currentPath);
      results.push(...childResults);
    }
  } else if (node.children && node.children.length > 0 && matchedElements.length === 0) {
    // Parent not found — mark all children as failed
    for (const child of node.children) {
      const childTag = child.tag?.toLowerCase() || '?';
      const childPath = `${currentPath} > ${childTag}`;
      results.push({
        constraint: childPath,
        type: 'Nesting',
        passed: false,
        message: `Parent <${tag}> not found — cannot verify <${childTag}>.`,
        count: 0,
        expected: `≥${child.minCount ?? 1}`
      });
      // Continue recursion for deeper children to report them all
      if (child.children && child.children.length > 0) {
        const deeper = evaluateNestingNode([], child, childPath);
        results.push(...deeper);
      }
    }
  }

  return results;
}

/**
 * Evaluate nesting constraints starting from the document body.
 * @param {Document} doc
 * @param {Array} nestingConstraints - top-level nesting nodes
 * @returns {Array} flat results array
 */
function evaluateNestingConstraints(doc, nestingConstraints) {
  const results = [];
  const body = doc.body || doc.documentElement;

  for (const rootNode of nestingConstraints) {
    // Top-level: search from body
    const tag = rootNode.tag.toLowerCase();
    const min = rootNode.minCount ?? 1;
    const topElements = body.querySelectorAll(tag);
    const count = topElements.length;
    const passed = count >= min;

    results.push({
      constraint: tag,
      type: 'Nesting',
      passed,
      message: passed
        ? `Found ${count} <${tag}> element(s) — meets requirement.`
        : (rootNode.message || `Expected at least ${min} <${tag}> element(s), found ${count}.`),
      count,
      expected: `≥${min}`
    });

    // Evaluate children if top-level elements found
    if (rootNode.children && rootNode.children.length > 0) {
      if (topElements.length > 0) {
        for (const child of rootNode.children) {
          const childResults = evaluateNestingNode([...topElements], child, tag);
          results.push(...childResults);
        }
      } else {
        // Top not found — mark children failed
        for (const child of rootNode.children) {
          const childResults = evaluateNestingNode([], child, tag);
          results.push(...childResults);
        }
      }
    }
  }

  return results;
}

// ─── Main Evaluator ────────────────────────────────────────────────────────

/**
 * Evaluate HTML code against all constraints and return results in the
 * same format as the execution service's formatAPIResponse.
 *
 * @param {string} htmlCode - student's HTML code
 * @param {Array} htmlRequiredTags - flat rules
 * @param {Array} htmlNestingConstraints - tree rules
 * @param {number} taskMarks - total marks for the task
 * @returns {Object} evaluation result matching execution service format
 */
export function evaluateHTML(htmlCode, htmlRequiredTags = [], htmlNestingConstraints = [], taskMarks = 10) {
  // Parse the HTML
  let doc;
  try {
    const dom = new JSDOM(htmlCode);
    doc = dom.window.document;
  } catch (err) {
    return buildErrorResponse(`Failed to parse HTML: ${err.message}`);
  }

  // Evaluate both constraint types
  const tagResults = evaluateRequiredTags(doc, htmlRequiredTags);
  const nestingResults = evaluateNestingConstraints(doc, htmlNestingConstraints);

  // Merge into a unified "structural" results array
  const allResults = [...tagResults, ...nestingResults];
  const passed = allResults.filter(r => r.passed).length;
  const failed = allResults.filter(r => !r.passed).length;
  const total = allResults.length;

  // Score calculation (out of 10)
  const score = total > 0 ? Math.round((passed / total) * 10 * 10) / 10 : 10;

  // Build terminal output
  const terminal = formatHtmlTerminal(htmlCode, tagResults, nestingResults, score);

  return {
    success: true,
    score,
    maxScore: 10,
    output: htmlCode.substring(0, 500), // preview of the code
    error: null,
    testCases: {
      passed: 0,
      failed: 0,
      total: 0,
      details: []
    },
    structural: {
      passed,
      failed,
      total,
      details: allResults.map(r => ({
        constraint: r.constraint,
        type: r.type,
        count: r.count,
        passed: r.passed,
        message: r.message,
        nestingLevel: null
      }))
    },
    htmlEvaluation: {
      requiredTags: {
        passed: tagResults.filter(r => r.passed).length,
        failed: tagResults.filter(r => !r.passed).length,
        total: tagResults.length,
        details: tagResults
      },
      nestingConstraints: {
        passed: nestingResults.filter(r => r.passed).length,
        failed: nestingResults.filter(r => !r.passed).length,
        total: nestingResults.length,
        details: nestingResults
      }
    },
    terminal
  };
}

// ─── Terminal Formatter ────────────────────────────────────────────────────

function formatHtmlTerminal(htmlCode, tagResults, nestingResults, score) {
  const lines = [];

  lines.push('═══════════════════════════════════════════════════════');
  lines.push('            HTML EVALUATION RESULTS');
  lines.push('═══════════════════════════════════════════════════════');
  lines.push('');

  // Required Tags Section
  if (tagResults.length > 0) {
    lines.push('🏷️  REQUIRED TAGS:');
    lines.push('───────────────────────────────────────────────────────');

    for (const r of tagResults) {
      const icon = r.passed ? '✅' : '❌';
      const status = r.passed ? 'PASSED' : 'FAILED';
      lines.push(`${icon} ${r.constraint} (expected: ${r.expected}, found: ${r.count}): ${status}`);
      lines.push(`   ${r.message}`);
      lines.push('');
    }

    const tagPassed = tagResults.filter(r => r.passed).length;
    lines.push(`Summary: ${tagPassed}/${tagResults.length} passed`);
    lines.push('───────────────────────────────────────────────────────');
    lines.push('');
  }

  // Nesting Constraints Section
  if (nestingResults.length > 0) {
    lines.push('🌳 NESTING CONSTRAINTS:');
    lines.push('───────────────────────────────────────────────────────');

    for (const r of nestingResults) {
      const icon = r.passed ? '✅' : '❌';
      const status = r.passed ? 'PASSED' : 'FAILED';
      lines.push(`${icon} ${r.constraint} (expected: ${r.expected}, found: ${r.count}): ${status}`);
      lines.push(`   ${r.message}`);
      lines.push('');
    }

    const nestPassed = nestingResults.filter(r => r.passed).length;
    lines.push(`Summary: ${nestPassed}/${nestingResults.length} passed`);
    lines.push('───────────────────────────────────────────────────────');
    lines.push('');
  }

  // Final Score
  lines.push('🎯 FINAL SCORE:');
  lines.push('───────────────────────────────────────────────────────');
  lines.push(`   ${score} / 10`);

  const totalPassed = tagResults.filter(r => r.passed).length + nestingResults.filter(r => r.passed).length;
  const totalCount = tagResults.length + nestingResults.length;
  if (totalCount > 0) {
    lines.push('');
    lines.push('   Breakdown:');
    if (tagResults.length > 0) {
      lines.push(`   • Required Tags: ${tagResults.filter(r => r.passed).length}/${tagResults.length} passed`);
    }
    if (nestingResults.length > 0) {
      lines.push(`   • Nesting Rules: ${nestingResults.filter(r => r.passed).length}/${nestingResults.length} passed`);
    }
  }

  lines.push('═══════════════════════════════════════════════════════');

  return lines.join('\n');
}

// ─── Error Response Builder ────────────────────────────────────────────────

function buildErrorResponse(errorMessage) {
  return {
    success: false,
    score: 0,
    maxScore: 10,
    output: '',
    error: errorMessage,
    testCases: { passed: 0, failed: 0, total: 0, details: [] },
    structural: { passed: 0, failed: 0, total: 0, details: [] },
    htmlEvaluation: null,
    terminal: `❌ ERROR: ${errorMessage}`
  };
}
