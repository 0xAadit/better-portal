// Use the appropriate browser API
const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

// Repository information - for fetching theme files
const REPO_OWNER = 'YOUR_USERNAME';
const REPO_NAME = 'REPO';
const BRANCH = 'main';

// Define the base themes directory and required files for each theme
const THEMES_BASE_PATH = 'themes';
const REQUIRED_THEME_FILES = ['home', 'assignments', 'extras'];

/**
 * Fetches the list of themes from GitHub
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

        // Store the discovered themes configuration
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
 * Builds a GitHub raw content URL for a theme file
 * @param {string} themePath Path to the theme folder
 * @param {string} fileName Name of the CSS file
 * @returns {string} The complete GitHub raw URL
 */
function buildGitHubUrl(themePath, fileName) {
    return `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${BRANCH}/${themePath}/${fileName}`;
}

/**
 * Fetches a CSS file from GitHub and stores it locally
 * @param {string} url The GitHub raw URL to fetch
 * @param {string} storageKey The key to use for storing in browser.storage
 * @returns {Promise<boolean>} Success or failure
 */
async function fetchAndStoreCSS(url, storageKey) {
    try {
        console.log(`Fetching ${url}...`);
        
        // Attempt to fetch the file from GitHub
        const response = await fetch(url, {
            method: 'GET',
            cache: 'no-cache', // Always get the latest
            headers: {
                'Accept': 'text/css,*/*'
            }
        });
        
        if (!response.ok) {
            throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
        }
        
        // Get the CSS content
        const cssContent = await response.text();
        
        if (!cssContent || cssContent.trim().length < 10) {
            throw new Error('Received empty or invalid CSS');
        }
        
        // Store it with browser.storage
        await browserAPI.storage.local.set({ [storageKey]: cssContent });
        console.log(`Successfully stored ${storageKey}`);
        
        // Also store the last update timestamp
        await browserAPI.storage.local.set({ 
            [`${storageKey}_updated`]: new Date().toISOString() 
        });
        
        return true;
    } catch (error) {
        console.error(`Error fetching ${url}:`, error);
        return false;
    }
}

/**
 * Fetches all theme files for all configured themes
 * Shows progress to the user via button state
 */
async function fetchAllThemes() {
    const button = document.getElementById('refetch');
    button.disabled = true;
    button.textContent = '⏳ Fetching...';
    
    // Create a counter for progress tracking
    let completed = 0;
    let total = 0;
    
    // Count total files to fetch
    Object.values(THEMES_CONFIG).forEach(theme => {
        total += Object.keys(theme.files).length;
    });
    
    try {
        // Keep track of all fetch operations
        const fetchPromises = [];
        let failedFetches = 0;
        
        // Loop through each theme
        for (const [themeId, themeConfig] of Object.entries(THEMES_CONFIG)) {
            // Loop through each file in the theme
            for (const [pageType, fileName] of Object.entries(themeConfig.files)) {
                const url = buildGitHubUrl(themeConfig.path, fileName);
                const storageKey = `${themeId}-${pageType}`;
                
                // Start fetching and update the counter when done
                const fetchPromise = fetchAndStoreCSS(url, storageKey).then(success => {
                    completed++;
                    button.textContent = `⏳ Fetching (${completed}/${total})`;
                    
                    if (!success) {
                        failedFetches++;
                    }
                    
                    return success;
                });
                
                fetchPromises.push(fetchPromise);
            }
        }
        
        // Wait for all fetches to complete
        await Promise.all(fetchPromises);
        
        // Update the button based on results
        if (failedFetches === 0) {
            button.textContent = '✅ All themes updated!';
            
            // Store the last successful update time
            await browserAPI.storage.local.set({
                'last_themes_update': new Date().toISOString()
            });
        } else if (failedFetches < total) {
            button.textContent = `⚠️ Updated ${total - failedFetches}/${total}`;
        } else {
            button.textContent = '❌ Update failed';
        }
        
        // Reset button after a delay
        setTimeout(() => {
            button.textContent = '🔄 Refetch Styles';
            button.disabled = false;
        }, 3000);
        
    } catch (error) {
        console.error('Error fetching themes:', error);
        button.textContent = '❌ Failed to update';
        
        setTimeout(() => {
            button.textContent = '🔄 Refetch Styles';
            button.disabled = false;
        }, 3000);
    }
}

/**
 * Setup the UI when the popup opens
 */
document.addEventListener('DOMContentLoaded', async function() {
    // Get references to the UI elements
    const darkThemeToggle = document.getElementById('dark-theme-toggle');
    const purpleNightsToggle = document.getElementById('purple-nights-toggle');
    const refetchButton = document.getElementById('refetch');
    
    try {
        // Load current theme setting and update toggles
        const data = await browserAPI.storage.local.get('theme');
        const currentTheme = data.theme || 'default';
        
        // Set toggle states based on current theme
        darkThemeToggle.checked = currentTheme === 'dark-theme';
        purpleNightsToggle.checked = currentTheme === 'purple-nights';
        
        // Get last update time, if available
        const updateData = await browserAPI.storage.local.get('last_themes_update');
        if (updateData.last_themes_update) {
            const lastUpdate = new Date(updateData.last_themes_update);
            const now = new Date();
            const daysSinceUpdate = Math.floor((now - lastUpdate) / (1000 * 60 * 60 * 24));
            
            // Add a "last updated" note if we have the data
            const infoText = document.createElement('div');
            infoText.style.fontSize = '11px';
            infoText.style.opacity = '0.7';
            infoText.style.marginTop = '10px';
            infoText.textContent = daysSinceUpdate === 0 
                ? 'Themes updated today' 
                : `Themes updated ${daysSinceUpdate} day${daysSinceUpdate !== 1 ? 's' : ''} ago`;
            
            refetchButton.parentNode.appendChild(infoText);
        }
    } catch (error) {
        console.error('Error loading theme state:', error);
    }
    
    // Handle the dark theme toggle
    darkThemeToggle.addEventListener('change', function() {
        if (this.checked) {
            // If enabling this theme, disable other themes
            purpleNightsToggle.checked = false;
            browserAPI.storage.local.set({ theme: 'dark-theme' });
        } else if (!purpleNightsToggle.checked) {
            // If turning off and no other theme is on, set default
            browserAPI.storage.local.set({ theme: 'default' });
        }
    });
    
    // Handle the purple nights toggle
    purpleNightsToggle.addEventListener('change', function() {
        if (this.checked) {
            // If enabling this theme, disable other themes
            darkThemeToggle.checked = false;
            browserAPI.storage.local.set({ theme: 'purple-nights' });
        } else if (!darkThemeToggle.checked) {
            // If turning off and no other theme is on, set default
            browserAPI.storage.local.set({ theme: 'default' });
        }
    });
    
    // Setup the refetch button
    refetchButton.addEventListener('click', fetchAllThemes);
});
