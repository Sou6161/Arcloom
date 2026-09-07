import ts from 'typescript';
import { ExportKind } from '@decodr/types';
import type {
  ParsedComponent,
  ParsedFile,
  ParsedHook,
  ParsedImport,
  ParsedImportName,
} from './types.js';
import {
  collectRenderedTags,
  containsJsx,
  hasModifier,
  isComponentName,
  isHookName,
  lineAt,
  nameFromPath,
  scriptKindFor,
} from './astUtils.js';
import { isRelativeSpecifier, resolveModule } from './moduleResolver.js';
import { parseRoutes } from './routeParser.js';

/** Exported-symbol summary for a file (populated in a first pass). */
interface ExportInfo {
  named: Set<string>;
  defaultName: string | null;
  /** Anonymous `export default <fn|class|call>` expression, if any. */
  defaultAnon: ts.Expression | null;
}

/**
 * Parses one source file into components, hooks, imports, and routes using the
 * TypeScript AST (no regular expressions). Purely syntactic — no type-checker —
 * which keeps it fast and dependency-light.
 */
export function parseFile(
  filePath: string,
  content: string,
  knownFiles: ReadonlySet<string>,
): ParsedFile {
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    scriptKindFor(filePath),
  );

  const imports = parseImports(sourceFile, filePath, knownFiles);
  const exports = collectExports(sourceFile);
  const { components, hooks } = collectDeclarations(sourceFile, filePath, exports);
  const routes = parseRoutes(sourceFile);

  return { path: filePath, components, hooks, imports, routes };
}

function parseImports(
  sourceFile: ts.SourceFile,
  filePath: string,
  knownFiles: ReadonlySet<string>,
): ParsedImport[] {
  const imports: ParsedImport[] = [];

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;

    const specifier = statement.moduleSpecifier.text;
    const names: ParsedImportName[] = [];
    const clause = statement.importClause;

    if (clause?.name) {
      names.push({ local: clause.name.text, imported: 'default', isDefault: true });
    }
    if (clause?.namedBindings) {
      if (ts.isNamespaceImport(clause.namedBindings)) {
        names.push({
          local: clause.namedBindings.name.text,
          imported: '*',
          isDefault: false,
        });
      } else {
        for (const el of clause.namedBindings.elements) {
          names.push({
            local: el.name.text,
            imported: (el.propertyName ?? el.name).text,
            isDefault: false,
          });
        }
      }
    }

    imports.push({
      moduleSpecifier: specifier,
      resolvedPath: resolveModule(filePath, specifier, knownFiles),
      isExternal: !isRelativeSpecifier(specifier),
      names,
    });
  }

  return imports;
}

function collectExports(sourceFile: ts.SourceFile): ExportInfo {
  const info: ExportInfo = { named: new Set(), defaultName: null, defaultAnon: null };

  for (const statement of sourceFile.statements) {
    if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      if (ts.isIdentifier(statement.expression)) {
        info.defaultName = statement.expression.text;
      } else {
        info.defaultAnon = statement.expression;
      }
    } else if (
      ts.isExportDeclaration(statement) &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const el of statement.exportClause.elements) {
        if (el.name.text === 'default' && el.propertyName) {
          info.defaultName = el.propertyName.text;
        } else {
          info.named.add(el.name.text);
        }
      }
    }
  }

  return info;
}

function collectDeclarations(
  sourceFile: ts.SourceFile,
  filePath: string,
  exports: ExportInfo,
): { components: ParsedComponent[]; hooks: ParsedHook[] } {
  const components: ParsedComponent[] = [];
  const hooks: ParsedHook[] = [];

  // `inlineExport` covers the `export function Foo()` / `export const Foo =`
  // form, where the keyword sits on the declaration itself. collectExports only
  // sees `export { Foo }` and `export default`, so without this the most common
  // React export style was reported as not exported.
  const exportMeta = (name: string, defaultInline: boolean, inlineExport: boolean) => {
    const isDefault = defaultInline || exports.defaultName === name;
    const isExported = isDefault || inlineExport || exports.named.has(name);
    return {
      isDefaultExport: isDefault,
      isExported,
      exportKind: isDefault ? ExportKind.Default : ExportKind.Named,
    };
  };

  const addComponent = (
    name: string,
    span: ts.Node,
    defaultInline: boolean,
    inlineExport = false,
  ) => {
    const start = lineAt(sourceFile, span.getStart(sourceFile));
    components.push({
      name,
      startLine: start,
      endLine: lineAt(sourceFile, span.getEnd()),
      renderedTags: collectRenderedTags(span),
      ...exportMeta(name, defaultInline, inlineExport),
    });
  };

  const addHook = (
    name: string,
    span: ts.Node,
    defaultInline: boolean,
    inlineExport = false,
  ) => {
    hooks.push({
      name,
      startLine: lineAt(sourceFile, span.getStart(sourceFile)),
      endLine: lineAt(sourceFile, span.getEnd()),
      ...exportMeta(name, defaultInline, inlineExport),
    });
  };

  for (const statement of sourceFile.statements) {
    const defaultInline = hasModifier(statement, ts.SyntaxKind.DefaultKeyword);
    const inlineExport = hasModifier(statement, ts.SyntaxKind.ExportKeyword);

    if (ts.isFunctionDeclaration(statement)) {
      const name = statement.name?.text ?? (defaultInline ? nameFromPath(filePath) : null);
      if (!name) continue;
      if (isHookName(name)) addHook(name, statement, defaultInline, inlineExport);
      else if (isComponentName(name) && containsJsx(statement)) {
        addComponent(name, statement, defaultInline, inlineExport);
      }
    } else if (ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
        const name = decl.name.text;
        if (isHookName(name) && isFunctionLike(decl.initializer)) {
          addHook(name, decl, false, inlineExport);
        } else if (isComponentName(name) && isComponentInitializer(decl.initializer)) {
          addComponent(name, decl, false, inlineExport);
        }
      }
    } else if (ts.isClassDeclaration(statement)) {
      const name = statement.name?.text ?? (defaultInline ? nameFromPath(filePath) : null);
      if (name && isComponentName(name) && isClassComponent(statement)) {
        addComponent(name, statement, defaultInline, inlineExport);
      }
    }
  }

  // Anonymous `export default () => <jsx/>` / `export default memo(...)`.
  if (exports.defaultAnon && isComponentInitializer(exports.defaultAnon)) {
    const name = nameFromPath(filePath);
    if (!components.some((c) => c.name === name)) {
      addComponent(name, exports.defaultAnon, true);
    }
  }

  return { components, hooks };
}

function isFunctionLike(node: ts.Node): boolean {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node);
}

/** Arrow/function returning JSX, or a HOC call (memo/forwardRef) wrapping one. */
function isComponentInitializer(node: ts.Expression): boolean {
  if (isFunctionLike(node)) return containsJsx(node);
  if (ts.isCallExpression(node)) {
    return node.arguments.some((arg) => isFunctionLike(arg) && containsJsx(arg));
  }
  return false;
}

function isClassComponent(node: ts.ClassDeclaration): boolean {
  const extendsComponent = node.heritageClauses?.some((clause) =>
    clause.types.some((t) => {
      const text = t.expression.getText();
      return text.endsWith('Component') || text.endsWith('PureComponent');
    }),
  );
  return Boolean(extendsComponent) || containsJsx(node);
}
