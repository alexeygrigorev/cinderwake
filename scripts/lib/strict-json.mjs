import ts from "typescript";

/** Keep JSON.parse syntax rules, but reject keys it would silently overwrite. */
export function parseStrictJson(source, filename = "<json>") {
  let value;
  try {
    value = JSON.parse(source);
  } catch (error) {
    throw new SyntaxError(`${filename}: ${error.message}`, { cause: error });
  }
  const tree = ts.parseJsonText(filename, source);
  const pending = [tree];
  while (pending.length > 0) {
    const node = pending.pop();
    if (ts.isObjectLiteralExpression(node)) {
      const keys = new Set();
      for (const property of node.properties) {
        const key = property.name.text;
        if (keys.has(key)) {
          const location = tree.getLineAndCharacterOfPosition(
            property.name.getStart(tree),
          );
          throw new SyntaxError(
            `Duplicate JSON object key ${JSON.stringify(key)} in ${filename}:${location.line + 1}:${location.character + 1}`,
          );
        }
        keys.add(key);
      }
    }
    ts.forEachChild(node, (child) => {
      pending.push(child);
    });
  }
  return value;
}
