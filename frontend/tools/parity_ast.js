import ts from 'typescript';

// 字符串感知的注释剥离 + 空白折叠。
// 替代原先基于正则的删注释实现，避免误伤字符串/模板字面量中出现的 // 或 /* */。
export function normalizeSource(text) {
  const s = String(text || '');
  const n = s.length;
  let out = '';
  let i = 0;
  while (i < n) {
    const ch = s[i];
    const nx = i + 1 < n ? s[i + 1] : '';
    if (ch === '/' && nx === '/') {
      i += 2;
      while (i < n && s[i] !== '\n') i++;
    } else if (ch === '/' && nx === '*') {
      i += 2;
      while (i < n && !(s[i] === '*' && s[i + 1] === '/')) i++;
      i += 2;
    } else if (ch === '"' || ch === "'" || ch === '`') {
      const q = ch;
      out += ch;
      i++;
      while (i < n) {
        const c = s[i];
        if (c === '\\') {
          out += c;
          if (i + 1 < n) { out += s[i + 1]; i += 2; } else { i++; }
          continue;
        }
        out += c;
        i++;
        if (c === q) break;
      }
    } else {
      out += ch;
      i++;
    }
  }
  return out.replace(/\s+/g, ' ').trim();
}

function hasRuntime(sf) {
  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt) || ts.isEnumDeclaration(stmt) || ts.isVariableStatement(stmt)) return true;
    if (ts.isImportDeclaration(stmt)) return true;
    if (ts.isExportAssignment(stmt) || ts.isExpressionStatement(stmt)) return true;
    if (ts.isExportDeclaration(stmt)) {
      if (stmt.exportClause && ts.isNamedExports(stmt.exportClause) && stmt.exportClause.elements.every((e) => e.isTypeOnly)) continue;
      return true;
    }
  }
  return false;
}

// 收集单个 TS 文件的顶层声明（函数/类/接口/类型别名/变量）与运行时特征。
export function collectTopLevel(fileName, text) {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TS);
  const out = [];
  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt)) {
      if (stmt.name && stmt.name.text) out.push({ name: stmt.name.text, kind: ts.isFunctionDeclaration(stmt) ? 'function' : 'class', hash: normalizeSource(stmt.body ? stmt.body.getText(sf) : '') });
    } else if (ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt)) {
      if (stmt.name && stmt.name.text) out.push({ name: stmt.name.text, kind: ts.isInterfaceDeclaration(stmt) ? 'interface' : 'typealias', hash: '' });
    } else if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) out.push({ name: decl.name.text, kind: 'variable', hash: normalizeSource(decl.initializer ? decl.initializer.getText(sf) : '') });
      }
    }
  }
  let exprChars = 0;
  for (const stmt of sf.statements) { if (ts.isExpressionStatement(stmt)) exprChars += stmt.getText(sf).length; }
  return { names: out, runtime: hasRuntime(sf), exprRatio: text.length ? exprChars / text.length : 0 };
}

// 模块作用域内的重复声明检测：仅当【同一个文件】内同名声明出现多次才判为重复。
// 不同文件之间的同名（如各文件各自私有的 bool / SelectField / selectField）是合法的，不报重复。
export function duplicatedInFile(declsByFile) {
  const dups = [];
  const isType = (k) => k === 'interface' || k === 'typealias' || k === 'type';
  for (const [file, decls] of declsByFile) {
    const byName = new Map();
    for (const d of decls) {
      const nm = typeof d === 'string' ? d : d.name;
      const kind = typeof d === 'string' ? 'variable' : d.kind;
      if (!byName.has(nm)) byName.set(nm, []);
      byName.get(nm).push(kind);
    }
    for (const [nm, kinds] of byName) {
      const valueKinds = kinds.filter((k) => !isType(k));
      const typeKinds = kinds.filter((k) => isType(k));
      const valueBad = valueKinds.length >= 2 && !valueKinds.every((k) => k === 'function' || k === 'enum');
      const typeBad = typeKinds.length >= 2 && !typeKinds.every((k) => k === 'interface');
      if (valueBad || typeBad) dups.push(nm + ': ' + file);
    }
  }
  return dups;
}
