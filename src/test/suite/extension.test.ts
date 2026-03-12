import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Smoke Tests', () => {
  test('Extension should be present', () => {
    const ext = vscode.extensions.getExtension('StudioPhong.chapterwise');
    assert.ok(ext, 'Extension not found');
  });

  test('Extension should activate', async () => {
    const ext = vscode.extensions.getExtension('StudioPhong.chapterwise');
    assert.ok(ext);
    await ext.activate();
    assert.strictEqual(ext.isActive, true);
  });

  test('Workspace fixture should be open', () => {
    const folders = vscode.workspace.workspaceFolders;
    assert.ok(folders && folders.length > 0, 'No workspace folder open');
    assert.ok(
      folders[0].uri.fsPath.includes('fixtures'),
      `Expected fixture workspace, got: ${folders[0].uri.fsPath}`
    );
  });

  test('Commands should be registered', async () => {
    const commands = await vscode.commands.getCommands(true);
    const codexCommands = commands.filter(c => c.startsWith('chapterwise.'));
    assert.ok(codexCommands.length >= 20, `Expected 20+ commands, got ${codexCommands.length}`);
    assert.ok(codexCommands.includes('chapterwise.refresh'));
    assert.ok(codexCommands.includes('chapterwise.openWriterView'));
    assert.ok(codexCommands.includes('chapterwise.addChildNode'));
    assert.ok(codexCommands.includes('chapterwise.setContextFile'));
  });
});
