// Use the appropriate browser API
const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

// Repository information - for fetching theme files
const REPO_OWNER = '0xAadit';
const REPO_NAME = 'better-portal';
const BRANCH = 'main';

// Define the base themes directory and required files for each theme
const THEMES_BASE_PATH = 'themes';
const REQUIRED_THEME_FILES = ['home', 'assignments', 'extras'];

// Global variable to store theme configurations
let THEMES_CONFIG = {};

// Track downloaded themes
let DOWNLOADED_THEMES = new Set();

/**
 * Fetches the list of themes from GitHub (metadata only, not the actual CSS)
 * @returns {Promise<Object>} Theme configuration object
 */
async function fetchThemesList() {
    try {
        // Fetch the contents of the themes directory
        const response = await fetch(
            `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${THEMES_BASE_PATH}?ref=${BRANCH}`
        );

        if (!response.ok) {
            throw new Error('Failed to fetch themes directory');
        }

        const directories = await response.json();
        const themeConfigs = {};

        // Process each theme directory
        for (const dir of directories) {
            if (dir.type !== 'dir') continue;

            const themeName = dir.name;
            const themeFiles = await fetch(dir.url).then(r => r.json());

            // Verify this directory has all required theme files
            const cssFiles = {};
            let isValidTheme = true;

            for (const requiredFile of REQUIRED_THEME_FILES) {
                const fileName = themeFiles.find(f => 
                    f.name.toLowerCase().includes(requiredFile) && f.name.endsWith('.css')
                )?.name;

                if (!fileName) {
                    console.warn(`Theme ${themeName} missing ${requiredFile} CSS file`);
                    isValidTheme = false;
                    break;
                }

                cssFiles[requiredFile] = fileName;
            }

            if (isValidTheme) {
                themeConfigs[themeName] = {
                    name: themeName.split('-').map(word => 
                        word.charAt(0).toUpperCase() + word.slice(1)
                    ).join(' '),
                    files: cssFiles,
                    path: `${THEMES_BASE_PATH}/${themeName}`
                };
            }
        }

        // Store the discovered themes configuration (just metadata, not the actual CSS)
        await browserAPI.storage.local.set({ 
            'themes_config': themeConfigs,
            'themes_config_updated': new Date().toISOString()
        });

        return themeConfigs;
    } catch (error) {
        console.error('Error fetching themes list:', error);
        
        // Try to load cached theme configuration
        const { themes_config } = await browserAPI.storage.local.get('themes_config');
        return themes_config || {};
    }
}

/**
 * Check if a theme is already downloaded
 * @param {string} themeId The theme ID to check
 * @returns {Promise<boolean>} Whether the theme is downloaded
 */
async function isThemeDownloaded(themeId) {
    // Check if all required files for this theme are in storage
    try {
        const keys = REQUIRED_THEME_FILES.map(fileType => `${themeId}-${fileType}`);
        const result = await browserAPI.storage.local.get(keys);
        
        // Theme is considered downloaded if all files exist and are non-empty
        return keys.every(key => result[key] && result[key].length > 0);
    } catch (error) {
        console.error(`Error checking if theme ${themeId} is downloaded:`, error);
        return false;
    }
}

/**
 * Builds a GitHub raw content URL for a theme file
 * @param {string} themeName Name of the theme
 * @param {string} fileType Type of file (home, assignments, extras)
 * @returns {string} The complete GitHub raw URL
 */
function buildGitHubUrl(themeName, fileType) {
    // Match the exact file naming pattern in the repository
    const fileName = `${themeName}-theme-${fileType}.css`;
    return `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${BRANCH}/themes/${themeName}/${fileName}`;
}

/**
 * Downloads a specific theme
 * @param {string} themeId The theme ID to download
 * @returns {Promise<boolean>} Success or failure
 */
async function downloadTheme(themeId) {
    const themeConfig = THEMES_CONFIG[themeId];
    if (!themeConfig) {
        console.error(`Theme ${themeId} not found in configuration`);
        return false;
    }
    
    try {
        const downloadPromises = [];
        
        // Download each required file for this theme
        for (const fileType of REQUIRED_THEME_FILES) {
            const url = buildGitHubUrl(themeId, fileType);
            const storageKey = `${themeId}-${fileType}`;
            
            console.log(`Downloading ${url} for ${storageKey}`);
            
            const downloadPromise = fetch(url, {
                method: 'GET',
                cache: 'no-cache',
                headers: { 'Accept': 'text/css,*/*' }
            }).then(async response => {
                if (!response.ok) {
                    throw new Error(`Failed to fetch ${url}: ${response.status}`);
                }
                
                const cssContent = await response.text();
                if (!cssContent || cssContent.trim().length < 10) {
                    throw new Error('Received empty or invalid CSS');
                }
                
                // Store the CSS in local storage
                await browserAPI.storage.local.set({ [storageKey]: cssContent });
                console.log(`Downloaded ${storageKey}`);
                
                return true;
            });
            
            downloadPromises.push(downloadPromise);
        }
        
        // Wait for all downloads to complete
        const results = await Promise.all(downloadPromises);
        const success = results.every(result => result === true);
        
        if (success) {
            // Mark this theme as downloaded and save the timestamp
            await browserAPI.storage.local.set({
                [`${themeId}_downloaded`]: new Date().toISOString()
            });
            
            DOWNLOADED_THEMES.add(themeId);
        }
        
        return success;
    } catch (error) {
        console.error(`Error downloading theme ${themeId}:`, error);
        return false;
    }
}

