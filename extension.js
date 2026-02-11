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
 * Enable debug logging safely (with permission)
 */
async function ensureDebugEnabled(wpConfigPath) {
  let configContent = fs.readFileSync(wpConfigPath, 'utf8');

  if (!configContent.includes("WP_DEBUG_LOG")) {
    const choice = await vscode.window.showWarningMessage(
      'WP_DEBUG_LOG not found. Enable debug logging?',
      { modal: true },
      'Enable',
      'Cancel'
    );

    if (choice !== 'Enable') {
      return false;
    }

    const debugBlock = `
/** Added by WP Debug Stream Extension */
define('WP_DEBUG', true);
define('WP_DEBUG_LOG', true);
define('WP_DEBUG_DISPLAY', false);
/** End WP Debug Stream Extension */
`;

    if (configContent.includes("/* That's all, stop editing! Happy publishing. */")) {
      configContent = configContent.replace(
        "/* That's all, stop editing! Happy publishing. */",
        debugBlock + "\n/* That's all, stop editing! Happy publishing. */"
      );
    } else {
      configContent += debugBlock;
    }

    fs.writeFileSync(wpConfigPath, configContent);
    vscode.window.showInformationMessage('Debug logging enabled.');
  }

  return true;
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
      // File truncated (log cleared)
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
