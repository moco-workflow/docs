import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

/**
 * Creating a sidebar enables you to:
 - create an ordered group of docs
 - render a sidebar for each doc of that group
 - provide next/previous navigation

 The sidebars can be generated from the filesystem, or explicitly defined here.

 Create as many sidebars as you want.
 */
const sidebars: SidebarsConfig = {
  // By default, Docusaurus generates a sidebar from the docs folder structure
  tutorialSidebar: [
    {
      type: 'category',
      label: 'Introduction',
      items: ['intro', 'quick-start'],
    },
    {
      type: 'category',
      label: 'Core Concepts',
      items: [
        'concepts/overview',
        'concepts/dual-runtime',
        'concepts/workflowspec',
        'concepts/expressions',
        'concepts/activities',
        'concepts/rules-engine',
        'concepts/state-machines',
        'concepts/events',
        'concepts/child-workflows',
        'concepts/how-to-run-workflow',
        'concepts/release-and-sharing',
      ],
    },
    {
      type: 'category',
      label: 'Reference',
      items: [
        'reference/workflowspec-reference',
        'reference/statements',
        {
          type: 'category',
          label: 'Activity Catalog',
          link: {type: 'doc', id: 'reference/activity-catalog'},
          // Ordered by how often they are reached for, not alphabetically.
          items: [
            'reference/activities/http',
            'reference/activities/shell',
            'reference/activities/sql',
            'reference/activities/email',
            'reference/activities/builtin-core',
            'reference/activities/state',
            'reference/activities/secret',
            'reference/activities/event',
            'reference/activities/schedule',
            'reference/activities/openai',
            'reference/activities/claude-agent',
            'reference/activities/llama-index',
            'reference/activities/langfuse',
            'reference/activities/typesafe',
            'reference/activities/gdrive',
            'reference/activities/k8s',
            'reference/activities/kafka',
            'reference/activities/rabbit',
            'reference/activities/graphql',
            'reference/activities/websocket',
            'reference/activities/mcp',
            'reference/activities/playwright',
            'reference/activities/selenium',
            'reference/activities/authz',
            'reference/activities/deploy',
          ],
        },
      ],
    },
    {
      type: 'category',
      label: 'Guides',
      items: [
        'guides/use-moco-cli',
        'guides/writing-workflows',
        'guides/testing',
        'guides/run-moco-workflow-through-api',
        'guides/scheduling-workflows',
        'guides/kubernetes-deployment',
      ],
    },
  ],
};

export default sidebars;