/**
 * Removes a theme from local storage to free up space
 * @param {string} themeId The theme ID to remove
 */
async function removeTheme(themeId) {
    try {
        // Skip if it's the currently selected theme
        const { theme } = await browserAPI.storage.local.get('theme');
        if (theme === themeId) {
            console.log(`Can't remove currently active theme: ${themeId}`);
            return false;
        }
        
        // Remove all files for this theme
        const keysToRemove = REQUIRED_THEME_FILES.map(fileType => `${themeId}-${fileType}`);
        keysToRemove.push(`${themeId}_downloaded`); // Also remove the download timestamp
        
        await browserAPI.storage.local.remove(keysToRemove);
        console.log(`Removed theme ${themeId} from storage`);
        
        DOWNLOADED_THEMES.delete(themeId);
        return true;
    } catch (error) {
        console.error(`Error removing theme ${themeId}:`, error);
        return false;
    }
}

/**
 * Sets up a toggle for a specific theme
 * @param {string} themeId The theme ID for the toggle
 */
function setupThemeToggle(themeId) {
    const toggle = document.getElementById(`${themeId}-toggle`);
    if (!toggle) return;
    
    toggle.addEventListener('change', function() {
        if (this.checked) {
            // Uncheck all other toggles including default
            const defaultToggle = document.getElementById('default-theme-toggle');
            if (defaultToggle) defaultToggle.checked = false;
            
            // Uncheck all other theme toggles
            document.querySelectorAll('input[type="checkbox"][id$="-toggle"]').forEach(otherToggle => {
                if (otherToggle.id !== `${themeId}-toggle`) {
                    otherToggle.checked = false;
                }
            });
            
            // Apply this theme
            browserAPI.storage.local.set({ theme: themeId });
        } else {
            // If this was unchecked, default to the default theme
            const defaultToggle = document.getElementById('default-theme-toggle');
            if (defaultToggle) {
                defaultToggle.checked = true;
                browserAPI.storage.local.set({ theme: 'default' });
            }
        }
    });
}

/**
 * Creates an HTML element with specified properties
 * @param {string} tagName The HTML element tag name
 * @param {Object} attributes Attributes to set on the element
 * @param {Array} children Child elements to append
 * @returns {HTMLElement} The created element
 */
function createElement(tagName, attributes = {}, children = []) {
    const element = document.createElement(tagName);
    
    // Set attributes
    for (const [key, value] of Object.entries(attributes)) {
        if (key === 'textContent') {
            element.textContent = value;
        } else if (key === 'className') {
            element.className = value;
        } else {
            element.setAttribute(key, value);
        }
    }
    
    // Append children
    for (const child of children) {
        if (typeof child === 'string') {
            element.appendChild(document.createTextNode(child));
        } else if (child instanceof Node) {
            element.appendChild(child);
        }
    }
    
    return element;
}

/**
 * Creates the theme list with download buttons and toggle switches
 * @param {Object} themesConfig The theme configuration object
 */
