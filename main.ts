import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildData, buildRadar, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const root = fileURLToPath(new URL('.', import.meta.url));
const TEXT_MAX_BYTES = 65_536;
const IMAGE_CAPS = { max: 4, max_bytes: 524_288 };
const NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function isWithin(parent: string, candidate: string): boolean {
  const rel = relative(resolve(parent), resolve(candidate));
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1]!;
  const equals = process.argv.find((x) => x.startsWith(`--${name}=`));
  return equals === undefined ? fallback : equals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = resolve(inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json'));
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: snapshot not found at ${inputFile}; pass --input <file-or-directory>\n`);
  process.exit(2);
}
const out = resolve(arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output'));
const protectedPaths = ['main.ts', 'lib', 'dashboard', 'screenshots', 'vendor'].map((p) => join(root, p));
if (protectedPaths.some((p) => isWithin(p, out) || isWithin(out, p))) {
  process.stderr.write('token radar: refusing output that overlaps source files; choose a separate directory\n');
  process.exit(2);
}
if (isWithin(out, inputFile)) {
  process.stderr.write('token radar: refusing output that contains the input snapshot; choose a separate directory\n');
  process.exit(2);
}
const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, live } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue) {
  process.stderr.write(`token radar: refusing invalid board: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), `window.RADAR=${JSON.stringify(buildData(snapshot, board, live))};\n`);

function copyTree(from: string, to: string): number {
  if (!existsSync(from)) throw new Error(`required directory is missing: ${from}`);
  mkdirSync(to, { recursive: true });
  let copied = 0;
  for (const name of readdirSync(from).sort()) {
    if (name.startsWith('.')) continue;
    const source = join(from, name);
    const target = join(to, name);
    const stat = statSync(source);
    if (stat.isDirectory()) copied += copyTree(source, target);
    else if (stat.isFile()) { copyFileSync(source, target); copied++; }
    else throw new Error(`unsupported file type: ${source}`);
  }
  return copied;
}

const dashboardFiles = copyTree(join(root, 'dashboard'), join(out, 'dashboard'));
const screenshotDir = join(root, 'screenshots');
const screenshotNames = readdirSync(screenshotDir).filter((name) => !name.startsWith('.')).sort();
if (screenshotNames.length < 3 || screenshotNames.length > IMAGE_CAPS.max) throw new Error(`screenshots/: expected 3–${IMAGE_CAPS.max} images, found ${screenshotNames.length}`);
mkdirSync(join(out, 'screenshots'), { recursive: true });
for (const name of screenshotNames) {
  if (!NAME.test(name)) throw new Error(`screenshots/${name}: invalid image name`);
  const source = join(screenshotDir, name);
  if (!statSync(source).isFile()) throw new Error(`screenshots/${name}: not a regular file`);
  if (statSync(source).size > IMAGE_CAPS.max_bytes) throw new Error(`screenshots/${name}: exceeds 512 KiB`);
  copyFileSync(source, join(out, 'screenshots', name));
}
writeFileSync(join(out, 'dossier.json'), buildDossier(out, {
  text_max_bytes: TEXT_MAX_BYTES,
  screenshots: IMAGE_CAPS,
  dashboard: { max_files: 400, max_bytes: 4_194_304 },
}));

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} watchlist rows, ${board.length} ranked protocols (${board.length - snapshot.watchlist.length} below-floor candidates), ${live.length} live-token references\n` +
  `token radar: wrote board.json, data.js, ${dashboardFiles} dashboard files, ${screenshotNames.length} screenshots and dossier.json to ${out}\n`,
);
