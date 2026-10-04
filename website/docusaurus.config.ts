import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'Intelliwright',
  tagline:
    'End-to-end tests for web apps, with page objects and Jev-powered checks, actions and failure triage.',
  favicon: 'img/favicon.svg',

  future: {
    v4: true,
  },

  url: 'https://neeraj719714.github.io',
  baseUrl: '/intelliwright/',
  trailingSlash: false,

  onBrokenLinks: 'throw',
  onBrokenAnchors: 'throw',
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'throw',
    },
  },

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    colorMode: {
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'Intelliwright',
      logo: {
        alt: 'Intelliwright',
        src: 'img/logo.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docs',
          position: 'left',
          label: 'Docs',
        },
        {
          type: 'docSidebar',
          sidebarId: 'reference',
          position: 'left',
          label: 'Reference',
        },
        {
          href: 'https://www.npmjs.com/package/intelliwright',
          label: 'npm',
          position: 'right',
        },
        {
          href: 'https://github.com/neeraj719714/intelliwright',
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
            {label: 'Installation', to: '/docs/getting-started/installation'},
            {label: 'Writing tests', to: '/docs/writing-tests/basics'},
            {label: 'Jev features', to: '/docs/jev/overview'},
          ],
        },
        {
          title: 'Reference',
          items: [
            {label: 'Configuration', to: '/docs/reference/configuration'},
            {label: 'Command line', to: '/docs/reference/cli'},
            {label: 'API', to: '/docs/reference/api'},
          ],
        },
        {
          title: 'More',
          items: [
            {label: 'GitHub', href: 'https://github.com/neeraj719714/intelliwright'},
            {label: 'npm', href: 'https://www.npmjs.com/package/intelliwright'},
            {label: 'Jev by TypeSafe', href: 'https://docs.typesafe.ai/introduction'},
            {label: 'Playwright', href: 'https://playwright.dev'},
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Neeraj. Released under the MIT License.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'json'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
