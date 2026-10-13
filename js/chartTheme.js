// js/chartTheme.js
//
// Chart.js's own built-in text color is a dark grey (#666-ish), tuned for
// a white page. None of this app's ~20 chart instances (dashboard.js,
// financialDashboard.js, reports.js, expenses.js, quickLook.js,
// wealthOverview.js, financeOverview.js) set their own tick/legend/title
// color, so every chart's axis labels, legend, and "Recent activity" /
// "Top spending categories" style labels were quietly falling back to
// that grey — fine-ish on the light cream background, low-contrast to
// invisible on the dark theme's near-black cards.
//
// Rather than touching every individual chart config across those seven
// files, this sets Chart.js's *global* defaults once: every chart reads
// Chart.defaults.color/.borderColor for any option it doesn't set itself,
// so one place here fixes axis ticks, legend labels, and grid lines
// everywhere at once.
//
// LIVE THEME SWITCHING (dark -> light without a reload)
// -----------------------------------------------------
// Chart.js copies Chart.defaults.scale.* into each chart's own scale
// options at the moment the chart is *constructed*. Changing the
// defaults afterwards (and calling chart.update()) therefore repaints the
// legend/title/tooltip — which are resolved lazily — but NOT the axis
// tick labels or grid lines of charts that are already on screen: those
// kept the previous theme's colors. Going dark -> light left every axis
// label in pale gold (#d9b84a) on a white card, i.e. effectively
// invisible. applyChartTheme() now also walks the live chart instances
// and swaps any scale color that still holds the previous theme's
// default for the new one. Colors a chart set deliberately for itself
// are left alone (they're not equal to the previous defaults).
//
// Charts that hard-code their own colors (financeOverview.js) should use
// chartInk()/chartTextInk() below inside *scriptable* options
// (`color: () => chartTextInk(0.5)`) so they re-resolve on every update().

let lastApplied = null; // { text, grid } that the previous call installed

export function isDarkTheme() {
  return document.documentElement.getAttribute('data-theme') === 'dark';
}

// Translucent "ink" for chart furniture (gridlines, inactive bars, tracks)
// that has to work on whichever surface the card currently is: white ink
// on the dark theme's near-black cards, forest-green ink on the light
// theme's white cards. Pass the alpha you would have used for white ink.
export function chartInk(alpha = 1) {
  return isDarkTheme()
    ? `rgba(255, 255, 255, ${alpha})`
    : `rgba(28, 43, 34, ${Math.min(1, alpha * 1.6)})`;
}

// Same idea for *text* (axis ticks, radar point labels). Small text at the
// 0.4-0.6 alphas that look fine as white-on-dark would be too faint as
// dark-on-white, so the light theme floors the alpha at a legible level.
export function chartTextInk(alpha = 0.6) {
  return isDarkTheme()
    ? `rgba(255, 255, 255, ${alpha})`
    : `rgba(28, 43, 34, ${Math.max(0.72, alpha)})`;
}

function swapColor(obj, key, from, to) {
  if (!obj || typeof obj !== 'object') return;
  if (obj[key] === from.text) obj[key] = to.text;
  else if (obj[key] === from.grid) obj[key] = to.grid;
}

export function applyChartTheme() {
  if (typeof Chart === 'undefined') return;

  const styles = getComputedStyle(document.documentElement);
  const isDark = isDarkTheme();
  // Dark mode: plain white axis/legend text on every chart read as a bit
  // flat and stark against the near-black cards, so this uses the theme's
  // gold accent instead — still bright and crisp, but ties the charts
  // into the same gold used for headings/values elsewhere in dark mode.
  // Light mode is unaffected (--text-main already reads fine on cream).
  const textColor = isDark
    ? ((styles.getPropertyValue('--accent') || '').trim() || '#d9b84a')
    : ((styles.getPropertyValue('--text-main') || '').trim() || '#1c2b22');
  const gridColor = (styles.getPropertyValue('--border') || '').trim() || (isDark ? '#262a35' : '#e1dccb');

  const previous = lastApplied;
  const next = { text: textColor, grid: gridColor };
  lastApplied = next;

  Chart.defaults.color = textColor;
  Chart.defaults.borderColor = gridColor;

  if (Chart.defaults.plugins) {
    if (Chart.defaults.plugins.legend && Chart.defaults.plugins.legend.labels) {
      Chart.defaults.plugins.legend.labels.color = textColor;
    }
    if (Chart.defaults.plugins.title) {
      Chart.defaults.plugins.title.color = textColor;
    }
    if (Chart.defaults.plugins.tooltip) {
      Chart.defaults.plugins.tooltip.titleColor = isDark ? '#14110a' : '#ffffff';
      Chart.defaults.plugins.tooltip.bodyColor = isDark ? '#14110a' : '#ffffff';
      Chart.defaults.plugins.tooltip.backgroundColor = isDark ? textColor : 'rgba(0,0,0,0.8)';
    }
  }

  if (Chart.defaults.scale) {
    Chart.defaults.scale.ticks = Chart.defaults.scale.ticks || {};
    Chart.defaults.scale.ticks.color = textColor;
    Chart.defaults.scale.grid = Chart.defaults.scale.grid || {};
    Chart.defaults.scale.grid.color = gridColor;
    if (Chart.defaults.scale.title) {
      Chart.defaults.scale.title.color = textColor;
    }
  }

  // Re-paint any charts already on screen (theme toggled without
  // navigating away, so their instances already exist with old colors).
  if (Chart.instances) {
    Object.values(Chart.instances).forEach((instance) => {
      try {
        if (previous) {
          // Scale options were snapshotted at construction — re-point any
          // that still hold the previous theme's defaults (see header).
          const scales = (instance.config && instance.config.options && instance.config.options.scales) || {};
          Object.values(scales).forEach((scale) => {
            if (!scale) return;
            swapColor(scale.ticks, 'color', previous, next);
            swapColor(scale.grid, 'color', previous, next);
            swapColor(scale.title, 'color', previous, next);
            swapColor(scale.pointLabels, 'color', previous, next);
            swapColor(scale.angleLines, 'color', previous, next);
          });
          const plugins = (instance.config && instance.config.options && instance.config.options.plugins) || {};
          if (plugins.legend) swapColor(plugins.legend.labels, 'color', previous, next);
          if (plugins.title) swapColor(plugins.title, 'color', previous, next);
        }
        instance.update();
      } catch (e) {
        // instance may be mid-teardown; safe to ignore
      }
    });
  }
}
