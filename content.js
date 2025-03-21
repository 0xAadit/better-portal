// Firefox/Chrome compatibility wrapper
const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

/**
 * Determines what type of page we're currently on
 * This helps us load the right theme file
 */
function getPageType() {
    const url = window.location.href;
    
    // Check various URL patterns to identify page type
    if (url.includes('student_dashboard')) {
        return 'home';
    } else if (url.includes('courses')) {
        return 'assignments';
    } else if (url.includes('student_documents') || 
              url.includes('exam_cities_and_hall_ticket') || 
              url.includes('student_certificates') || 
              url.includes('student_courses')) {
        return 'extras';
    }
    
    // If we don't recognize the page, return null
    return null;
}

/**
 * Applies a theme based on user selection
 * @param {string} theme The theme name to apply ('dark-theme', 'purple-nights', or 'default')
 */
async function applyTheme(theme) {
    console.log(`Attempting to apply theme: ${theme}`);
    
    // First, clean up any existing theme styles
    const existingStyles = document.querySelectorAll('style[data-theme-style]');
    if (existingStyles.length > 0) {
        console.log(`Removing ${existingStyles.length} existing theme styles`);
        existingStyles.forEach(style => style.remove());
    }
    
    // If we're switching to the default theme, we're done
    if (theme === 'default') {
        console.log('Switched to default theme (no custom styles)');
        return;
    }

    // Figure out what type of page we're on
    const pageType = getPageType();
    if (!pageType) {
        console.log('Could not determine page type - no theme will be applied');
        return;
    }

    try {
        // Build the key for storage
        const storageKey = `${theme}-${pageType}`;
        console.log(`Looking for cached theme: ${storageKey}`);
        
        // Try to get the theme from storage
        const result = await browserAPI.storage.local.get(storageKey);
        
        if (!result[storageKey]) {
            console.warn(`Theme file ${storageKey} not found in storage`);
            
            // Look for fallback theme in the extension package
            const fallbackUrl = browserAPI.runtime.getURL(`themes/${theme}/${theme}-${pageType}.css`);
            
            // Only attempt to use fallback if we're in a modern browser with fetch
            if (typeof fetch === 'function') {
                try {
                    console.log(`Attempting to load fallback from package: ${fallbackUrl}`);
                    const response = await fetch(fallbackUrl);
                    if (response.ok) {
                        const css = await response.text();
                        injectStyle(css, theme);
                    }
                } catch (fallbackError) {
                    console.error('Failed to load fallback theme:', fallbackError);
                }
            }
            return;
        }

        // We have the theme in storage, so inject it
        injectStyle(result[storageKey], theme);
        console.log(`Successfully applied ${theme} theme for ${pageType} page`);
        
    } catch (error) {
        console.error('Error while applying theme:', error);
    }
}

/**
 * Helper function to inject CSS into the page
 * @param {string} css The CSS text to inject
 * @param {string} themeName The name of the theme (for data attribute)
 */
function injectStyle(css, themeName) {
    const style = document.createElement('style');
    style.textContent = css;
    style.setAttribute('data-theme-style', themeName);
    document.head.appendChild(style);
}

// Apply the theme when the page loads
browserAPI.storage.local.get('theme', function(data) {
    // Give the page a moment to finish loading
    setTimeout(() => {
        const savedTheme = data.theme || 'default';
        console.log(`Page loaded, applying saved theme: ${savedTheme}`);
        applyTheme(savedTheme);
    }, 100);
});

// Listen for theme changes while browsing
browserAPI.storage.onChanged.addListener(function(changes) {
    if (changes.theme) {
        const newTheme = changes.theme.newValue;
        console.log(`Theme changed to: ${newTheme}`);
        applyTheme(newTheme);
    }
});

// For debugging - expose these functions to the console
window.__themeDebug = {
    applyTheme,
    getPageType
};