async function createThemeList(themesConfig) {
    const togglesContainer = document.getElementById('theme-toggles');
    // Clear container
    while (togglesContainer.firstChild) {
        togglesContainer.removeChild(togglesContainer.firstChild);
    }
    
    // Get the currently active theme
    const { theme: currentTheme } = await browserAPI.storage.local.get('theme');
    const activeTheme = currentTheme || 'default';
    
    // First, add the default theme option (always available)
    const defaultToggleDiv = createElement('div', { className: 'switch-container' });
    const defaultThemeItem = createElement('div', { className: 'theme-item' });
    
    // Add theme name
    const defaultThemeSpan = createElement('span', { textContent: 'Default Theme' });
    defaultThemeItem.appendChild(defaultThemeSpan);
    
    // Add theme status
    const defaultThemeStatus = createElement('div', { className: 'theme-status' });
    
    // Add toggle input
    const defaultToggleInput = createElement('input', { 
        type: 'checkbox', 
        id: 'default-theme-toggle', 
        style: 'display:none;' 
    });
    
    // Set initial state
    if (activeTheme === 'default') {
        defaultToggleInput.checked = true;
    }
    
    defaultThemeStatus.appendChild(defaultToggleInput);
    
    // Add slider
    const defaultSlider = createElement('span', { 
        className: 'slider', 
        id: 'default-theme-slider' 
    });
    defaultThemeStatus.appendChild(defaultSlider);
    
    defaultThemeItem.appendChild(defaultThemeStatus);
    defaultToggleDiv.appendChild(defaultThemeItem);
    togglesContainer.appendChild(defaultToggleDiv);
    
    // Make the default theme slider clickable
    defaultSlider.addEventListener('click', function() {
        // Only do something if default is not already selected
        if (!defaultToggleInput.checked) {
            // Uncheck all other theme toggles
            document.querySelectorAll('input[type="checkbox"][id$="-toggle"]').forEach(toggle => {
                toggle.checked = false;
            });
            
            // Check the default toggle
            defaultToggleInput.checked = true;
            
            // Set default theme
            browserAPI.storage.local.set({ theme: 'default' });
        }
    });
    
    // Check which themes are already downloaded
    const downloadPromises = [];
    for (const themeId of Object.keys(themesConfig)) {
        downloadPromises.push(
            isThemeDownloaded(themeId).then(isDownloaded => {
                if (isDownloaded) {
                    DOWNLOADED_THEMES.add(themeId);
                }
                return { themeId, isDownloaded };
            })
        );
    }
    
    // Wait for all checks to complete
    await Promise.all(downloadPromises);
    
    // Add each theme with the appropriate download/switch UI
    for (const [themeId, themeConfig] of Object.entries(themesConfig)) {
        const isDownloaded = DOWNLOADED_THEMES.has(themeId);
        
        // Create theme container
        const themeDiv = createElement('div', { className: 'switch-container' });
        const themeItem = createElement('div', { className: 'theme-item' });
        
        // Add theme name
        const themeSpan = createElement('span', { textContent: themeConfig.name });
        themeItem.appendChild(themeSpan);
        
        // Add theme status
        const themeStatus = createElement('div', { className: 'theme-status' });
        
        if (isDownloaded) {
            // Add toggle for downloaded theme
            const toggleInput = createElement('input', {
                type: 'checkbox',
                id: `${themeId}-toggle`,
                style: 'display:none;'
            });
            
            // Set initial state
            if (activeTheme === themeId) {
                toggleInput.checked = true;
            }
            
            themeStatus.appendChild(toggleInput);
            
            const slider = createElement('span', {
                className: 'slider',
                id: `${themeId}-slider`
            });
            themeStatus.appendChild(slider);
            
            // Setup slider click handler
            slider.addEventListener('click', function() {
                const themeToggle = document.getElementById(`${themeId}-toggle`);
                
                // Only do something if this toggle is not already checked
                if (!themeToggle.checked) {
                    // Uncheck all toggles
                    document.querySelectorAll('input[type="checkbox"][id$="-toggle"]').forEach(toggle => {
                        toggle.checked = false;
                    });
                    
                    // Check this toggle
                    themeToggle.checked = true;
                    
                    // Apply this theme
                    browserAPI.storage.local.set({ theme: themeId });
                }
            });
        } else {
            // Add download button for non-downloaded theme
            const downloadBtn = createElement('button', {
                className: 'download-btn',
                id: `${themeId}-download`
            });
            
            const downloadImg = createElement('img', {
                src: 'icons/download.png',
                alt: 'Download',
                width: '14',
                height: '14'
            });
            downloadBtn.appendChild(downloadImg);
            
            // Setup download button click handler
            downloadBtn.addEventListener('click', async function() {
                this.classList.add('loading');
                // Remove the spinner text and keep the icon
                // this.textContent = '⟳'; 
                this.disabled = true;
                
                const success = await downloadTheme(themeId);
                
                if (success) {
                    // Remove download button
                    themeStatus.removeChild(downloadBtn);
                    
                    // Create toggle input and slider
                    const toggleInput = createElement('input', {
                        type: 'checkbox',
                        id: `${themeId}-toggle`,
                        style: 'display:none;'
                    });
                    themeStatus.appendChild(toggleInput);
                    
                    const slider = createElement('span', {
                        className: 'slider',
                        id: `${themeId}-slider`
                    });
                    themeStatus.appendChild(slider);
                    
                    // Setup slider click handler
                    slider.addEventListener('click', function() {
                        const themeToggle = document.getElementById(`${themeId}-toggle`);
                        
                        // Only do something if this toggle is not already checked
                        if (!themeToggle.checked) {
                            // Uncheck all toggles
                            document.querySelectorAll('input[type="checkbox"][id$="-toggle"]').forEach(toggle => {
                                toggle.checked = false;
                            });
                            
                            // Check this toggle
                            themeToggle.checked = true;
                            
                            // Apply this theme
                            browserAPI.storage.local.set({ theme: themeId });
                        }
                    });

                    // Uncheck all toggles
                    document.querySelectorAll('input[type="checkbox"][id$="-toggle"]').forEach(toggle => {
                        toggle.checked = false;
                    });
                    
                    // Check the newly downloaded theme toggle
                    const toggle = document.getElementById(`${themeId}-toggle`);
                    if (toggle) {
                        toggle.checked = true;
                        
                        // Apply this theme
                        browserAPI.storage.local.set({ theme: themeId });
                    }
                } else {
                    // Reset download button
                    this.classList.remove('loading');
                    
                    // No need to clear and recreate, just keep the original icon
                    this.disabled = false;
                }
            });
            
            themeStatus.appendChild(downloadBtn);
        }
        
        themeItem.appendChild(themeStatus);
        themeDiv.appendChild(themeItem);
        togglesContainer.appendChild(themeDiv);
    }
}

