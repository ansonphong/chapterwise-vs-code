/**
 * Templates for .gitignore and .gitattributes files
 * Optimized for writing projects using ChapterWise
 */

/**
 * Git ignore patterns for writing projects
 * Includes ChapterWise-specific patterns, OS-specific files, and common backup patterns
 */
export const GITIGNORE_TEMPLATE = `# ChapterWise auto-generated index cache
.index.codex.json

# Writing project folders
__ARCHIVE/
__INPUT/
__OUTPUT/
__UPSAMPLE/
_ARCHIVE/
_OLD/
_BACKUP/

# Large Photoshop files
*.psb

# macOS
.DS_Store
.AppleDouble
.LSOverride
._*

# Windows
Thumbs.db
Thumbs.db:encryptable
ehthumbs.db
ehthumbs_vista.db
Desktop.ini
$RECYCLE.BIN/
*.cab
*.msi
*.msix
*.msm
*.msp
*.lnk

# Linux
*~
.directory
.Trash-*

# Editor backups
*.bak
*.backup
*.swp
*.swo

# Dump files
*.stackdump
`;

/**
 * Git LFS attributes for large binary files
 * Includes images, documents, audio, and video files commonly used by writers
 */
export const GITATTRIBUTES_TEMPLATE = `# Images
*.jpg filter=lfs diff=lfs merge=lfs -text
*.jpeg filter=lfs diff=lfs merge=lfs -text
*.png filter=lfs diff=lfs merge=lfs -text
*.gif filter=lfs diff=lfs merge=lfs -text
*.webp filter=lfs diff=lfs merge=lfs -text
*.bmp filter=lfs diff=lfs merge=lfs -text
*.tiff filter=lfs diff=lfs merge=lfs -text
*.tif filter=lfs diff=lfs merge=lfs -text

# Large Photoshop files
*.psb filter=lfs diff=lfs merge=lfs -text
*.psd filter=lfs diff=lfs merge=lfs -text

# Documents
*.pdf filter=lfs diff=lfs merge=lfs -text
*.docx filter=lfs diff=lfs merge=lfs -text
*.odt filter=lfs diff=lfs merge=lfs -text
*.rtf filter=lfs diff=lfs merge=lfs -text

# Audio
*.mp3 filter=lfs diff=lfs merge=lfs -text
*.wav filter=lfs diff=lfs merge=lfs -text
*.m4a filter=lfs diff=lfs merge=lfs -text
*.flac filter=lfs diff=lfs merge=lfs -text

# Video
*.mp4 filter=lfs diff=lfs merge=lfs -text
*.mov filter=lfs diff=lfs merge=lfs -text
*.avi filter=lfs diff=lfs merge=lfs -text
*.mkv filter=lfs diff=lfs merge=lfs -text
`;

/**
 * Get a human-readable description of what patterns are included
 */
export function getGitIgnoreDescription(): string {
  const lines = GITIGNORE_TEMPLATE.trim().split('\n');
  const patterns = lines.filter(line => 
    !line.startsWith('#') && 
    line.trim() !== ''
  );
  return `${patterns.length} patterns including ChapterWise cache, writing folders, and OS-specific files`;
}

/**
 * Get a human-readable description of LFS file types
 */
export function getGitAttributesDescription(): string {
  const lines = GITATTRIBUTES_TEMPLATE.trim().split('\n');
  const patterns = lines.filter(line => 
    !line.startsWith('#') && 
    line.trim() !== ''
  );
  return `${patterns.length} file types including images, documents, audio, and video`;
}

/**
 * Get individual pattern categories for selective inclusion
 */
export const GITIGNORE_CATEGORIES = {
  chapterwise: `# ChapterWise auto-generated index cache
.index.codex.json
`,
  writingFolders: `# Writing project folders
__ARCHIVE/
__INPUT/
__OUTPUT/
__UPSAMPLE/
_ARCHIVE/
_OLD/
_BACKUP/
`,
  largeFiles: `# Large Photoshop files
*.psb
`,
  macos: `# macOS
.DS_Store
.AppleDouble
.LSOverride
._*
`,
  windows: `# Windows
Thumbs.db
Thumbs.db:encryptable
ehthumbs.db
ehthumbs_vista.db
Desktop.ini
$RECYCLE.BIN/
*.cab
*.msi
*.msix
*.msm
*.msp
*.lnk
`,
  linux: `# Linux
*~
.directory
.Trash-*
`,
  backups: `# Editor backups
*.bak
*.backup
*.swp
*.swo
`,
  dumps: `# Dump files
*.stackdump
`
};

/**
 * Get individual LFS categories for selective inclusion
 */
export const GITATTRIBUTES_CATEGORIES = {
  images: `# Images
*.jpg filter=lfs diff=lfs merge=lfs -text
*.jpeg filter=lfs diff=lfs merge=lfs -text
*.png filter=lfs diff=lfs merge=lfs -text
*.gif filter=lfs diff=lfs merge=lfs -text
*.webp filter=lfs diff=lfs merge=lfs -text
*.bmp filter=lfs diff=lfs merge=lfs -text
*.tiff filter=lfs diff=lfs merge=lfs -text
*.tif filter=lfs diff=lfs merge=lfs -text
`,
  photoshop: `# Large Photoshop files
*.psb filter=lfs diff=lfs merge=lfs -text
*.psd filter=lfs diff=lfs merge=lfs -text
`,
  documents: `# Documents
*.pdf filter=lfs diff=lfs merge=lfs -text
*.docx filter=lfs diff=lfs merge=lfs -text
*.odt filter=lfs diff=lfs merge=lfs -text
*.rtf filter=lfs diff=lfs merge=lfs -text
`,
  audio: `# Audio
*.mp3 filter=lfs diff=lfs merge=lfs -text
*.wav filter=lfs diff=lfs merge=lfs -text
*.m4a filter=lfs diff=lfs merge=lfs -text
*.flac filter=lfs diff=lfs merge=lfs -text
`,
  video: `# Video
*.mp4 filter=lfs diff=lfs merge=lfs -text
*.mov filter=lfs diff=lfs merge=lfs -text
*.avi filter=lfs diff=lfs merge=lfs -text
*.mkv filter=lfs diff=lfs merge=lfs -text
`
};

