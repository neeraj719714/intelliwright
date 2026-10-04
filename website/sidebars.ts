import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docs: [
    'intro',
    {
      type: 'category',
      label: 'Getting started',
      collapsed: false,
      items: ['getting-started/installation', 'getting-started/first-test'],
    },
    {
      type: 'category',
      label: 'Writing tests',
      items: [
        'writing-tests/basics',
        'writing-tests/fixtures',
        'writing-tests/page-objects',
        'writing-tests/assertions',
        'writing-tests/signing-in',
      ],
    },
    {
      type: 'category',
      label: 'Jev features',
      items: [
        'jev/overview',
        'jev/assertions',
        'jev/actions',
        'jev/goals',
        'jev/questions',
        'jev/triage',
        'jev/providers',
      ],
    },
    {
      type: 'category',
      label: 'Running tests',
      items: [
        'running-tests/selecting-tests',
        'running-tests/web-server',
        'running-tests/reports',
        'running-tests/ci',
        'running-tests/flaky-tests',
      ],
    },
    'agent-skill',
  ],
  reference: ['reference/configuration', 'reference/cli', 'reference/api'],
};

export default sidebars;
