/**
 * AI RESEARCH HUB — CONTENT SANITIZATION & RSC COMPLIANCE
 *
 * TipTap / ProseMirror builds node and mark `attrs` using `Object.create(null)`
 * (null-prototype objects) in `computeAttrs()`, `initAttrs()`, and `defaultAttrs()`.
 *
 * In Next.js App Router (React Server Actions), argument serialization enforces:
 *   proto !== ObjectPrototype && (proto === null || getPrototypeOf(proto) !== null)
 * When a null-prototype object crosses the Server Action boundary, Next.js throws:
 *   "Only plain objects, and a few built-ins, can be passed to Server Actions. Classes or null prototypes are not supported."
 *
 * This utility recursively sanitizes TipTap JSON trees to guarantee that all
 * objects inherit from Object.prototype, preserving the exact document hierarchy,
 * node types, marks, text, and attributes without loss or corruption.
 */

export function toPlainTipTapJson<T = any>(value: T): T {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => toPlainTipTapJson(item)) as unknown as T;
  }

  // Clone into a fresh plain object with Object.prototype
  const plainObj: Record<string, any> = {};
  for (const key of Object.keys(value as object)) {
    const val = (value as any)[key];
    plainObj[key] = toPlainTipTapJson(val);
  }

  return plainObj as T;
}

/**
 * Validates whether an object is completely RSC-serializable (has no null prototypes or classes).
 * Returns true if safe to pass to a Next.js Server Action.
 */
export function isRscSerializable(value: any): boolean {
  if (value === null || typeof value !== "object") {
    return true;
  }

  if (Array.isArray(value)) {
    return value.every(isRscSerializable);
  }

  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype) {
    return false;
  }

  for (const key of Object.keys(value)) {
    if (!isRscSerializable(value[key])) {
      return false;
    }
  }

  return true;
}

/**
 * Deep structural comparison for TipTap JSON document ASTs and node attributes.
 * - JSON Object keys are treated as unordered maps (e.g. { a: 1, b: 2 } === { b: 2, a: 1 }).
 * - JSON Arrays (such as block content and marks) strictly preserve item order.
 * - Primitives and nulls are compared via strict equality.
 */
export function areTipTapNodesEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") {
    return a === b;
  }

  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime();
  }

  const isArrA = Array.isArray(a);
  const isArrB = Array.isArray(b);
  if (isArrA !== isArrB) return false;

  if (isArrA && isArrB) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!areTipTapNodesEqual(a[i], b[i])) return false;
    }
    return true;
  }

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (!areTipTapNodesEqual(a[key], b[key])) return false;
  }

  return true;
}
