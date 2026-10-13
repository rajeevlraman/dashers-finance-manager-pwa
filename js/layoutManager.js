// layoutManager.js
export const LayoutModes = {
  MOBILE: 'mobile',
  TABLET: 'tablet',
  DESKTOP: 'desktop'
};

let currentLayout = null;

/**
 * Detect layout based on window width.
 * - Mobile: <=600px
 * - Tablet: 601–1024px
 * - Desktop: >=1025px
 */
export function detectLayoutMode() {
  const width = window.innerWidth;

  if (width <= 600) return LayoutModes.MOBILE;
  if (width <= 1024) return LayoutModes.TABLET;
  return LayoutModes.DESKTOP;
}

/**
 * Apply layout changes dynamically.
 * You can hook into this to adjust UI.
 */
export function applyLayoutChanges(onChange) {
  const handleResize = () => {
    const newLayout = detectLayoutMode();

    if (newLayout !== currentLayout) {
      currentLayout = newLayout;
      document.documentElement.setAttribute('data-layout', newLayout);

      // Optional: callback to reinit certain UIs
      if (onChange && typeof onChange === 'function') {
        onChange(newLayout);
      }
    }
  };

  // Initial detection
  handleResize();

  // Watch for resize/orientation change
  window.addEventListener('resize', handleResize);
  window.addEventListener('orientationchange', handleResize);
}

/**
 * Get the current layout mode at any time.
 */
export function getCurrentLayout() {
  return currentLayout || detectLayoutMode();
}
