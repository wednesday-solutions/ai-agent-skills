/**
 * Java language adapter
 * Handles: import statements, public class/interface/enum/record exports,
 * Spring annotations, reflection gaps, entry point detection.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { safeRead } = require('../core/parser');

function parse(filePath, rootDir) {
  const src = safeRead(filePath);
  if (src === null) {
    return { file: filePath, lang: 'java', imports: [], exports: [], gaps: [], meta: {}, error: true };
  }

  const imports = new Set();
  const exports = new Set();
  const gaps = [];
  const meta = {};

  // Strip block comments and line comments
  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, '');

  // ── Imports ───────────────────────────────────────────────────────────────

  // import com.example.Foo; / import static com.example.Foo.bar;
  const importRe = /^import\s+(?:static\s+)?([\w.]+)\s*;/gm;
  let m;
  while ((m = importRe.exec(stripped)) !== null) {
    const fqn = m[1];
    const resolved = resolveJavaImport(fqn, rootDir);
    imports.add(resolved);
  }

  // ── Exports (public type declarations) ───────────────────────────────────

  // public class Foo / public abstract class / public final class
  // public interface / public enum / public record / public @interface
  const typeRe = /\bpublic\s+(?:(?:abstract|final|sealed|non-sealed|strictfp)\s+)*(?:class|interface|enum|record|@interface)\s+([A-Za-z_]\w*)/g;
  while ((m = typeRe.exec(stripped)) !== null) {
    exports.add(m[1]);
  }

  // Public methods and fields (top-level signal for contracts)
  const publicMemberRe = /\bpublic\s+(?:static\s+)?(?:final\s+)?[\w<>\[\]]+\s+([A-Za-z_]\w*)\s*(?:\(|=|;)/g;
  while ((m = publicMemberRe.exec(stripped)) !== null) {
    // Exclude keywords that follow public
    const name = m[1];
    if (!['class', 'interface', 'enum', 'record', 'void', 'static', 'final', 'abstract', 'synchronized', 'native', 'strictfp'].includes(name)) {
      exports.add(name);
    }
  }

  // ── Dynamic / reflection gaps ─────────────────────────────────────────────

  const reflectionRe = /Class\.forName\s*\(|\.getDeclaredMethod\s*\(|\.getDeclaredField\s*\(|\.getDeclaredConstructor\s*\(|Proxy\.newProxyInstance\s*\(/g;
  while ((m = reflectionRe.exec(stripped)) !== null) {
    gaps.push({ type: 'reflection', line: lineAt(src, m.index), pattern: m[0].trim() });
  }

  // ── Meta: framework/annotation detection ─────────────────────────────────

  if (/@SpringBootApplication/.test(stripped)) {
    meta.framework = 'spring-boot';
    meta.isEntryPoint = true;
  } else if (/@RestController|@Controller/.test(stripped)) {
    meta.framework = 'spring';
    meta.springRole = 'controller';
  } else if (/@Service/.test(stripped)) {
    meta.framework = 'spring';
    meta.springRole = 'service';
  } else if (/@Repository/.test(stripped)) {
    meta.framework = 'spring';
    meta.springRole = 'repository';
  } else if (/@Component/.test(stripped)) {
    meta.framework = 'spring';
    meta.springRole = 'component';
  } else if (/@Entity|@Table/.test(stripped)) {
    meta.framework = 'jpa';
    meta.springRole = 'entity';
  } else if (/extends\s+Activity|extends\s+Fragment|extends\s+AppCompatActivity/.test(stripped)) {
    meta.framework = 'android';
  } else if (/@Singleton|@Provides|@Module|@Component/.test(stripped) && /dagger|javax\.inject/.test(src.toLowerCase())) {
    meta.framework = 'dagger';
  }

  // Entry point: public static void main(String
  if (/public\s+static\s+void\s+main\s*\(\s*String/.test(stripped)) {
    meta.isEntryPoint = true;
  }

  // Test file detection
  if (/@Test\b/.test(stripped) || /Test\.java$/.test(filePath) || /Tests\.java$/.test(filePath)) {
    meta.isTest = true;
  }

  // ── Annotations ───────────────────────────────────────────────────────────

  const annotationRe = /\/\/\s*@wednesday-skills:(\S+)\s+(.*)/g;
  const annotations = [];
  while ((m = annotationRe.exec(src)) !== null) {
    annotations.push({ type: m[1], value: m[2].trim() });
    if (m[1] === 'connects-to') {
      const parts = m[2].split('→').map(s => s.trim());
      if (parts.length === 2) imports.add(parts[1]);
    }
  }
  if (annotations.length) meta.annotations = annotations;

  return {
    file: filePath,
    lang: 'java',
    imports: [...imports],
    exports: [...exports],
    gaps,
    meta,
    error: false,
  };
}

/**
 * Attempt to resolve a Java FQN to a relative file path.
 * e.g. com.example.service.UserService → src/main/java/com/example/service/UserService.java
 */
function resolveJavaImport(fqn, rootDir) {
  // Wildcard imports — keep as package reference
  if (fqn.endsWith('.*')) return fqn;

  const relPath = fqn.replace(/\./g, path.sep) + '.java';
  const srcRoots = [
    'src/main/java',
    'src/main/kotlin',  // mixed projects
    'src',
    'app/src/main/java', // Android
    'lib/src/main/java',
  ];

  for (const root of srcRoots) {
    const candidate = path.join(rootDir, root, relPath);
    if (fs.existsSync(candidate)) return path.relative(rootDir, candidate);
  }

  // External dependency — return FQN as-is
  return fqn;
}

function lineAt(src, idx) {
  return src.slice(0, idx).split('\n').length;
}

module.exports = { parse };
