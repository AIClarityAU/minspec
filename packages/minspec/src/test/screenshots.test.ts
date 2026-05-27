import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { execFileSync } from 'child_process';

/**
 * Screenshot capture tests for VS Code marketplace listing.
 *
 * These tests set up specific UI states and capture screenshots using
 * Python PIL (ImageGrab) since the extension tests run inside Electron
 * on a real or virtual X11 display.
 *
 * Screenshots are saved to packages/minspec/media/screenshots/.
 *
 * Tests are non-blocking: if screenshot capture tools are unavailable,
 * the test logs a warning and passes without capturing.
 */

// Resolve paths relative to the compiled test output directory.
// __dirname = packages/minspec/out/test/
// screenshots dir = packages/minspec/media/screenshots/
const SCREENSHOT_DIR = path.resolve(__dirname, '..', '..', 'media', 'screenshots');

/** Milliseconds to wait for VS Code UI to render after an action. */
const RENDER_DELAY_MS = 2500;

/** Whether screenshot capture is available (determined once in suiteSetup). */
let captureAvailable = false;

/**
 * Capture a screenshot of the current VS Code window using Python PIL.
 *
 * Falls back gracefully if Python or PIL is not available.
 *
 * @param name - filename without extension (e.g. "sidebar")
 * @returns absolute path to saved screenshot, or null if capture failed
 */
