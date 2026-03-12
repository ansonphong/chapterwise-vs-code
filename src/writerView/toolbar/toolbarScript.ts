/**
 * Toolbar client-side logic
 * This code runs in the webview context
 */

import { CodexNode } from '../../codexModel';

export function getToolbarScript(node: CodexNode, initialField: string): string {
  // Serialize node data for use in the script
  const nodeData = {
    availableFields: node.availableFields,
    hasAttributes: node.hasAttributes || (node.attributes && node.attributes.length > 0),
    hasContentSections: node.hasContentSections || (node.contentSections && node.contentSections.length > 0),
    hasImages: node.hasImages || (node.images && node.images.length > 0)
  };
  
  return /* javascript */ `
    // === CONTEXT TOOLBAR LOGIC ===
    
    const toolbar = document.getElementById('contextToolbar');
    const nodeData = ${JSON.stringify(nodeData)};
    
    let currentToolbarContext = getContextFromField('${initialField}');
    
    /**
     * Get toolbar context from field name
     */
    function getContextFromField(field) {
      if (field === '__overview__') return 'overview';
      if (field === '__attributes__') return 'attributes';
      if (field === '__content__') return 'content';
      if (field === 'summary') return 'summary';
      return 'body';
    }
    
    /**
     * Build dropdown menu options for +Add button
     */
    function buildAddDropdownOptions() {
      const options = [];
      
      // Check which fields already exist
      const hasSummary = nodeData.availableFields.includes('summary');
      const hasBody = nodeData.availableFields.includes('body');
      const hasAttributes = nodeData.hasAttributes;
      const hasContentSections = nodeData.hasContentSections;
      
      // Add Summary option if it doesn't exist
      if (!hasSummary) {
        options.push(\`
          <button class="toolbar-dropdown-item" 
                  data-field-type="summary" 
                  role="menuitem"
                  tabindex="0">
            <span class="dropdown-item-icon">📝</span>
            <span class="dropdown-item-label">Summary</span>
          </button>
        \`);
      }
      
      // Add Body option if it doesn't exist
      if (!hasBody) {
        options.push(\`
          <button class="toolbar-dropdown-item" 
                  data-field-type="body" 
                  role="menuitem"
                  tabindex="0">
            <span class="dropdown-item-icon">📄</span>
            <span class="dropdown-item-label">Body</span>
          </button>
        \`);
      }
      
      // Add Attributes option if it doesn't exist
      if (!hasAttributes) {
        options.push(\`
          <button class="toolbar-dropdown-item" 
                  data-field-type="attributes" 
                  role="menuitem"
                  tabindex="0">
            <span class="dropdown-item-icon">📊</span>
            <span class="dropdown-item-label">Attributes</span>
          </button>
        \`);
      }
      
      // Add Content Sections option if it doesn't exist
      if (!hasContentSections) {
        options.push(\`
          <button class="toolbar-dropdown-item"
                  data-field-type="content"
                  role="menuitem"
                  tabindex="0">
            <span class="dropdown-item-icon">📝</span>
            <span class="dropdown-item-label">Content Sections</span>
          </button>
        \`);
      }

      // Add Images option if node has no images yet
      const hasImages = nodeData.hasImages;
      if (!hasImages) {
        options.push(\`
          <button class="toolbar-dropdown-item"
                  data-field-type="images"
                  role="menuitem"
                  tabindex="0">
            <span class="dropdown-item-icon">🖼</span>
            <span class="dropdown-item-label">Images</span>
          </button>
        \`);
      }

      if (options.length === 0) {
        return '<div class="toolbar-dropdown-empty">All fields exist</div>';
      }
      
      return options.join('');
    }
    
    /**
     * Build toolbar buttons HTML for a specific context
     */
    function buildToolbarButtonsHtml(context) {
      if (context === 'body' || context === 'summary') {
        // Prose editing buttons
        return \`
          <button class="toolbar-btn" 
                  id="toolbar-bold" 
                  data-action="bold"
                  title="Bold (Ctrl/Cmd+B)"
                  aria-label="Toggle bold formatting">
            <span class="toolbar-btn-icon">𝐁</span>
          </button>
          <button class="toolbar-btn" 
                  id="toolbar-italic" 
                  data-action="italic"
                  title="Italic (Ctrl/Cmd+I)"
                  aria-label="Toggle italic formatting">
            <span class="toolbar-btn-icon">𝐼</span>
          </button>
          <button class="toolbar-btn" 
                  id="toolbar-underline" 
                  data-action="underline"
                  title="Underline (Ctrl/Cmd+U)"
                  aria-label="Toggle underline formatting">
            <span class="toolbar-btn-icon">U̲</span>
          </button>
        \`;
      } else if (context === 'overview') {
        // +Add dropdown button
        return \`
          <div class="toolbar-dropdown" id="toolbarAddDropdown">
            <button class="toolbar-btn toolbar-add-btn" 
                    id="toolbar-add" 
                    data-action="add"
                    title="Add new field or section"
                    aria-label="Add new field or section"
                    aria-haspopup="true"
                    aria-expanded="false">
              <span class="toolbar-btn-label">+ Add</span>
            </button>
            <div class="toolbar-dropdown-menu" id="toolbarAddMenu" role="menu">
              \${buildAddDropdownOptions()}
            </div>
          </div>
        \`;
      } else {
        // attributes or content - no toolbar for now
        return '<!-- No toolbar buttons for this context -->';
      }
    }
    
    /**
     * Update toolbar visibility and buttons based on context
     */
    function updateToolbarContext(context) {
      currentToolbarContext = context;
      
      // Rebuild toolbar HTML dynamically
      if (toolbar) {
        toolbar.innerHTML = buildToolbarButtonsHtml(context);
        
        // Re-initialize event handlers for the new buttons
        if (context === 'body' || context === 'summary') {
          initFormattingButtons();
        } else if (context === 'overview') {
          initAddDropdown();
        }
      }
    }
    
    /**
     * Initialize formatting button handlers
     */
    function initFormattingButtons() {
      const boldBtn = document.getElementById('toolbar-bold');
      const italicBtn = document.getElementById('toolbar-italic');
      const underlineBtn = document.getElementById('toolbar-underline');
      
      if (boldBtn) {
        boldBtn.addEventListener('click', (e) => {
          e.preventDefault();
          handleFormatting('bold');
        });
      }
      
      if (italicBtn) {
        italicBtn.addEventListener('click', (e) => {
          e.preventDefault();
          handleFormatting('italic');
        });
      }
      
      if (underlineBtn) {
        underlineBtn.addEventListener('click', (e) => {
          e.preventDefault();
          handleFormatting('underline');
        });
      }
    }
    
    /**
     * Handle formatting commands
     */
    function handleFormatting(command) {
      const editor = document.getElementById('editor');
      if (!editor) return;
      
      // Save selection before executing command
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) {
        return;
      }
      
      try {
        // Execute the formatting command
        document.execCommand(command, false, null);
        
        // Mark as dirty
        markDirty();
        
        // Return focus to editor
        editor.focus();
      } catch (error) {
        console.error('Formatting command failed:', error);
      }
    }
    
    /**
     * Initialize +Add dropdown
     */
    function initAddDropdown() {
      const addDropdown = document.getElementById('toolbarAddDropdown');
      const addButton = document.getElementById('toolbar-add');
      const addMenu = document.getElementById('toolbarAddMenu');
      
      if (!addButton || !addDropdown || !addMenu) return;
      
      // Toggle dropdown on button click
      addButton.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const isActive = addDropdown.classList.contains('active');
        
        if (isActive) {
          closeAddDropdown();
        } else {
          openAddDropdown();
        }
      });
      
      // Handle dropdown item clicks
      addMenu.addEventListener('click', (e) => {
        const item = e.target.closest('.toolbar-dropdown-item');
        if (!item) return;
        
        e.preventDefault();
        e.stopPropagation();
        
        const fieldType = item.dataset.fieldType;
        if (fieldType) {
          handleAddField(fieldType);
        }
        
        closeAddDropdown();
      });
      
      // Keyboard navigation in dropdown
      addMenu.addEventListener('keydown', (e) => {
        const items = Array.from(addMenu.querySelectorAll('.toolbar-dropdown-item'));
        const currentIndex = items.findIndex(item => item === document.activeElement);
        
        switch (e.key) {
          case 'ArrowDown':
            e.preventDefault();
            if (currentIndex < items.length - 1) {
              items[currentIndex + 1].focus();
            } else {
              items[0].focus();
            }
            break;
          
          case 'ArrowUp':
            e.preventDefault();
            if (currentIndex > 0) {
              items[currentIndex - 1].focus();
            } else {
              items[items.length - 1].focus();
            }
            break;
          
          case 'Enter':
          case ' ':
            e.preventDefault();
            if (currentIndex >= 0) {
              items[currentIndex].click();
            }
            break;
          
          case 'Escape':
            e.preventDefault();
            closeAddDropdown();
            addButton.focus();
            break;
        }
      });
      
      // Close dropdown when clicking outside
      document.addEventListener('click', (e) => {
        if (!addDropdown.contains(e.target)) {
          closeAddDropdown();
        }
      });
    }
    
    /**
     * Open the +Add dropdown
     */
    function openAddDropdown() {
      const addDropdown = document.getElementById('toolbarAddDropdown');
      const addButton = document.getElementById('toolbar-add');
      const addMenu = document.getElementById('toolbarAddMenu');
      
      if (!addDropdown || !addButton || !addMenu) return;
      
      addDropdown.classList.add('active');
      addButton.setAttribute('aria-expanded', 'true');
      
      // Focus first item
      const firstItem = addMenu.querySelector('.toolbar-dropdown-item');
      if (firstItem) {
        setTimeout(() => firstItem.focus(), 50);
      }
    }
    
    /**
     * Close the +Add dropdown
     */
    function closeAddDropdown() {
      const addDropdown = document.getElementById('toolbarAddDropdown');
      const addButton = document.getElementById('toolbar-add');
      
      if (!addDropdown || !addButton) return;
      
      addDropdown.classList.remove('active');
      addButton.setAttribute('aria-expanded', 'false');
    }
    
    /**
     * Handle adding a new field
     */
    function handleAddField(fieldType) {
      if (fieldType === 'images') {
        // Show the images section and trigger add image
        const imagesEditor = document.getElementById('imagesEditor');
        if (imagesEditor) {
          imagesEditor.classList.remove('images-empty-hidden');
        }
        // Mark images as existing in nodeData so the option disappears
        nodeData.hasImages = true;
        // Trigger the add image button
        const addImageBtn = document.getElementById('addImageBtn');
        if (addImageBtn) addImageBtn.click();
        return;
      }
      // Send message to extension to add the field
      vscode.postMessage({
        type: 'addField',
        fieldType: fieldType
      });
    }
    
    /**
     * Update toolbar when field selector changes
     */
    function onFieldSelectorChange(newField) {
      const newContext = getContextFromField(newField);
      updateToolbarContext(newContext);
    }
    
    /**
     * Initialize toolbar
     */
    function initToolbar() {
      initFormattingButtons();
      initAddDropdown();
      
      // Update toolbar context on initial load
      updateToolbarContext(currentToolbarContext);
    }
    
    // Initialize toolbar when DOM is ready
    if (toolbar) {
      initToolbar();
    }
    
    // Export function to be called by main script when field changes
    window.updateToolbarForField = onFieldSelectorChange;
  `;
}

