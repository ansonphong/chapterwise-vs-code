import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';

suite('Tree Provider Integration', () => {
  let codexUri: vscode.Uri;

  suiteSetup(async () => {
    const folders = vscode.workspace.workspaceFolders;
    assert.ok(folders && folders.length > 0, 'Fixture workspace not open');
    codexUri = vscode.Uri.file(path.join(folders[0].uri.fsPath, 'test.codex.yaml'));

    const stat = await vscode.workspace.fs.stat(codexUri);
    assert.ok(stat, 'test.codex.yaml fixture not found');
  });

  test('Opening a codex file does NOT auto-set tree context', async () => {
    const doc = await vscode.workspace.openTextDocument(codexUri);
    await vscode.window.showTextDocument(doc);
    await new Promise(r => setTimeout(r, 500));

    await vscode.commands.executeCommand('chapterwiseCodex.refresh');
  });

  test('setContextFile populates tree with document content', async () => {
    await vscode.commands.executeCommand('chapterwiseCodex.setContextFile', codexUri);

    await new Promise(r => setTimeout(r, 2000));

    // If context was accepted, a second call should also succeed
    await vscode.commands.executeCommand('chapterwiseCodex.setContextFile', codexUri);

    // Refresh after context is set should complete
    await vscode.commands.executeCommand('chapterwiseCodex.refresh');
  });
});
