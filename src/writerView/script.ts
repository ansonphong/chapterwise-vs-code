/**
 * JavaScript code for Writer View webview
 */

import { CodexNode } from '../codexModel';
import { getToolbarScript } from './toolbar';

export function getWriterViewScript(node: CodexNode, initialField: string): string {
  return /* javascript */ `
    const vscode = acquireVsCodeApi();
    const editor = document.getElementById('editor');
    const saveMenuBtn = document.getElementById('saveMenuBtn');
    const saveMenuDropdown = document.getElementById('saveMenuDropdown');
    const fieldSelector = document.getElementById('fieldSelector');
    const typeSelector = document.getElementById('typeSelector');
    const nodeNameDisplay = document.getElementById('nodeName');
    const nodeNameEdit = document.getElementById('nodeNameEdit');

    // Toast notification function
    function showToast(message, type = 'info') {
      const existing = document.querySelector('.toast');
      if (existing) existing.remove();

      const toast = document.createElement('div');
      toast.className = 'toast ' + type;
      toast.textContent = message;
      document.body.appendChild(toast);

      setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => {
          toast.remove();
        }, 300);
      }, 2700);
    }

    function trapFocus(container) {
      if (!container) return;

      container.addEventListener('keydown', (e) => {
        if (e.key !== 'Tab') return;

        const focusableElements = container.querySelectorAll(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );

        if (focusableElements.length === 0) return;

        const firstFocusable = focusableElements[0];
        const lastFocusable = focusableElements[focusableElements.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstFocusable) {
            e.preventDefault();
            lastFocusable.focus();
          }
        } else {
          if (document.activeElement === lastFocusable) {
            e.preventDefault();
            firstFocusable.focus();
          }
        }
      });
    }

    // Overview mode prose editors
    const summaryEditorContent = document.getElementById('summaryEditorContent');
    const bodyEditorContent = document.getElementById('bodyEditorContent');

    ${getToolbarScript(node, initialField)}

    let isDirty = false;
    let originalContent = editor.innerText;
    let saveTimeout = null;
    let isSaving = false;
    let saveGuardTimer = null;
    let currentField = '${initialField}';
    let currentType = '${node.type}';
    let currentEditorMode = '${initialField === '__overview__' ? 'overview' : initialField === '__attributes__' ? 'attributes' : initialField === '__content__' ? 'content' : initialField === '__images__' ? 'images' : 'prose'}';
    let menuOpen = false;

    // LOCAL STATE - these are modified instantly, only saved on Save button click
    let localAttributes = ${JSON.stringify(node.attributes || [])};
    let localContentSections = ${JSON.stringify(node.contentSections || [])};
    let attributesDirty = false;
    let contentSectionsDirty = false;

    // Track dirty state for overview prose fields
    let summaryDirty = false;
    let bodyDirty = false;
    let originalSummary = summaryEditorContent ? summaryEditorContent.innerText : '';
    let originalBody = bodyEditorContent ? bodyEditorContent.innerText : '';

    // Images state
    let localImages = ${JSON.stringify(node.images || [])};
    let imagesDirty = false;
    let currentModalIndex = 0;
    
    // Detect system theme for JavaScript access
    function detectSystemTheme() {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    
    // Update data attribute for system theme (enhances CSS)
    function updateSystemThemeAttribute() {
      const systemTheme = detectSystemTheme();
      document.documentElement.setAttribute('data-detected-system', systemTheme);
    }
    
    // Initialize system theme detection
    updateSystemThemeAttribute();
    
    // Listen for system theme changes
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      updateSystemThemeAttribute();
    });
    
    // Update counts (no longer needed for display, but keep for compatibility)
    function updateCounts() {
      // Character count removed - author shown in footer instead
    }
    
    // Mark prose as dirty
    function markDirty() {
      isDirty = true;
      updateDirtyIndicator();
    }
    
    function markAttributesDirty() {
      attributesDirty = true;
      updateDirtyIndicator();
    }
    
    function markContentSectionsDirty() {
      contentSectionsDirty = true;
      updateDirtyIndicator();
    }
    
    // ----- Inline title editing -----
    let isEditingName = false;
    let isSubmittingName = false;
    
    function enterNameEdit() {
      if (!nodeNameDisplay || !nodeNameEdit || isSubmittingName) return;
      if (isEditingName) return;
      isEditingName = true;
      nodeNameEdit.textContent = nodeNameDisplay.textContent.trim();
      nodeNameDisplay.classList.add('editing-hidden');
      nodeNameEdit.classList.add('editing-active');
      nodeNameEdit.contentEditable = 'true';
      nodeNameEdit.focus();
      // Select all text
      const range = document.createRange();
      range.selectNodeContents(nodeNameEdit);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
    
    function exitNameEdit() {
      if (!nodeNameDisplay || !nodeNameEdit) return;
      isEditingName = false;
      nodeNameEdit.contentEditable = 'false';
      nodeNameEdit.classList.remove('editing-active');
      nodeNameDisplay.classList.remove('editing-hidden');
    }
    
    function submitNameEdit() {
      if (!nodeNameDisplay || !nodeNameEdit) return;
      if (isSubmittingName) return;
      
      const newName = nodeNameEdit.textContent.trim();
      const currentName = nodeNameDisplay.textContent.trim();
      
      exitNameEdit();
      
      if (!newName || newName === currentName) {
        nodeNameEdit.textContent = currentName;
        return;
      }
      
      isSubmittingName = true;
      vscode.postMessage({
        type: 'renameName',
        name: newName
      });
      
      // Slight delay to avoid double submits from blur + enter
      setTimeout(() => {
        isSubmittingName = false;
      }, 0);
    }
    
    if (nodeNameDisplay && nodeNameEdit) {
      nodeNameDisplay.addEventListener('click', enterNameEdit);
      nodeNameDisplay.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          enterNameEdit();
        }
      });
      
      nodeNameEdit.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          submitNameEdit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          nodeNameEdit.textContent = nodeNameDisplay.textContent.trim();
          exitNameEdit();
        }
      });
      
      nodeNameEdit.addEventListener('blur', () => {
        if (isEditingName) {
          submitNameEdit();
        }
      });
    }
    // ----- End inline title editing -----
    
    function updateDirtyIndicator() {
      const anyDirty = isDirty || attributesDirty || contentSectionsDirty || summaryDirty || bodyDirty || imagesDirty;
      if (anyDirty) {
        saveMenuBtn.classList.add('dirty');
        saveMenuBtn.classList.remove('saved-flash');
        saveMenuBtn.title = 'Unsaved changes - Click to save or Ctrl+S';
      } else {
        saveMenuBtn.classList.remove('dirty');
        saveMenuBtn.title = 'All changes saved';
      }
    }
    
    // Mark as clean
    function markClean() {
      isDirty = false;
      attributesDirty = false;
      contentSectionsDirty = false;
      summaryDirty = false;
      bodyDirty = false;
      imagesDirty = false;
      updateDirtyIndicator();
      originalContent = editor.innerText;
      if (summaryEditorContent) originalSummary = summaryEditorContent.innerText;
      if (bodyEditorContent) originalBody = bodyEditorContent.innerText;
    }

    // Save function - saves ALL pending changes
    function save() {
      const anyDirty = isDirty || attributesDirty || contentSectionsDirty || summaryDirty || bodyDirty;
      if (!anyDirty || isSaving) return;

      // Cancel pending auto-save to prevent double-fire
      if (saveTimeout) {
        clearTimeout(saveTimeout);
        saveTimeout = null;
      }

      isSaving = true;
      // Safety net: reset isSaving if no response within 10 seconds
      saveGuardTimer = setTimeout(() => {
        if (isSaving) {
          isSaving = false;
          saveMenuBtn.disabled = false;
          saveMenuBtn.title = 'Save may have failed - try again';
        }
      }, 10000);
      saveMenuBtn.disabled = true;
      saveMenuBtn.classList.remove('dirty');
      saveMenuBtn.title = 'Saving...';

      // Save prose if dirty (single field mode)
      if (isDirty) {
        vscode.postMessage({
          type: 'save',
          text: editor.innerText,
          field: currentField,
          newType: currentType
        });
      }

      // Save summary from overview mode
      if (summaryDirty && summaryEditorContent) {
        vscode.postMessage({
          type: 'save',
          text: summaryEditorContent.innerText,
          field: 'summary',
          newType: currentType
        });
      }

      // Save body from overview mode
      if (bodyDirty && bodyEditorContent) {
        vscode.postMessage({
          type: 'save',
          text: bodyEditorContent.innerText,
          field: 'body',
          newType: currentType
        });
      }

      // Save attributes if dirty
      if (attributesDirty) {
        vscode.postMessage({
          type: 'saveAttributes',
          attributes: localAttributes
        });
      }
      
      // Save content sections if dirty
      if (contentSectionsDirty) {
        vscode.postMessage({
          type: 'saveContentSections',
          sections: localContentSections
        });
      }
    }
    
    // Editor containers
    const proseEditor = document.getElementById('proseEditor');
    const attributesEditor = document.getElementById('attributesEditor');
    const contentEditor = document.getElementById('contentEditor');
    
    // Show/hide editors based on field type
    function showEditor(editorType) {
      // Remove all mode classes
      document.body.classList.remove('mode-prose', 'mode-structured', 'mode-overview', 'mode-images');

      // Add appropriate mode class
      if (editorType === 'overview') {
        document.body.classList.add('mode-overview');
      } else if (editorType === 'images') {
        document.body.classList.add('mode-images');
      } else if (editorType === 'attributes' || editorType === 'content') {
        document.body.classList.add('mode-structured');
        // Keep active class for structured editor selection
        attributesEditor.classList.toggle('active', editorType === 'attributes');
        contentEditor.classList.toggle('active', editorType === 'content');
      } else {
        // prose mode
        document.body.classList.add('mode-prose');
      }
    }
    
    // Handle field change
    fieldSelector.addEventListener('change', (e) => {
      // Save current content first if dirty
      if (isDirty) {
        save();
      }
      
      const newField = e.target.value;
      currentField = newField;
      
      // Update toolbar context
      if (typeof window.updateToolbarForField === 'function') {
        window.updateToolbarForField(newField);
      }
      
      // Determine which editor to show
      if (newField === '__overview__') {
        showEditor('overview');
        currentEditorMode = 'overview';
        // Overview mode shows all existing editors - no rendering needed
        // Just ensure attributes and content are rendered
        renderAttributesTable();
        renderContentSections();
      } else if (newField === '__attributes__') {
        showEditor('attributes');
        currentEditorMode = 'attributes';
        // Render from local state (no network call needed)
        renderAttributesTable();
      } else if (newField === '__content__') {
        showEditor('content');
        currentEditorMode = 'content';
        // Render from local state (no network call needed)
        renderContentSections();
      } else if (newField === '__images__') {
        showEditor('images');
        currentEditorMode = 'images';
      } else {
        showEditor('prose');
        currentEditorMode = 'prose';
        // Request content for the new field (prose still needs fetch)
        vscode.postMessage({
          type: 'switchField',
          field: newField
        });
      }
    });
    
    // Handle type change
    typeSelector.addEventListener('change', (e) => {
      const newType = e.target.value;
      
      // Update current type
      currentType = newType;
      
      // Mark as dirty (doesn't save immediately)
      markDirty();
      
      // Post message to extension to track type change
      vscode.postMessage({
        type: 'typeChanged',
        newType: newType
      });
    });
    
    // Attributes Editor Handlers - LOCAL STATE ONLY (fast!)
    const addAttrBtn = document.getElementById('addAttrBtn');
    const attributesContainer = document.getElementById('attributesContainer');
    
    // Re-render attributes from local state (card-based layout)
    function renderAttributesTable() {
      if (localAttributes.length === 0) {
        attributesContainer.innerHTML = \`
          <div class="empty-state">
            <div class="empty-state-icon">📊</div>
            <p>No attributes yet</p>
            <p style="font-size: 0.8rem;">Click "+ Add Attribute" to create one</p>
          </div>
        \`;
        return;
      }
      
      attributesContainer.innerHTML = localAttributes.map((attr, i) => \`
        <div class="attr-card" data-index="\${i}">
          <div class="attr-card-content">
            <div class="attr-title">
              <span class="attr-name name-field inline-editable" data-index="\${i}" tabindex="0" title="Click to edit name">\${escapeHtml(attr.name || 'Untitled')}</span>
              <span class="attr-name-edit name-field inline-edit-field" data-index="\${i}" contenteditable="false"></span>
            </div>
            <textarea class="attr-value-input" data-index="\${i}" placeholder="Value">\${escapeHtml(String(attr.value || ''))}</textarea>
            <select class="type-select" data-index="\${i}">
              <option value="" \${!attr.dataType && !attr.type ? 'selected' : ''}>auto</option>
              <option value="string" \${attr.dataType === 'string' || attr.type === 'string' ? 'selected' : ''}>string</option>
              <option value="int" \${attr.dataType === 'int' || attr.type === 'int' ? 'selected' : ''}>int</option>
              <option value="float" \${attr.dataType === 'float' || attr.type === 'float' ? 'selected' : ''}>float</option>
              <option value="bool" \${attr.dataType === 'bool' || attr.type === 'bool' ? 'selected' : ''}>bool</option>
            </select>
            <div class="dropdown-menu">
              <button class="menu-btn" title="More options">⋮</button>
              <div class="menu-dropdown">
                <button class="menu-item delete-item" data-index="\${i}">🗑 Delete</button>
              </div>
            </div>
          </div>
        </div>
      \`).join('');
      
      // Auto-resize all attribute value textareas after rendering
      setTimeout(() => {
        resizeAllAttributeValues();
      }, 0);
    }
    
    function escapeHtml(str) {
      return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    function safeParseInt(value, fallback) {
      if (value == null) return fallback;
      const parsed = parseInt(value, 10);
      return isNaN(parsed) ? fallback : parsed;
    }

    // Track editing state for attributes
    const attrEditingState = new Map(); // index -> { isEditing: bool, isSubmitting: bool }
    
    function enterAttrEdit(index) {
      const key = \`attr-\${index}\`;
      if (attrEditingState.get(key)?.isEditing || attrEditingState.get(key)?.isSubmitting) return;
      
      const displaySpan = attributesContainer.querySelector(\`.attr-name[data-index="\${index}"]\`);
      const editSpan = attributesContainer.querySelector(\`.attr-name-edit[data-index="\${index}"]\`);
      
      if (!displaySpan || !editSpan) return;
      
      attrEditingState.set(key, { isEditing: true, isSubmitting: false });
      editSpan.textContent = displaySpan.textContent.trim();
      displaySpan.classList.add('editing-hidden');
      editSpan.classList.add('editing-active');
      editSpan.contentEditable = 'true';
      editSpan.focus();
      
      // Select all text
      const range = document.createRange();
      range.selectNodeContents(editSpan);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
    
    function exitAttrEdit(index) {
      const key = \`attr-\${index}\`;
      const displaySpan = attributesContainer.querySelector(\`.attr-name[data-index="\${index}"]\`);
      const editSpan = attributesContainer.querySelector(\`.attr-name-edit[data-index="\${index}"]\`);
      
      if (!displaySpan || !editSpan) return;
      
      const state = attrEditingState.get(key);
      if (state) state.isEditing = false;
      
      editSpan.contentEditable = 'false';
      editSpan.classList.remove('editing-active');
      displaySpan.classList.remove('editing-hidden');
    }
    
    function submitAttrEdit(index) {
      const key = \`attr-\${index}\`;
      const state = attrEditingState.get(key);
      if (state?.isSubmitting) return;
      
      const displaySpan = attributesContainer.querySelector(\`.attr-name[data-index="\${index}"]\`);
      const editSpan = attributesContainer.querySelector(\`.attr-name-edit[data-index="\${index}"]\`);
      
      if (!displaySpan || !editSpan) return;
      
      const newValue = editSpan.textContent.trim();
      const currentValue = displaySpan.textContent.trim();
      
      exitAttrEdit(index);
      
      if (!newValue || newValue === currentValue) {
        editSpan.textContent = currentValue;
        return;
      }
      
      if (state) state.isSubmitting = true;
      
      // Update local state
      localAttributes[index].name = newValue;
      
      // Auto-generate key from name (silently, not shown in UI)
      const sanitizedKey = sanitizeKey(newValue);
      localAttributes[index].key = sanitizedKey;
      
      markAttributesDirty();
      
      // Update display
      displaySpan.textContent = newValue;
      
      if (state) state.isSubmitting = false;
    }
    
    addAttrBtn.addEventListener('click', () => {
      // Add to local state instantly
      localAttributes.push({ key: '', name: 'Untitled', value: '', dataType: undefined });
      markAttributesDirty();
      renderAttributesTable();
    });
    
    attributesContainer.addEventListener('input', (e) => {
      const target = e.target;
      if (target.classList.contains('attr-value-input')) {
        const card = target.closest('.attr-card');
        const index = safeParseInt(card.dataset.index, -1);
        if (index < 0) return;
        // Update local state instantly (no network call!)
        if (localAttributes[index]) {
          localAttributes[index].value = target.value;
          markAttributesDirty();
          // Auto-resize as user types
          autoResizeAttributeValue(target);
        }
      } else if (target.classList.contains('type-select')) {
        const card = target.closest('.attr-card');
        const index = safeParseInt(card.dataset.index, -1);
        if (index < 0) return;
        // Update local state instantly
        if (localAttributes[index]) {
          localAttributes[index].dataType = target.value || undefined;
          markAttributesDirty();
        }
      }
    });
    
    attributesContainer.addEventListener('click', (e) => {
      // Handle inline editing clicks
      const nameSpan = e.target.closest('.attr-name.inline-editable');
      if (nameSpan) {
        e.stopPropagation();
        e.preventDefault();
        const index = safeParseInt(nameSpan.dataset.index, -1);
        if (index < 0) return;
        enterAttrEdit(index);
        return;
      }
      
      // Handle menu button click
      const menuBtn = e.target.closest('.menu-btn');
      if (menuBtn) {
        e.stopPropagation();
        e.preventDefault();
        const menu = menuBtn.closest('.dropdown-menu');
        // Close all other menus
        attributesContainer.querySelectorAll('.dropdown-menu.active').forEach(m => {
          if (m !== menu) m.classList.remove('active');
        });
        // Toggle this menu
        menu.classList.toggle('active');
        return;
      }
      
      // Handle delete menu item click
      const deleteItem = e.target.closest('.delete-item');
      if (deleteItem) {
        e.stopPropagation();
        e.preventDefault();
        const index = safeParseInt(deleteItem.dataset.index, -1);
        if (index < 0) return;
        // Remove from local state instantly (no confirm - it doesn't work in webviews)
        localAttributes.splice(index, 1);
        markAttributesDirty();
        renderAttributesTable();
        return;
      }
      
      // Close any open menus when clicking elsewhere
      attributesContainer.querySelectorAll('.dropdown-menu.active').forEach(m => {
        m.classList.remove('active');
      });
    });
    
    attributesContainer.addEventListener('keydown', (e) => {
      const editSpan = e.target.closest('.attr-name-edit');
      if (!editSpan) return;

      const index = safeParseInt(editSpan.dataset.index, -1);
      if (index < 0) return;

      if (e.key === 'Enter') {
        e.preventDefault();
        submitAttrEdit(index);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        const displaySpan = attributesContainer.querySelector(\`.attr-name[data-index="\${index}"]\`);
        editSpan.textContent = displaySpan.textContent.trim();
        exitAttrEdit(index);
      }
    });
    
    attributesContainer.addEventListener('blur', (e) => {
      const editSpan = e.target.closest('.attr-name-edit');
      if (!editSpan) return;
      
      const index = safeParseInt(editSpan.dataset.index, -1);
      if (index < 0) return;
      const key = \`attr-\${index}\`;
      if (attrEditingState.get(key)?.isEditing) {
        submitAttrEdit(index);
      }
    }, true);
    
    // Content Sections Editor Handlers - LOCAL STATE ONLY (fast!)
    const addContentBtn = document.getElementById('addContentBtn');
    const contentContainer = document.getElementById('contentContainer');
    const toggleAllContentBtn = document.getElementById('toggleAllContentBtn');
    
    // Auto-resize textarea to fit content
    function autoResizeTextarea(textarea) {
      if (!textarea) return;
      // Reset height to recalculate
      textarea.style.height = 'auto';
      // Set to scrollHeight (content height) with minimum of 100px
      textarea.style.height = Math.max(100, textarea.scrollHeight) + 'px';
    }
    
    // Auto-resize attribute value textarea to fit content
    function autoResizeAttributeValue(textarea) {
      if (!textarea) return;
      // Reset height to recalculate
      textarea.style.height = 'auto';
      // Set to scrollHeight (content height) with minimum of 40px (single line)
      textarea.style.height = Math.max(40, textarea.scrollHeight) + 'px';
    }
    
    // Resize all visible textareas
    function resizeAllTextareas() {
      const textareas = contentContainer.querySelectorAll('.content-textarea');
      textareas.forEach(textarea => autoResizeTextarea(textarea));
    }
    
    // Resize all attribute value textareas
    function resizeAllAttributeValues() {
      const textareas = attributesContainer.querySelectorAll('.attr-value-input');
      textareas.forEach(textarea => autoResizeAttributeValue(textarea));
    }
    
    // Update toggle all button state
    function updateToggleAllButton() {
      if (!toggleAllContentBtn) return;
      const sections = contentContainer.querySelectorAll('.content-section');
      if (sections.length === 0) {
        toggleAllContentBtn.style.display = 'none';
        return;
      }
      toggleAllContentBtn.style.display = '';
      
      const expandedSections = contentContainer.querySelectorAll('.content-section.expanded');
      const allExpanded = expandedSections.length === sections.length;
      
      if (allExpanded) {
        toggleAllContentBtn.textContent = 'Collapse All ▲';
      } else {
        toggleAllContentBtn.textContent = 'Expand All ▼';
      }
    }
    
    // Re-render content sections from local state
    function renderContentSections() {
      if (localContentSections.length === 0) {
        contentContainer.innerHTML = \`
          <div class="empty-state">
            <div class="empty-state-icon">📝</div>
            <p>No content sections yet</p>
            <p style="font-size: 0.8rem;">Click "+ Add Section" to create one</p>
          </div>
        \`;
        updateToggleAllButton();
        return;
      }
      
      contentContainer.innerHTML = localContentSections.map((section, i) => \`
        <div class="content-section" data-index="\${i}">
          <div class="content-section-header">
            <div class="content-section-title">
              <span class="content-section-toggle">▶</span>
              <span class="content-section-name name-field inline-editable" data-index="\${i}" tabindex="0" title="Click to edit name">\${escapeHtml(section.name || 'Untitled')}</span>
              <span class="content-section-name-edit name-field inline-edit-field" data-index="\${i}" contenteditable="false"></span>
            </div>
            <div class="dropdown-menu">
              <button class="menu-btn" title="More options">⋮</button>
              <div class="menu-dropdown">
                <button class="menu-item delete-item" data-index="\${i}">🗑 Delete</button>
              </div>
            </div>
          </div>
          <div class="content-section-body">
            <textarea class="content-textarea" data-index="\${i}">\${escapeHtml(section.value || '')}</textarea>
          </div>
        </div>
      \`).join('');
      
      // Auto-resize all textareas after rendering
      setTimeout(() => {
        resizeAllTextareas();
      }, 0);
      
      // Update toggle all button state
      updateToggleAllButton();
    }
    
    addContentBtn.addEventListener('click', () => {
      // Add to local state instantly
      localContentSections.push({ key: '', name: '', value: '' });
      markContentSectionsDirty();
      renderContentSections();
      // Expand the new section
      const newSection = contentContainer.querySelector('.content-section:last-child');
      if (newSection) {
        newSection.classList.add('expanded');
        updateToggleAllButton();
      }
    });
    
    // Toggle all sections expand/collapse
    if (toggleAllContentBtn) {
      toggleAllContentBtn.addEventListener('click', () => {
        const sections = contentContainer.querySelectorAll('.content-section');
        const expandedSections = contentContainer.querySelectorAll('.content-section.expanded');
        const allExpanded = expandedSections.length === sections.length;
        
        sections.forEach(section => {
          if (allExpanded) {
            section.classList.remove('expanded');
          } else {
            section.classList.add('expanded');
          }
        });
        
        // Resize textareas when expanding
        if (!allExpanded) {
          setTimeout(() => {
            resizeAllTextareas();
          }, 0);
        }
        
        updateToggleAllButton();
      });
    }
    
    // Track editing state for content sections
    const editingState = new Map(); // sectionIndex -> { field: 'name'|'key', isEditing: bool, isSubmitting: bool }
    
    function enterContentSectionEdit(index, field) {
      const key = \`\${index}-\${field}\`;
      if (editingState.get(key)?.isEditing || editingState.get(key)?.isSubmitting) return;
      
      const displaySpan = contentContainer.querySelector(\`.content-section-\${field}[data-index="\${index}"]\`);
      const editSpan = contentContainer.querySelector(\`.content-section-\${field}-edit[data-index="\${index}"]\`);
      
      if (!displaySpan || !editSpan) return;
      
      editingState.set(key, { field, isEditing: true, isSubmitting: false });
      editSpan.textContent = displaySpan.textContent.trim();
      displaySpan.classList.add('editing-hidden');
      editSpan.classList.add('editing-active');
      editSpan.contentEditable = 'true';
      editSpan.focus();
      
      // Select all text
      const range = document.createRange();
      range.selectNodeContents(editSpan);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
    
    function exitContentSectionEdit(index, field) {
      const key = \`\${index}-\${field}\`;
      const displaySpan = contentContainer.querySelector(\`.content-section-\${field}[data-index="\${index}"]\`);
      const editSpan = contentContainer.querySelector(\`.content-section-\${field}-edit[data-index="\${index}"]\`);
      
      if (!displaySpan || !editSpan) return;
      
      const state = editingState.get(key);
      if (state) state.isEditing = false;
      
      editSpan.contentEditable = 'false';
      editSpan.classList.remove('editing-active');
      displaySpan.classList.remove('editing-hidden');
    }
    
    function sanitizeKey(name) {
      return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')  // Replace non-alphanumeric with underscore
        .replace(/^_+|_+$/g, '')       // Remove leading/trailing underscores
        .replace(/_+/g, '_');          // Replace multiple underscores with single
    }
    
    function submitContentSectionEdit(index, field) {
      const key = \`\${index}-\${field}\`;
      const state = editingState.get(key);
      if (state?.isSubmitting) return;
      
      const displaySpan = contentContainer.querySelector(\`.content-section-\${field}[data-index="\${index}"]\`);
      const editSpan = contentContainer.querySelector(\`.content-section-\${field}-edit[data-index="\${index}"]\`);
      
      if (!displaySpan || !editSpan) return;
      
      const newValue = editSpan.textContent.trim();
      const currentValue = displaySpan.textContent.trim();
      
      exitContentSectionEdit(index, field);
      
      if (!newValue || newValue === currentValue) {
        editSpan.textContent = currentValue;
        return;
      }
      
      if (state) state.isSubmitting = true;
      
      // Update local state
      localContentSections[index][field] = newValue;
      
      // Auto-generate key from name (silently, not shown in UI)
      if (field === 'name') {
        const sanitizedKey = sanitizeKey(newValue);
        localContentSections[index].key = sanitizedKey;
      }
      
      markContentSectionsDirty();
      
      // Update display
      displaySpan.textContent = newValue;
      
      if (state) state.isSubmitting = false;
    }
    
    contentContainer.addEventListener('click', (e) => {
      // Don't toggle if clicking on any editable elements or their edit spans
      const nameSpan = e.target.closest('.content-section-name.inline-editable, .content-section-name-edit');
      
      // Handle inline editing clicks
      if (nameSpan && nameSpan.classList.contains('inline-editable')) {
        e.stopPropagation();
        e.preventDefault();
        const index = safeParseInt(nameSpan.dataset.index, -1);
        if (index < 0) return;
        enterContentSectionEdit(index, 'name');
        return;
      } else if (nameSpan) {
        // Clicked on edit span while editing - don't toggle
        e.stopPropagation();
        return;
      }
      
      // Handle menu button click
      const menuBtn = e.target.closest('.menu-btn');
      if (menuBtn) {
        e.stopPropagation();
        e.preventDefault();
        const menu = menuBtn.closest('.dropdown-menu');
        // Close all other menus
        contentContainer.querySelectorAll('.dropdown-menu.active').forEach(m => {
          if (m !== menu) m.classList.remove('active');
        });
        // Toggle this menu
        menu.classList.toggle('active');
        return;
      }
      
      // Handle delete menu item click
      const deleteItem = e.target.closest('.delete-item');
      if (deleteItem) {
        e.stopPropagation();
        e.preventDefault();
        const index = safeParseInt(deleteItem.dataset.index, -1);
        if (index < 0) return;
        // Remove from local state instantly (no confirm - it doesn't work in webviews)
        localContentSections.splice(index, 1);
        markContentSectionsDirty();
        renderContentSections();
        return;
      }
      
      // Close any open menus when clicking elsewhere
      contentContainer.querySelectorAll('.dropdown-menu.active').forEach(m => {
        m.classList.remove('active');
      });
      
      // Only toggle if clicking directly on the header (not on interactive elements)
      const header = e.target.closest('.content-section-header');
      if (header) {
        const section = header.closest('.content-section');
        const wasExpanded = section.classList.contains('expanded');
        section.classList.toggle('expanded');
        
        // Update button state after toggle
        updateToggleAllButton();
        
        // Resize textarea when expanding
        if (!wasExpanded) {
          const textarea = section.querySelector('.content-textarea');
          setTimeout(() => {
            autoResizeTextarea(textarea);
          }, 0);
        }
      }
    });
    
    contentContainer.addEventListener('input', (e) => {
      if (e.target.classList.contains('content-textarea')) {
        const index = safeParseInt(e.target.dataset.index, -1);
        if (index < 0) return;
        localContentSections[index].value = e.target.value;
        markContentSectionsDirty();
        // Auto-resize as user types
        autoResizeTextarea(e.target);
      }
    });
    
    contentContainer.addEventListener('keydown', (e) => {
      const editSpan = e.target.closest('.content-section-name-edit');
      if (!editSpan) return;

      const index = safeParseInt(editSpan.dataset.index, -1);
      if (index < 0) return;
      const field = 'name';

      if (e.key === 'Enter') {
        e.preventDefault();
        submitContentSectionEdit(index, field);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        const displaySpan = contentContainer.querySelector(\`.content-section-\${field}[data-index="\${index}"]\`);
        editSpan.textContent = displaySpan.textContent.trim();
        exitContentSectionEdit(index, field);
      }
    });
    
    contentContainer.addEventListener('blur', (e) => {
      const editSpan = e.target.closest('.content-section-name-edit');
      if (!editSpan) return;
      
      const index = safeParseInt(editSpan.dataset.index, -1);
      if (index < 0) return;
      const field = 'name';

      const key = \`\${index}-\${field}\`;
      if (editingState.get(key)?.isEditing) {
        submitContentSectionEdit(index, field);
      }
    }, true);
    
    // Close menus when clicking outside
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.dropdown-menu')) {
        contentContainer.querySelectorAll('.dropdown-menu.active').forEach(m => {
          m.classList.remove('active');
        });
        attributesContainer.querySelectorAll('.dropdown-menu.active').forEach(m => {
          m.classList.remove('active');
        });
      }
    });
    
    // Overview mode: Make section headers clickable to navigate to specific views
    document.addEventListener('click', (e) => {
      const sectionHeader = e.target.closest('.overview-section-header, .overview-section-header-inline');
      if (sectionHeader && document.body.classList.contains('mode-overview')) {
        const targetField = sectionHeader.dataset.field;
        if (targetField && fieldSelector) {
          // Switch to the target field
          fieldSelector.value = targetField;
          fieldSelector.dispatchEvent(new Event('change'));
        }
      }
    });
    
    // Throttle content change messages to avoid flooding
    let contentChangeTimeout = null;
    
    // Handle content changes
    function handleEditorChange() {
      markDirty();
      updateCounts();
      
      // Send content update to extension (throttled)
      if (contentChangeTimeout) {
        clearTimeout(contentChangeTimeout);
      }
      contentChangeTimeout = setTimeout(() => {
        vscode.postMessage({
          type: 'contentChanged',
          text: editor.innerText,
          field: currentField
        });
      }, 500); // Send every 500ms max
      
      // Auto-save after 2 seconds of inactivity
      if (saveTimeout) {
        clearTimeout(saveTimeout);
      }
      saveTimeout = setTimeout(() => {
        if (isDirty) {
          save();
        }
      }, 2000);
    }
    
    editor.addEventListener('input', handleEditorChange);
    editor.addEventListener('beforeinput', handleEditorChange);

    // Overview prose editor handlers
    function handleSummaryChange() {
      if (summaryEditorContent && summaryEditorContent.innerText !== originalSummary) {
        summaryDirty = true;
        updateDirtyIndicator();
      }
    }

    function handleBodyChange() {
      if (bodyEditorContent && bodyEditorContent.innerText !== originalBody) {
        bodyDirty = true;
        updateDirtyIndicator();
      }
    }

    if (summaryEditorContent) {
      summaryEditorContent.addEventListener('input', handleSummaryChange);
      summaryEditorContent.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
          e.preventDefault();
          save();
        }
      });
    }

    if (bodyEditorContent) {
      bodyEditorContent.addEventListener('input', handleBodyChange);
      bodyEditorContent.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
          e.preventDefault();
          save();
        }
      });
    }

    // Handle keyboard shortcuts
    editor.addEventListener('keydown', (e) => {
      // Ctrl/Cmd + S to save
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        save();
      }
    });
    
    // Menu button click - toggle dropdown
    saveMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      menuOpen = !menuOpen;
      if (menuOpen) {
        saveMenuDropdown.classList.add('show');
        saveMenuBtn.classList.add('active');
      } else {
        saveMenuDropdown.classList.remove('show');
        saveMenuBtn.classList.remove('active');
      }
    });
    
    // Close menu when clicking outside
    document.addEventListener('click', (e) => {
      if (menuOpen && !saveMenuBtn.contains(e.target) && !saveMenuDropdown.contains(e.target)) {
        menuOpen = false;
        saveMenuDropdown.classList.remove('show');
        saveMenuBtn.classList.remove('active');
      }
    });
    
    // Handle menu item clicks
    saveMenuDropdown.addEventListener('click', (e) => {
      const item = e.target.closest('.save-menu-item, .save-menu-footer');
      if (!item) return;
      
      const action = item.dataset.action;
      
      // Close menu
      menuOpen = false;
      saveMenuDropdown.classList.remove('show');
      saveMenuBtn.classList.remove('active');
      
      // Execute action
      switch (action) {
        case 'save':
          save();
          break;
        case 'saveAs':
          vscode.postMessage({ type: 'saveAs' });
          break;
        case 'openFile':
          vscode.postMessage({ type: 'openFile' });
          break;
      }
    });
    
    // Handle blur (save on focus loss)
    editor.addEventListener('blur', () => {
      if (isDirty) {
        save();
      }
    });
    
    // Handle messages from extension
    window.addEventListener('message', (event) => {
      const message = event.data;
      switch (message.type) {
        case 'saved':
          isDirty = false;
          isSaving = false;
          if (saveGuardTimer) { clearTimeout(saveGuardTimer); saveGuardTimer = null; }
          checkAllClean();
          break;
        case 'nameUpdated':
          if (nodeNameDisplay && nodeNameEdit) {
            nodeNameDisplay.textContent = message.name;
            nodeNameEdit.textContent = message.name;
            exitNameEdit();
          }
          break;
        case 'nameUpdateError':
          if (message.error) {
            alert(message.error);
          }
          break;
        case 'saveComplete':
          // All saves complete - mark everything clean
          markClean();
          isSaving = false;
          if (saveGuardTimer) { clearTimeout(saveGuardTimer); saveGuardTimer = null; }
          saveMenuBtn.disabled = false;
          saveMenuBtn.classList.remove('dirty');
          saveMenuBtn.classList.add('saved-flash');
          saveMenuBtn.title = 'All changes saved';
          setTimeout(() => {
            saveMenuBtn.classList.remove('saved-flash');
          }, 1000);
          break;
        case 'content':
          if (!isDirty) {
            editor.innerText = message.text;
            updateCounts();
          }
          break;
        case 'fieldContent':
          // Switched to a new field
          editor.innerText = message.text || '';
          currentField = message.field;
          originalContent = editor.innerText;
          isDirty = false;
          updateDirtyIndicator();
          updateCounts();
          editor.focus();
          break;
          
        case 'switchToField':
          // External request to switch to a specific field
          fieldSelector.value = message.field;
          fieldSelector.dispatchEvent(new Event('change'));
          break;
        
        case 'fieldAdded':
          // A new field was added - update UI
          if (message.node) {
            // Update local node state (for toolbar dropdown)
            // Note: This is a simplified approach; full refresh would require rebuilding HTML
            
            // If we're in overview mode, refresh the view
            if (currentEditorMode === 'overview') {
              // Reload the page to show new field options
              location.reload();
            } else if (message.addedField) {
              // Switch to the newly added field
              fieldSelector.value = message.addedField;
              fieldSelector.dispatchEvent(new Event('change'));
            }
          }
          break;
          
        case 'themeChanged':
          // Update theme setting
          document.documentElement.setAttribute('data-theme-setting', message.themeSetting);
          document.documentElement.setAttribute('data-vscode-theme', message.vscodeTheme);
          updateSystemThemeAttribute();
          break;

        case 'imageCaptionSaved':
          // Image caption was saved - reset dirty state
          imagesDirty = false;
          checkAllClean();
          break;

        case 'workspaceImages':
          allWorkspaceImages = message.images || [];
          renderWorkspaceImages(allWorkspaceImages, false);
          // Enable search after loading
          if (imageSearch) {
            imageSearch.disabled = false;
          }
          break;

        case 'imageAdded':
          if (message.image) {
            localImages.push(message.image);
            updateImagesGallery();
            closeBrowserModal();
          }
          showToast('Image added successfully', 'success');
          break;

        case 'imagesAdded':
          if (message.images && message.images.length > 0) {
            localImages.push(...message.images);
            updateImagesGallery();
            closeBrowserModal();
          }
          showToast(\`\${message.images.length} image(s) imported\`, 'success');
          break;

        case 'imageDeleted':
          // Remove from local array
          const deleteIndex = message.index;
          if (deleteIndex >= 0 && deleteIndex < localImages.length) {
            localImages.splice(deleteIndex, 1);
            updateImagesGallery();
            closeImageModal();
          }
          showToast('Image removed', 'success');
          break;

        case 'imagesReordered':
          // Order saved successfully
          imagesDirty = false;
          checkAllClean();
          showToast('Images reordered', 'success');
          break;

        case 'imageAddError':
        case 'imageImportError':
        case 'imageDeleteError':
        case 'imageReorderError':
          showToast(message.message, 'error');
          break;

        case 'duplicateFound':
          showDuplicateModal(message.filePath, message.existingPath, message.previewUrl);
          break;
      }
    });

    // === IMAGE MODAL HANDLERS ===

    const imageModal = document.getElementById('imageModal');
    const modalImage = document.getElementById('modalImage');
    const modalCaption = document.getElementById('modalCaption');
    const modalCounter = document.getElementById('modalCounter');
    const modalClose = document.getElementById('modalClose');
    const modalPrev = document.getElementById('modalPrev');
    const modalNext = document.getElementById('modalNext');
    const modalBackdrop = imageModal?.querySelector('.modal-backdrop');

    function openImageModal(index) {
      if (!localImages || index < 0 || index >= localImages.length) return;

      currentModalIndex = index;
      const img = localImages[index];

      // Resolve URL for display
      const resolvedUrl = resolveImageUrl(img.url);

      modalImage.src = resolvedUrl;
      modalImage.alt = img.alt || img.caption || 'Image';
      modalCaption.value = img.caption || '';
      modalCounter.textContent = \`\${index + 1} / \${localImages.length}\`;

      // Update nav button states
      modalPrev.disabled = index === 0;
      modalNext.disabled = index === localImages.length - 1;

      imageModal.style.display = 'flex';
      document.body.style.overflow = 'hidden';
    }

    function closeImageModal() {
      imageModal.style.display = 'none';
      document.body.style.overflow = '';
    }

    function navigateModal(direction) {
      const newIndex = currentModalIndex + direction;
      if (newIndex >= 0 && newIndex < localImages.length) {
        openImageModal(newIndex);
      }
    }

    function resolveImageUrl(url) {
      // URLs are resolved by the manager, just return as-is for now
      // The manager replaces vscode-resource-placeholder with actual URLs
      return url.replace('vscode-resource-placeholder:', '');
    }

    // Thumbnail click handler
    document.addEventListener('click', (e) => {
      const thumbnail = e.target.closest('.image-thumbnail, .gallery-item');
      if (thumbnail) {
        const index = safeParseInt(thumbnail.dataset.index, -1);
        if (index < 0) return;
        openImageModal(index);
      }
    });

    // Thumbnail keyboard handler
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        const thumbnail = e.target.closest('.image-thumbnail, .gallery-item');
        if (thumbnail) {
          e.preventDefault();
          const index = safeParseInt(thumbnail.dataset.index, -1);
          if (index < 0) return;
          openImageModal(index);
        }
      }
    });

    // Modal close handlers
    if (modalClose) {
      modalClose.addEventListener('click', closeImageModal);
    }
    if (modalBackdrop) {
      modalBackdrop.addEventListener('click', closeImageModal);
    }

    // Modal navigation
    if (modalPrev) {
      modalPrev.addEventListener('click', () => navigateModal(-1));
    }
    if (modalNext) {
      modalNext.addEventListener('click', () => navigateModal(1));
    }

    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
      if (imageModal && imageModal.style.display === 'flex') {
        if (e.key === 'Escape') {
          closeImageModal();
        } else if (e.key === 'ArrowLeft') {
          navigateModal(-1);
        } else if (e.key === 'ArrowRight') {
          navigateModal(1);
        }
      }
    });

    // Caption edit handler
    if (modalCaption) {
      modalCaption.addEventListener('change', (e) => {
        const newCaption = e.target.value.trim();
        const img = localImages[currentModalIndex];

        if (img && img.caption !== newCaption) {
          img.caption = newCaption || undefined;
          imagesDirty = true;
          updateDirtyIndicator();

          // Update thumbnail caption if visible
          const thumbnail = document.querySelector(\`.image-thumbnail[data-index="\${currentModalIndex}"] .thumbnail-caption\`);
          if (thumbnail) {
            thumbnail.textContent = newCaption || ' ';
            thumbnail.title = newCaption || '';
          }

          // Update gallery item caption if visible
          const galleryCaption = document.querySelector(\`.gallery-item[data-index="\${currentModalIndex}"] .gallery-caption\`);
          if (galleryCaption) {
            galleryCaption.textContent = newCaption || 'No caption';
            galleryCaption.title = newCaption || '';
          }

          // Send patch update to save
          vscode.postMessage({
            type: 'updateImageCaption',
            url: img.url,
            caption: newCaption
          });
        }
      });
    }

    // Custom confirm modal elements
    const confirmModal = document.getElementById('confirmModal');
    const confirmBackdrop = document.getElementById('confirmBackdrop');
    const confirmCancel = document.getElementById('confirmCancel');
    const confirmOk = document.getElementById('confirmOk');
    const confirmTitle = document.getElementById('confirmTitle');
    const confirmMessage = document.getElementById('confirmMessage');

    let pendingDeleteCallback = null;

    function showConfirmModal(title, message, onConfirm) {
      if (confirmTitle) confirmTitle.textContent = title;
      if (confirmMessage) confirmMessage.textContent = message;
      pendingDeleteCallback = onConfirm;
      if (confirmModal) {
        confirmModal.style.display = 'flex';
        // Focus the cancel button for accessibility
        if (confirmCancel) confirmCancel.focus();
      }
    }

    function hideConfirmModal() {
      if (confirmModal) confirmModal.style.display = 'none';
      pendingDeleteCallback = null;
    }

    if (confirmCancel) {
      confirmCancel.addEventListener('click', hideConfirmModal);
    }
    if (confirmBackdrop) {
      confirmBackdrop.addEventListener('click', hideConfirmModal);
    }
    if (confirmOk) {
      confirmOk.addEventListener('click', () => {
        if (pendingDeleteCallback) pendingDeleteCallback();
        hideConfirmModal();
      });
    }

    // Apply focus traps to modals
    trapFocus(document.querySelector('.confirm-content'));
    trapFocus(document.querySelector('.duplicate-content'));
    trapFocus(document.querySelector('.image-browser-content'));

    // Escape key closes confirm modal
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && confirmModal && confirmModal.style.display !== 'none') {
        hideConfirmModal();
      }
    });

    // Duplicate modal elements
    const duplicateModal = document.getElementById('duplicateModal');
    const duplicateBackdrop = document.getElementById('duplicateBackdrop');
    const duplicatePath = document.getElementById('duplicatePath');
    const duplicatePreview = document.getElementById('duplicatePreview');
    const duplicateUseExisting = document.getElementById('duplicateUseExisting');
    const duplicateImportAnyway = document.getElementById('duplicateImportAnyway');
    const duplicateCancel = document.getElementById('duplicateCancel');

    let pendingDuplicateFile = null;
    let pendingDuplicateExistingPath = null;

    function showDuplicateModal(filePath, existingPath, previewUrl) {
      if (duplicatePath) duplicatePath.textContent = existingPath;
      if (duplicatePreview) duplicatePreview.src = previewUrl;
      pendingDuplicateFile = filePath;
      pendingDuplicateExistingPath = existingPath;
      if (duplicateModal) {
        duplicateModal.style.display = 'flex';
        if (duplicateUseExisting) duplicateUseExisting.focus();
      }
    }

    function hideDuplicateModal() {
      if (duplicateModal) duplicateModal.style.display = 'none';
      pendingDuplicateFile = null;
      pendingDuplicateExistingPath = null;
    }

    if (duplicateCancel) {
      duplicateCancel.addEventListener('click', () => {
        vscode.postMessage({ type: 'duplicateResolved', action: 'cancel' });
        hideDuplicateModal();
      });
    }
    if (duplicateBackdrop) {
      duplicateBackdrop.addEventListener('click', () => {
        vscode.postMessage({ type: 'duplicateResolved', action: 'cancel' });
        hideDuplicateModal();
      });
    }
    if (duplicateUseExisting) {
      duplicateUseExisting.addEventListener('click', () => {
        vscode.postMessage({
          type: 'duplicateResolved',
          action: 'useExisting',
          existingPath: pendingDuplicateExistingPath
        });
        hideDuplicateModal();
      });
    }
    if (duplicateImportAnyway) {
      duplicateImportAnyway.addEventListener('click', () => {
        vscode.postMessage({
          type: 'duplicateResolved',
          action: 'importAnyway',
          filePath: pendingDuplicateFile
        });
        hideDuplicateModal();
      });
    }

    // Escape key closes duplicate modal
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && duplicateModal && duplicateModal.style.display !== 'none') {
        vscode.postMessage({ type: 'duplicateResolved', action: 'cancel' });
        hideDuplicateModal();
      }
    });

    const modalDelete = document.getElementById('modalDelete');
    if (modalDelete) {
      modalDelete.addEventListener('click', () => {
        const img = localImages[currentModalIndex];
        if (!img) return;

        showConfirmModal(
          'Delete Image',
          'Delete this image reference? The image file will NOT be deleted from disk.',
          () => {
            vscode.postMessage({
              type: 'deleteImage',
              url: img.url,
              index: currentModalIndex
            });
          }
        );
      });
    }

    // === IMAGE BROWSER MODAL HANDLERS ===

    const imageBrowserModal = document.getElementById('imageBrowserModal');
    const browserBackdrop = document.getElementById('browserBackdrop');
    const browserClose = document.getElementById('browserClose');
    const tabWorkspace = document.getElementById('tabWorkspace');
    const tabImport = document.getElementById('tabImport');
    const workspaceTab = document.getElementById('workspaceTab');
    const importTab = document.getElementById('importTab');
    const imageSearch = document.getElementById('imageSearch');
    const imageBrowserGrid = document.getElementById('imageBrowserGrid');
    const importFromDiskBtn = document.getElementById('importFromDiskBtn');
    const addImageBtn = document.getElementById('addImageBtn');

    let allWorkspaceImages = [];

    function openBrowserModal() {
      if (imageBrowserModal) {
        imageBrowserModal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
        // Show loading state
        if (imageBrowserGrid) {
          imageBrowserGrid.innerHTML = '<div class="browser-loading">Scanning workspace for images...</div>';
        }
        // Disable search while loading
        if (imageSearch) {
          imageSearch.disabled = true;
          imageSearch.value = '';
        }
        // Request workspace images
        vscode.postMessage({ type: 'openImageBrowser' });
      }
    }

    function closeBrowserModal() {
      if (imageBrowserModal) {
        imageBrowserModal.style.display = 'none';
        document.body.style.overflow = '';
        // Reset search to enabled state
        if (imageSearch) {
          imageSearch.disabled = false;
        }
      }
    }

    function switchTab(tab) {
      if (tab === 'workspace') {
        tabWorkspace?.classList.add('active');
        tabImport?.classList.remove('active');
        if (workspaceTab) workspaceTab.style.display = 'flex';
        if (importTab) importTab.style.display = 'none';
      } else {
        tabWorkspace?.classList.remove('active');
        tabImport?.classList.add('active');
        if (workspaceTab) workspaceTab.style.display = 'none';
        if (importTab) importTab.style.display = 'flex';
      }
    }

    function renderWorkspaceImages(images, isSearchResult = false) {
      if (!imageBrowserGrid) return;

      if (images.length === 0) {
        if (isSearchResult) {
          imageBrowserGrid.innerHTML = '<div class="browser-empty">No images match your search</div>';
        } else {
          imageBrowserGrid.innerHTML = '<div class="browser-empty">No images found in workspace</div>';
        }
        return;
      }

      imageBrowserGrid.innerHTML = images.map(img => \`
        <div class="browser-image-item" data-path="\${escapeHtml(img.path)}" title="\${escapeHtml(img.path)}">
          <img src="\${escapeHtml(img.thumbnail)}" alt="\${escapeHtml(img.filename)}" loading="lazy" />
          <div class="browser-image-name">\${escapeHtml(img.filename)}</div>
          <div class="browser-image-folder">\${escapeHtml(img.folder)}</div>
        </div>
      \`).join('');
    }

    function filterImages(query) {
      const filtered = allWorkspaceImages.filter(img =>
        img.filename.toLowerCase().includes(query.toLowerCase()) ||
        img.folder.toLowerCase().includes(query.toLowerCase())
      );
      renderWorkspaceImages(filtered, query.length > 0);
    }

    // Add Image button click
    if (addImageBtn) {
      addImageBtn.addEventListener('click', openBrowserModal);
    }

    // Close browser modal
    if (browserClose) {
      browserClose.addEventListener('click', closeBrowserModal);
    }
    if (browserBackdrop) {
      browserBackdrop.addEventListener('click', closeBrowserModal);
    }

    // Tab switching
    if (tabWorkspace) {
      tabWorkspace.addEventListener('click', () => switchTab('workspace'));
    }
    if (tabImport) {
      tabImport.addEventListener('click', () => switchTab('import'));
    }

    // Search filter
    if (imageSearch) {
      imageSearch.addEventListener('input', (e) => {
        filterImages(e.target.value);
      });
    }

    // Import from disk button
    if (importFromDiskBtn) {
      importFromDiskBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'importImage' });
      });
    }

    // Click on workspace image to add it
    if (imageBrowserGrid) {
      imageBrowserGrid.addEventListener('click', (e) => {
        const item = e.target.closest('.browser-image-item');
        if (item) {
          const imagePath = item.dataset.path;
          vscode.postMessage({ type: 'addExistingImage', imagePath });
        }
      });
    }

    // Keyboard: Escape to close browser modal
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && imageBrowserModal && imageBrowserModal.style.display === 'flex') {
        closeBrowserModal();
      }
    });

    // Update images gallery display
    function updateImagesGallery() {
      const imagesContainer = document.getElementById('imagesContainer');
      const imagesCount = document.querySelector('.images-count');
      const imagesEditor = document.getElementById('imagesEditor');

      if (imagesContainer) {
        if (localImages.length === 0) {
          imagesContainer.innerHTML = '<div class="images-empty">No images</div>';
        } else {
          imagesContainer.innerHTML = \`<div class="images-grid">\${localImages.map((img, index) => \`
            <div class="image-thumbnail" data-index="\${index}" data-url="\${escapeHtml(img.url)}" tabindex="0" role="button" aria-label="View image \${index + 1}\${img.caption ? ': ' + escapeHtml(img.caption) : ''}">
              \${img.featured ? '<span class="featured-badge">★</span>' : ''}
              <img src="\${img.url}" alt="\${escapeHtml(img.alt || img.caption || 'Image')}" loading="lazy" />
              <div class="thumbnail-caption" title="\${escapeHtml(img.caption || '')}">\${escapeHtml(img.caption || '') || '&nbsp;'}</div>
            </div>
          \`).join('')}</div>\`;
        }
      }

      if (imagesCount) {
        imagesCount.textContent = \`\${localImages.length} images\`;
      }

      // Show images section if it was hidden
      if (imagesEditor) {
        imagesEditor.classList.remove('images-empty-hidden');
      }

      // Re-initialize drag handlers for new elements
      initDragHandlers();
    }

    // === DRAG AND DROP REORDER ===

    let draggedIndex = null;

    function initDragHandlers() {
      const thumbnails = document.querySelectorAll('.image-thumbnail, .gallery-item');

      thumbnails.forEach((thumb, index) => {
        thumb.setAttribute('draggable', 'true');

        thumb.addEventListener('dragstart', (e) => {
          draggedIndex = index;
          thumb.classList.add('dragging');
          e.dataTransfer.effectAllowed = 'move';
        });

        thumb.addEventListener('dragend', () => {
          thumb.classList.remove('dragging');
          draggedIndex = null;
          // Remove all drag-over states
          document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
          // Clean up indicators
          document.querySelectorAll('.drag-over-left, .drag-over-right').forEach(el => {
            el.classList.remove('drag-over-left', 'drag-over-right');
          });
        });

        thumb.addEventListener('dragover', (e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          thumb.classList.add('drag-over');
        });

        thumb.addEventListener('dragleave', () => {
          thumb.classList.remove('drag-over');
        });

        thumb.addEventListener('drop', (e) => {
          e.preventDefault();
          thumb.classList.remove('drag-over');
          // Clean up indicators
          document.querySelectorAll('.drag-over-left, .drag-over-right').forEach(el => {
            el.classList.remove('drag-over-left', 'drag-over-right');
          });

          const dropIndex = index;
          if (draggedIndex !== null && draggedIndex !== dropIndex) {
            // Reorder local array
            const [removed] = localImages.splice(draggedIndex, 1);
            localImages.splice(dropIndex, 0, removed);

            // Update display
            updateImagesGallery();

            // Save new order
            const newOrder = localImages.map(img => img.url);
            vscode.postMessage({ type: 'reorderImages', order: newOrder });
          }
        });
      });
    }

    // Initial drag handler setup
    initDragHandlers();

    // Document-level dragover for drop indicator
    document.addEventListener('dragover', (e) => {
      e.preventDefault();
      const target = e.target;
      const thumbnail = target && typeof target.closest === 'function'
        ? target.closest('.image-thumbnail, .gallery-item')
        : null;

      // Remove previous indicators
      document.querySelectorAll('.drag-over-left, .drag-over-right').forEach(el => {
        el.classList.remove('drag-over-left', 'drag-over-right');
      });

      if (thumbnail && !thumbnail.classList.contains('dragging')) {
        const rect = thumbnail.getBoundingClientRect();
        const midpoint = rect.left + rect.width / 2;
        if (e.clientX < midpoint) {
          thumbnail.classList.add('drag-over-left');
        } else {
          thumbnail.classList.add('drag-over-right');
        }
      }
    });

    // Check if all saves are complete
    function checkAllClean() {
      if (!isDirty && !attributesDirty && !contentSectionsDirty && !imagesDirty) {
        saveMenuBtn.disabled = false;
        saveMenuBtn.classList.remove('dirty');
        saveMenuBtn.classList.add('saved-flash');
        saveMenuBtn.title = 'All changes saved';
        setTimeout(() => {
          saveMenuBtn.classList.remove('saved-flash');
        }, 1000);
      }
    }
    
    // Initial counts
    updateCounts();
    
    // Initialize with remembered field/editor mode
    if (currentEditorMode === 'overview') {
      showEditor('overview');
      renderAttributesTable();
      renderContentSections();
    } else if (currentEditorMode === 'attributes') {
      showEditor('attributes');
      renderAttributesTable();
    } else if (currentEditorMode === 'content') {
      showEditor('content');
      renderContentSections();
    } else if (currentEditorMode === 'images') {
      showEditor('images');
    } else {
      showEditor('prose');
      editor.focus();
    }
  `;
}