function captureScreenshot(name: string): string | null {
  const filepath = path.join(SCREENSHOT_DIR, `${name}.png`);

  // Use Python PIL ImageGrab which works on X11 (including xvfb).
  // execFileSync with argument array avoids shell interpolation.
  const pythonScript = [
    'import sys',
    'from PIL import ImageGrab',
    'img = ImageGrab.grab()',
    'img.save(sys.argv[1])',
    'print(f"OK {img.size[0]}x{img.size[1]}")',
  ].join('\n');

  try {
    const result = execFileSync('python3', ['-c', pythonScript, filepath], {
      timeout: 15000,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    console.log(`    Screenshot captured: ${name}.png (${result.trim()})`);
    return filepath;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`    Screenshot capture failed for ${name}: ${message}`);
    return null;
  }
}

/**
 * Wait for VS Code UI to render.
 */
function waitForRender(ms: number = RENDER_DELAY_MS): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

suite('Screenshots', () => {
  let workspaceRoot: string;

  suiteSetup(async function () {
    // Allow extra time for this suite — screenshots involve rendering delays
    this.timeout(120000);

    // Ensure screenshots directory exists
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

    // Ensure extension is active
    const ext = vscode.extensions.getExtension('aiclarity.minspec');
    assert.ok(ext, 'Extension should be installed');
    if (!ext.isActive) {
      await ext.activate();
    }

    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, 'Workspace folder should be open');
    workspaceRoot = folder.uri.fsPath;

    // Probe whether screenshot capture works
    try {
      execFileSync('python3', ['-c', 'from PIL import ImageGrab; print("PIL available")'], {
        timeout: 5000,
        encoding: 'utf-8',
      });
      captureAvailable = true;
      console.log('  Screenshot capture: PIL ImageGrab available');
    } catch {
      console.log('  Screenshot capture: PIL not available — tests will skip capture');
    }
  });

  test('sidebar — spec tree view grouped by status', async function () {
    this.timeout(30000);

    // Refresh the spec tree to populate it with fixture data
    await vscode.commands.executeCommand('minspec.refreshTree');
    await waitForRender(500);

    // Focus the Explorer sidebar (which contains minspecStatus view)
    await vscode.commands.executeCommand('workbench.view.explorer');
    await waitForRender();

    // Focus the MinSpec tree view specifically
    try {
      await vscode.commands.executeCommand('minspecStatus.focus');
    } catch {
      // View focus command may not exist in all VS Code versions;
      // the explorer sidebar is sufficient
    }
    await waitForRender();

    if (!captureAvailable) {
      console.log('    Skipping capture — PIL not available');
      return;
    }

    const filepath = captureScreenshot('sidebar');
    assert.ok(filepath && fs.existsSync(filepath), 'sidebar.png should be created');

    const stat = fs.statSync(filepath);
    assert.ok(stat.size > 1000, `sidebar.png should be non-trivial (got ${stat.size} bytes)`);
    console.log(`    sidebar.png: ${stat.size} bytes`);
  });

  test('spec-panel — active spec panel webview', async function () {
    this.timeout(30000);

    // Open the spec panel with SPEC-001 fixture
    const specPath = path.join(workspaceRoot, 'specs', 'SPEC-001-user-auth.md');
    assert.ok(fs.existsSync(specPath), 'SPEC-001-user-auth.md fixture should exist');

    await vscode.commands.executeCommand('minspec.showSpecPanel', specPath);
    // Webviews need extra time to render
    await waitForRender(3000);

    if (!captureAvailable) {
      console.log('    Skipping capture — PIL not available');
      return;
    }

    const filepath = captureScreenshot('spec-panel');
    assert.ok(filepath && fs.existsSync(filepath), 'spec-panel.png should be created');

    const stat = fs.statSync(filepath);
    assert.ok(stat.size > 1000, `spec-panel.png should be non-trivial (got ${stat.size} bytes)`);
    console.log(`    spec-panel.png: ${stat.size} bytes`);
  });

  test('classification — classify command UI', async function () {
    this.timeout(30000);

    // Start the classify command — it opens a Quick Pick.
    // We capture the screen with the Quick Pick visible.
    const classifyPromise = vscode.commands.executeCommand('minspec.classify');
    await waitForRender(1500);

    if (!captureAvailable) {
      console.log('    Skipping capture — PIL not available');
    } else {
      const filepath = captureScreenshot('classification');
      if (filepath && fs.existsSync(filepath)) {
        const stat = fs.statSync(filepath);
        assert.ok(stat.size > 1000, `classification.png should be non-trivial (got ${stat.size} bytes)`);
        console.log(`    classification.png: ${stat.size} bytes`);
      }
    }

    // Dismiss the Quick Pick so it doesn't block subsequent tests
    await vscode.commands.executeCommand('workbench.action.closeQuickOpen');
    // Let the classify promise settle (it may reject on dismiss)
    try {
      await classifyPromise;
    } catch {
      // Expected — command was cancelled
    }
  });

  test('codelens — CodeLens annotations in source file', async function () {
    this.timeout(30000);

    // Open the example.ts file that has traceability mappings
    const filePath = path.join(workspaceRoot, 'src', 'example.ts');
    const doc = await vscode.workspace.openTextDocument(filePath);
    await vscode.window.showTextDocument(doc, { preview: false });

    // CodeLens providers need extra time to compute and render
    await waitForRender(3500);

    if (!captureAvailable) {
      console.log('    Skipping capture — PIL not available');
      return;
    }

    const filepath = captureScreenshot('codelens');
    assert.ok(filepath && fs.existsSync(filepath), 'codelens.png should be created');

    const stat = fs.statSync(filepath);
    assert.ok(stat.size > 1000, `codelens.png should be non-trivial (got ${stat.size} bytes)`);
    console.log(`    codelens.png: ${stat.size} bytes`);
  });

  test('adr-tree — ADR tree view', async function () {
    this.timeout(30000);

    // Refresh tree to ensure ADR data is loaded
    await vscode.commands.executeCommand('minspec.refreshTree');
    await waitForRender(500);

    // Focus the Explorer sidebar
    await vscode.commands.executeCommand('workbench.view.explorer');
    await waitForRender();

    // Try to focus the ADR tree view specifically
    try {
      await vscode.commands.executeCommand('minspecAdrs.focus');
    } catch {
      // View focus command may not exist; explorer sidebar is sufficient
    }
    await waitForRender();

    if (!captureAvailable) {
      console.log('    Skipping capture — PIL not available');
      return;
    }

    const filepath = captureScreenshot('adr-tree');
    assert.ok(filepath && fs.existsSync(filepath), 'adr-tree.png should be created');

    const stat = fs.statSync(filepath);
    assert.ok(stat.size > 1000, `adr-tree.png should be non-trivial (got ${stat.size} bytes)`);
    console.log(`    adr-tree.png: ${stat.size} bytes`);
  });

  suiteTeardown(() => {
    if (!captureAvailable) {
      console.log('\n  Screenshot capture was not available. To enable:');
      console.log('    pip install Pillow');
      console.log('  And run under xvfb-run for headless environments.');
      return;
    }

    // Report all captured screenshots
    console.log('\n  Captured screenshots:');
    const files = fs.readdirSync(SCREENSHOT_DIR).filter(f => f.endsWith('.png'));
    for (const file of files) {
      const stat = fs.statSync(path.join(SCREENSHOT_DIR, file));
      console.log(`    ${file}: ${(stat.size / 1024).toFixed(1)} KB`);
    }
  });
});
