#!/bin/bash
# Sync Scrivener import scripts from Claude plugin (canonical source)
# Run this before releasing the VS Code extension

set -e

CANONICAL="/Users/phong/Projects/chapterwise-claude-plugins/plugins/chapterwise-codex/scripts"
TARGET="/Users/phong/Projects/chapterwise-vs-code/scripts/scrivener"

FILES=(
    "scrivener_import.py"
    "scrivener_parser.py"
    "rtf_converter.py"
    "scrivener_file_writer.py"
)

echo "Syncing Scrivener scripts from Claude plugin..."
echo "Source: $CANONICAL"
echo "Target: $TARGET"
echo ""

mkdir -p "$TARGET"

for file in "${FILES[@]}"; do
    if [ -f "$CANONICAL/$file" ]; then
        cp "$CANONICAL/$file" "$TARGET/$file"
        echo "  ✓ Synced $file"
    else
        echo "  ✗ Missing $CANONICAL/$file"
        exit 1
    fi
done

echo ""
echo "Done. Scripts synced to $TARGET"
echo ""
echo "Remember to commit these changes before releasing the extension."
