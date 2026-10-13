// themeColors.js: the browser/status-bar colour for each of the app's own themes.
// These match the page background (css/styles.css), and the light colour is also what
// manifest.json uses, so the install splash, status bar and page agree.
export const THEME_COLORS = { light: '#efece1', dark: '#0a0c10' };
export const themeColorFor = theme => (theme === 'dark' ? THEME_COLORS.dark : THEME_COLORS.light);
