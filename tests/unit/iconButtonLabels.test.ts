import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

const RENDERER_DIR = join(__dirname, "../../src/renderer");

// Lists every .tsx file under the renderer.
function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    // The overlay is being rebuilt in its own PRs (#53, #57), which label its buttons.
    if (entry.isDirectory()) return entry.name === "overlay" ? [] : tsxFiles(path);
    return entry.name.endsWith(".tsx") ? [path] : [];
  });
}

// True when a JSX child would render text VoiceOver can read.
function hasVisibleText(node: ts.Node): boolean {
  if (ts.isJsxText(node)) return node.text.trim().length > 0;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) return true;
  // An element marked aria-hidden adds no spoken text.
  if (ts.isJsxElement(node) && hasAttribute(node.openingElement, "aria-hidden")) return false;
  if (ts.isJsxSelfClosingElement(node)) return false;
  if (ts.isJsxElement(node) || ts.isJsxFragment(node)) return node.children.some(hasVisibleText);
  if (ts.isJsxExpression(node)) return node.expression ? hasVisibleText(node.expression) : false;
  if (ts.isParenthesizedExpression(node)) return hasVisibleText(node.expression);
  // Only the rendered branches matter, not the condition.
  if (ts.isConditionalExpression(node)) return hasVisibleText(node.whenTrue) || hasVisibleText(node.whenFalse);
  if (ts.isBinaryExpression(node)) return hasVisibleText(node.right);
  // Any other expression ({label}, {it.name}) renders a value as text.
  return true;
}

// True when the opening tag sets the named attribute.
function hasAttribute(tag: ts.JsxOpeningLikeElement, name: string): boolean {
  return tag.attributes.properties.some((prop) => ts.isJsxAttribute(prop) && prop.name.getText() === name);
}

// Returns file:line for each native <button> with no text and no aria-label or title.
function unlabeledIconButtons(): string[] {
  const misses: string[] = [];
  for (const file of tsxFiles(RENDERER_DIR)) {
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node: ts.Node): void => {
      if (ts.isJsxElement(node) && node.openingElement.tagName.getText() === "button") {
        const tag = node.openingElement;
        const labeled = hasAttribute(tag, "aria-label") || hasAttribute(tag, "title");
        if (!labeled && !node.children.some(hasVisibleText)) {
          const { line } = source.getLineAndCharacterOfPosition(tag.getStart());
          misses.push(`${relative(RENDERER_DIR, file)}:${line + 1}`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return misses;
}

describe("renderer icon-only buttons", () => {
  it("all have a spoken label", () => {
    expect(unlabeledIconButtons()).toEqual([]);
  });
});
