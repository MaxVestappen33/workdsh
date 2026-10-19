import ts from 'typescript';
import { defineTool } from '@deepseek-ai/dsh-tools';

/** Parse data, never import/evaluate candidate code in the live Host. */
export function checkWorkbenchToolSchemas(sources: Readonly<Record<string, string>>) {
  let checked = 0, unresolved = 0;
  for (const [file, source] of Object.entries(sources)) {
    if (!source.includes('@deepseek-ai/dsh-tools')) continue;
    if (source.length > 2 * 1024 * 1024) { unresolved++; continue; }
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const names = new Set<string>(), namespaces = new Set<string>();
    const constants = new Map<string, ts.Expression>();
    for (const statement of tree.statements) {
      if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text === '@deepseek-ai/dsh-tools') {
        const binding = statement.importClause?.namedBindings;
        if (binding && ts.isNamedImports(binding)) for (const item of binding.elements) {
          if ((item.propertyName?.text ?? item.name.text) === 'defineTool') names.add(item.name.text);
        }
        if (binding && ts.isNamespaceImport(binding)) namespaces.add(binding.name.text);
      }
      if (ts.isVariableStatement(statement) && statement.declarationList.flags & ts.NodeFlags.Const)
        for (const declaration of statement.declarationList.declarations)
          if (ts.isIdentifier(declaration.name) && declaration.initializer) constants.set(declaration.name.text, declaration.initializer);
    }
    function literal(node: ts.Expression, depth = 0): unknown {
      if (depth > 24) throw Error('dynamic');
      if (ts.isIdentifier(node) && constants.has(node.text)) return literal(constants.get(node.text)!, depth + 1);
      if (ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return ts.isStringLiteral(node) ? node.text : Number(node.text);
      if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
      if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
      if (node.kind === ts.SyntaxKind.NullKeyword) return null;
      if (ts.isArrayLiteralExpression(node)) return node.elements.map(n => literal(n as ts.Expression, depth + 1));
      if (ts.isObjectLiteralExpression(node)) {
        const value: Record<string, unknown> = Object.create(null);
        for (const property of node.properties) {
          if (!ts.isPropertyAssignment(property) || !property.name || ts.isComputedPropertyName(property.name)) throw Error('dynamic');
          value[property.name.getText(tree).replace(/^['"]|['"]$/g, '')] = literal(property.initializer, depth + 1);
        }
        return value;
      }
      throw Error('dynamic');
    }
    function visit(node: ts.Node) {
      if (ts.isCallExpression(node) && ((ts.isIdentifier(node.expression) && names.has(node.expression.text)) ||
        (ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) && namespaces.has(node.expression.expression.text) && node.expression.name.text === 'defineTool'))) {
        const definition = node.arguments[0];
        const parameters = definition && ts.isObjectLiteralExpression(definition) && definition.properties.find(p => ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && p.name.text === 'parameters');
        if (!parameters || !ts.isPropertyAssignment(parameters)) { unresolved++; return; }
        let data: unknown;
        try { data = literal(parameters.initializer); } catch { unresolved++; return; }
        // Pass only parsed data to the official schema compiler. No candidate
        // function, name, output renderer, import or initializer is executed.
        try { defineTool({ name: 'workdsh_preflight', description: 'schema validation', parameters: data as never,
          output: { schema: { type: 'json' }, render: () => [] }, execute: async () => ({}) }); checked++; }
        catch {
          const optionalFalse = JSON.stringify(data).includes('"required":false');
          throw Error(optionalFalse ? 'workbench/tool-optional-required-false' : 'workbench/tool-schema-invalid');
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(tree);
    // Dynamic/unsupported authoring forms must never be described as checked.
    if (!names.size && !namespaces.size) unresolved++;
  }
  return Object.freeze({ checked, unresolved, startup: 'not-executed' as const });
}
