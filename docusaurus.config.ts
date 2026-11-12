import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

/**
 * The sibling Moco apps. All of them are served from this same host root by the
 * shared nginx (see `moco-nginx/conf.d/locations.conf`), so navigating to one is
 * an ordinary same-tab link — keep this set and its labels in step with the
 * switchers in moco-home, moco-ui and moco-apps/*.
 *
 * None of these are Docusaurus routes, which is why each needs three opt-outs:
 * `pathname://` keeps the link out of the client-side router, `autoAddBaseUrl`
 * keeps `/docs/` off the front of the path, and `target: '_self'` overrides the
 * `_blank` Docusaurus adds to anything it reads as external.
 */
const SIBLING_APPS = [
  {label: 'Home', path: '/'},
  {label: 'Playground', path: '/apps/playground'},
  {label: 'Agent', path: '/apps/moco-agent'},
  {label: 'Console', path: '/ui'},
];

const siblingAppLink = ({label, path}: {label: string; path: string}) => ({
  label,
  href: `pathname://${path}`,
  target: '_self',
  autoAddBaseUrl: false,
  // Hides the external-link glyph: these stay on the site, in this tab.
  className: 'sibling-app-link',
});

const siteNavbarItems = SIBLING_APPS.map((app) => ({
  ...siblingAppLink(app),
  position: 'right' as const,
}));

const siteFooterLinks = SIBLING_APPS.map(siblingAppLink);

const config: Config = {
  title: 'Moco Workflow Platform',
  tagline: 'YAML-based declarative workflow orchestration with dual runtime support',
  // The same mark the console serves at /moco-mark.svg, so the tab icon does not
  // change as you move between the apps.
  favicon: 'img/moco-mark.svg',

  // Set the production url of your site here
  url: 'https://www.my-moco.com',
  // Set the /<baseUrl>/ pathname under which your site is served
  // For GitHub pages deployment, it is often '/<projectName>/'
  baseUrl: '/docs/',

  // GitHub pages deployment config.
  // If you aren't using GitHub pages, you don't need these.
  organizationName: 'moco-workflow', // Usually your GitHub org/user name.
  projectName: 'moco', // Usually your repo name.

  onBrokenLinks: 'warn',
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },

  // Even if you don't use internationalization, you can use this field to set
  // useful metadata like html lang. For example, if your site is Chinese, you
  // may want to replace "en" with "zh-Hans".
  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  // Inter and JetBrains Mono are what the console and the apps set in their
  // Tailwind config; loading them here is what keeps the type identical rather
  // than merely similar. moco-home pulls the same two families.
  stylesheets: [
    'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap',
  ],

  presets: [
    [
      'classic',
      {
        docs: {
          routeBasePath: '/',
          sidebarPath: './sidebars.ts',
          editUrl:
            'https://github.com/moco-workflow/moco/tree/main/moco-doc/',
          // `*.draft.md` files hold working notes for a doc that is not finished yet;
          // they must not ship as pages on the user-facing site.
          exclude: ['**/temp/**', '**/*.draft.md'],
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    navbar: {
      title: 'Moco Docs',
      logo: {
        alt: 'Moco',
        src: 'img/moco-mark.svg',
      },
      // No docSidebar item: it pointed at the same place the logo does now that
      // the overview is the docs root, and the sidebar is always reachable — on
      // narrow screens through the hamburger menu (see `.navbar-sidebar--show` in
      // custom.css for why that menu used to open clipped).
      items: [
        ...siteNavbarItems,
        {
          href: 'https://github.com/moco-workflow/moco-doc',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {
              label: 'Overview',
              to: '/docs/',
            },
            {
              label: 'Quick Start',
              to: '/docs/quick-start',
            },
            {
              label: 'Workflowspec Reference',
              to: '/docs/reference/workflowspec-reference',
            },
          ],
        },
        {
          title: 'Platform',
          items: siteFooterLinks,
        },
        {
          title: 'Community',
          items: [
            {
              label: 'GitHub',
              href: 'https://github.com/moco-workflow',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Moco Workflow Platform. Built with Docusaurus.`,
    },
    colorMode: {
      // The console follows the OS by default; the docs should not be the one
      // app that forces light on someone running everything else dark.
      respectPrefersColorScheme: true,
    },
    prism: {
      theme: prismThemes.oneLight,
      // Dracula's magenta/green sits badly next to the indigo brand; oneDark is
      // closer to the Monaco palette the playground renders specs in.
      darkTheme: prismThemes.oneDark,
      additionalLanguages: ['python', 'bash', 'yaml', 'json'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
