/** Reserved words that would produce invalid or shadowing identifiers. */
const RESERVED = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default',
  'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally',
  'for', 'function', 'if', 'import', 'in', 'instanceof', 'new', 'null',
  'return', 'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof',
  'var', 'void', 'while', 'with', 'yield', 'let', 'static', 'implements',
  'interface', 'package', 'private', 'protected', 'public', 'await', 'id',
]);

/** "First Name" -> "firstName"; "Work Order #" -> "workOrder". */
export const toCamelCase = (input: string): string => {
  const words = input
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+|(?<=[a-z0-9])(?=[A-Z])/)
    .filter(Boolean);

  if (words.length === 0) return '';

  const [first, ...rest] = words;
  let out =
    first!.toLowerCase() +
    rest.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('');

  if (/^[0-9]/.test(out)) out = `_${out}`;
  if (RESERVED.has(out)) out = `${out}_`;
  return out;
};

/** "work orders" -> "WorkOrder" (interface names are singular PascalCase). */
export const toPascalCase = (input: string): string => {
  const camel = toCamelCase(input);
  return camel.charAt(0).toUpperCase() + camel.slice(1);
};

/**
 * Crude but adequate singularization for interface names.
 *
 * Order matters, and the `(ss|us|is)$` guard is load-bearing: without it
 * "Status" becomes "Statu" and "Analysis" becomes "Analysi".
 */
export const singularize = (input: string): string => {
  if (/ies$/i.test(input)) return input.replace(/ies$/i, 'y');
  if (/(s|sh|ch|x|z)es$/i.test(input)) return input.replace(/es$/i, '');
  if (/(ss|us|is)$/i.test(input)) return input;
  if (/s$/i.test(input)) return input.replace(/s$/i, '');
  return input;
};

/**
 * Assign unique identifiers, appending a numeric suffix on collision.
 * Two Knack fields can legitimately share a name (Knack allows it), and a
 * silent collision would drop one of them from the generated map.
 */
export const uniquify = (name: string, taken: Set<string>): string => {
  if (!taken.has(name)) {
    taken.add(name);
    return name;
  }
  let n = 2;
  while (taken.has(`${name}${n}`)) n++;
  const result = `${name}${n}`;
  taken.add(result);
  return result;
};

export const quoteKey = (key: string): string =>
  /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
