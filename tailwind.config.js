/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx,jsx}'],
  theme: {
    extend: {
      // Map our CSS variable tokens to Tailwind color utilities
      // Usage: bg-mm-0, text-mm-accent, border-mm-border-0 etc.
      colors: {
        mm: {
          0:    'var(--bg-0)',
          1:    'var(--bg-1)',
          2:    'var(--bg-2)',
          3:    'var(--bg-3)',
          4:    'var(--bg-4)',
          5:    'var(--bg-5)',
          accent:       'var(--accent)',
          'accent-lit': 'var(--accent-light)',
          'accent-dim': 'var(--accent-dim)',
          t0:   'var(--text-0)',
          t1:   'var(--text-1)',
          t2:   'var(--text-2)',
          t3:   'var(--text-3)',
          b0:   'var(--border-0)',
          b1:   'var(--border-1)',
          b2:   'var(--border-2)',
          green: 'var(--green)',
          blue:  'var(--blue)',
        },
      },
    },
  },
  plugins: [require('daisyui')],
  daisyui: {
    themes: [
      {
        // Single base theme; JS overrides all variables at runtime for hue/style changes
        melomaniac: {
          'color-scheme': 'dark',
          'primary':          '#d4803c',
          'primary-content':  '#f5e6cc',
          'secondary':        '#4ead7a',
          'secondary-content':'#f5e6cc',
          'accent':           '#7ab0d8',
          'accent-content':   '#f5e6cc',
          'neutral':          '#2c1d0e',
          'neutral-content':  '#c09a72',
          'base-100':         '#1a1007',
          'base-200':         '#22160a',
          'base-300':         '#2c1d0e',
          'base-content':     '#f5e6cc',
          'info':             '#7ab0d8',
          'success':          '#4ead7a',
          'warning':          '#eca04e',
          'error':            '#e06060',
          // Tighter radii — feels more like a desktop app than a web app
          '--rounded-box':   '0.5rem',
          '--rounded-btn':   '0.375rem',
          '--rounded-badge': '0.25rem',
          '--animation-btn': '0.15s',
          '--animation-input': '0.15s',
          '--btn-focus-scale': '0.97',
          '--border-btn':    '1px',
          '--tab-border':    '1px',
          '--tab-radius':    '0.375rem',
        },
      },
    ],
    darkTheme: 'melomaniac',
    base: true,
    styled: true,
    utils: true,
    logs: false,
  },
};
