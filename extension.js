const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

let watcher = null;

/**
 * Find WordPress root by searching upward for wp-config.php
 */
function findWpRoot(startPath) {
  let currentPath = startPath;

  while (true) {
    const configPath = path.join(currentPath, 'wp-config.php');

    if (fs.existsSync(configPath)) {
      return currentPath;
    }

    const parentPath = path.dirname(currentPath);

    if (parentPath === currentPath) {
      return null;
    }

    currentPath = parentPath;
  }
}

/**
 * Check if debug logging is enabled (NO file modification)
 */
async function ensureDebugEnabled(wpConfigPath) {
  const configContent = fs.readFileSync(wpConfigPath, 'utf8');

  const debugEnabled =
    configContent.includes("define('WP_DEBUG', true)") &&
    configContent.includes("define('WP_DEBUG_LOG', true)");

  if (debugEnabled) {
    return true;
  }

  const selection = await vscode.window.showWarningMessage(
    'WP_DEBUG_LOG is not enabled. Please enable debug logging in wp-config.php to use this extension.',
    'Open wp-config.php',
    'Show Instructions',
    'Cancel'
  );

  if (selection === 'Open wp-config.php') {
    const document = await vscode.workspace.openTextDocument(wpConfigPath);
    await vscode.window.showTextDocument(document);
  }

  if (selection === 'Show Instructions') {
    vscode.window.showInformationMessage(
      "Add the following lines above '/* That's all, stop editing! Happy publishing. */' in wp-config.php:\n\n" +
      "define('WP_DEBUG', true);\n" +
      "define('WP_DEBUG_LOG', true);\n" +
      "define('WP_DEBUG_DISPLAY', false);",
      { modal: true }
    );
  }

  return false;
}

/**
 * Start tail streaming (real-time append)
 */
function startTailStreaming(editor, logPath, context) {
  let lastSize = fs.statSync(logPath).size;

  if (watcher) {
    watcher.close();
  }

  watcher = fs.watch(logPath, async (eventType) => {
    if (eventType !== 'change') return;

    const stats = fs.statSync(logPath);

    if (stats.size < lastSize) {
      lastSize = 0;
      return;
    }

    if (stats.size > lastSize) {
      const stream = fs.createReadStream(logPath, {
        start: lastSize,
        end: stats.size
      });

      let newContent = '';

      stream.on('data', chunk => {
        newContent += chunk.toString();
      });

      stream.on('end', async () => {
        const edit = new vscode.WorkspaceEdit();
        const position = new vscode.Position(
          editor.document.lineCount,
          0
        );

        edit.insert(editor.document.uri, position, newContent);
        await vscode.workspace.applyEdit(edit);

        const lastLine = editor.document.lineCount - 1;
        editor.revealRange(
          new vscode.Range(lastLine, 0, lastLine, 0),
          vscode.TextEditorRevealType.Default
        );

        lastSize = stats.size;
      });
    }
  });

  context.subscriptions.push({
    dispose: () => {
      if (watcher) {
        watcher.close();
      }
    }
  });
}

/**
 * Activate Extension
 */
function activate(context) {
  const disposable = vscode.commands.registerCommand(
    'wpDebugStream.open',
    async function () {

      const workspaceFolders = vscode.workspace.workspaceFolders;

      if (!workspaceFolders) {
        vscode.window.showErrorMessage('No workspace folder open.');
        return;
      }

      const currentFolder = workspaceFolders[0].uri.fsPath;
      const wpRoot = findWpRoot(currentFolder);

      if (!wpRoot) {
        vscode.window.showErrorMessage('wp-config.php not found in parent directories.');
        return;
      }

      const wpConfigPath = path.join(wpRoot, 'wp-config.php');
      const logPath = path.join(wpRoot, 'wp-content', 'debug.log');

      const debugReady = await ensureDebugEnabled(wpConfigPath);
      if (!debugReady) return;

      if (!fs.existsSync(logPath)) {
        vscode.window.showWarningMessage(
          'debug.log not found. It will be created automatically when WordPress logs an error.'
        );
        fs.writeFileSync(logPath, '');
      }

      const document = await vscode.workspace.openTextDocument(logPath);
      const editor = await vscode.window.showTextDocument(document, {
        preview: false
      });

      vscode.window.showInformationMessage('WP Debug Log Opened 🚀');

      startTailStreaming(editor, logPath, context);
    }
  );

  context.subscriptions.push(disposable);
}

/**
 * Cleanup
 */
function deactivate() {
  if (watcher) {
    watcher.close();
  }
}

module.exports = {
  activate,
  deactivate
};