/**
 * Easter egg: All this was done by vibe coding lolll (But i had fun)
 * Keeps only the active theme and a few recently used ones
 */
async function cleanupUnusedThemes() {
    try {
        // Get the current active theme
        const { theme } = await browserAPI.storage.local.get('theme');
        
        // Get usage information for all downloaded themes
        const downloadInfo = {};
        for (const themeId of DOWNLOADED_THEMES) {
            const result = await browserAPI.storage.local.get(`${themeId}_downloaded`);
            if (result[`${themeId}_downloaded`]) {
                downloadInfo[themeId] = new Date(result[`${themeId}_downloaded`]);
            }
        }
        
        // Sort themes by download date (newest first)
        const sortedThemes = Object.keys(downloadInfo).sort((a, b) => 
            downloadInfo[b] - downloadInfo[a]
        );
        
        // Keep the active theme and the 2 most recently used themes
        const themesToKeep = new Set([theme]);
        let keptCount = 0;
        
        for (const themeId of sortedThemes) {
            if (themeId !== theme) {
                themesToKeep.add(themeId);
                keptCount++;
                
                if (keptCount >= 2) break; // Keep only 2 recent themes besides the active one
            }
        }
        
        // Remove all other themes
        for (const themeId of DOWNLOADED_THEMES) {
            if (!themesToKeep.has(themeId)) {
                await removeTheme(themeId);
            }
        }
        
        console.log(`Storage cleanup complete. Kept themes: ${Array.from(themesToKeep).join(', ')}`);
    } catch (error) {
        console.error('Error during storage cleanup:', error);
    }
}

/**
 * Setup the UI when the popup opens
 */
document.addEventListener('DOMContentLoaded', async function() {
    const refetchButton = document.getElementById('refetch');
    
    try {
        // First, fetch the themes configuration (metadata only)
        THEMES_CONFIG = await fetchThemesList();
        
        // Create the theme list with appropriate UI elements
        await createThemeList(THEMES_CONFIG);
        
        // Clean up unused themes (after a delay to not slow down popup load)
        setTimeout(cleanupUnusedThemes, 2000);
        
        // Get last update time, if available
        const updateData = await browserAPI.storage.local.get('themes_config_updated');
        if (updateData.themes_config_updated) {
            const lastUpdate = new Date(updateData.themes_config_updated);
            const now = new Date();
            const daysSinceUpdate = Math.floor((now - lastUpdate) / (1000 * 60 * 60 * 24));
            
            // Add a "last updated" note
            const infoText = createElement('div', {
                textContent: daysSinceUpdate === 0 
                ? 'Themes updated today' 
                    : `Themes updated ${daysSinceUpdate} day${daysSinceUpdate !== 1 ? 's' : ''} ago`,
                style: 'font-size: 11px; opacity: 0.7; margin-top: 10px;'
            });
            
            refetchButton.parentNode.appendChild(infoText);
        }
    } catch (error) {
        console.error('Error loading theme state:', error);
    }
    
    // Setup the refetch button to only update the theme list metadata
    refetchButton.addEventListener('click', async function() {
        this.disabled = true;
        this.textContent = '⏳ Updating...';
        
        try {
            THEMES_CONFIG = await fetchThemesList();
            await createThemeList(THEMES_CONFIG);
            
            this.textContent = '✅ Updated!';
            setTimeout(() => {
                this.textContent = '🔄 Refetch Styles';
                this.disabled = false;
            }, 1500);
        } catch (error) {
            console.error('Error updating themes list:', error);
            this.textContent = '❌ Update failed';
            setTimeout(() => {
                this.textContent = '🔄 Refetch Styles';
                this.disabled = false;
            }, 1500);
        }
    });
});
