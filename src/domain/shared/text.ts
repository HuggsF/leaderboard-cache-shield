/** Trims and collapses inner whitespace (tabs, double spaces, line breaks) into single spaces. */
export const normalizeWhitespace = (raw: string): string => raw.trim().replace(/\s+/g, ' ');

/**
 * Length in Unicode code points, which is how MySQL counts `VARCHAR(n)` characters with utf8mb4
 * (`'José'.length` is 4, but an emoji counts as 2 UTF-16 units and 1 character).
 */
export const characterLength = (text: string): number => Array.from(text).length;
