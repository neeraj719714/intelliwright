import type {ReactNode} from 'react';
import Link from '@docusaurus/Link';
import useBaseUrl from '@docusaurus/useBaseUrl';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import CodeBlock from '@theme/CodeBlock';
import Heading from '@theme/Heading';
import Layout from '@theme/Layout';

import styles from './index.module.css';

const EXAMPLE = `import { expect, test } from "./fixtures";

test("a user can save a note", async ({ page, newNotePage }) => {
  await newNotePage.goto();
  await newNotePage.save("Groceries");

  const heading = page.getByRole("heading", { name: "Groceries" });
  await expect(heading).toBeVisible();
  await expect(page).toSatisfy("the new note is shown with its title");
});`;

interface Feature {
  title: string;
  body: ReactNode;
  to: string;
}

const FEATURES: Feature[] = [
  {
    title: 'Page objects first',
    body: (
      <>
        Locators live in page object classes. <code>intelliwright init</code> scaffolds them, and{' '}
        <code>BasePage</code> gives each one <code>goto()</code> and a ready check.
      </>
    ),
    to: '/docs/writing-tests/page-objects',
  },
  {
    title: 'Plain-English checks',
    body: (
      <>
        <code>toSatisfy("the cart shows 3 items")</code> asks Jev about the page. Every answer is a probability,
        and you choose the threshold.
      </>
    ),
    to: '/docs/jev/assertions',
  },
  {
    title: 'Actions by description',
    body: (
      <>
        <code>ai.click("the Sign in button in the header")</code> picks the element, turns it into a readable
        locator, and caches it so later runs skip Jev.
      </>
    ),
    to: '/docs/jev/actions',
  },
  {
    title: 'Goals that become code',
    body: (
      <>
        <code>ai.run("create an account")</code> works through the page one step at a time, then hands back the
        same flow as fixed Playwright code.
      </>
    ),
    to: '/docs/jev/goals',
  },
  {
    title: 'Failure triage',
    body: (
      <>
        Each failure is labeled as a regression, a test bug, flaky, or the environment, next to the screenshot,
        trace and logs.
      </>
    ),
    to: '/docs/jev/triage',
  },
  {
    title: 'Real browsers, familiar API',
    body: (
      <>
        Chromium, Firefox and WebKit through Playwright, with <code>test</code>, <code>expect</code>, fixtures
        and hooks that work like Playwright Test.
      </>
    ),
    to: '/docs/writing-tests/basics',
  },
];

function Hero(): ReactNode {
  const {siteConfig} = useDocusaurusContext();
  const animatedLogo = useBaseUrl('/img/logo-animated.svg');
  const staticLogo = useBaseUrl('/img/logo.svg');
  return (
    <header className={styles.hero}>
      <div className="container">
        <picture>
          <source srcSet={staticLogo} media="(prefers-reduced-motion: reduce)" />
          <img className={styles.logo} src={animatedLogo} alt="" width={120} height={120} />
        </picture>
        <Heading as="h1" className={styles.title}>
          {siteConfig.title}
        </Heading>
        <p className={styles.tagline}>{siteConfig.tagline}</p>
        <div className={styles.buttons}>
          <Link className="button button--primary button--lg" to="/docs/getting-started/installation">
            Get started
          </Link>
          <Link className="button button--secondary button--lg" to="/docs/intro">
            What is Intelliwright?
          </Link>
        </div>
        <div className={styles.install}>
          <CodeBlock language="bash">npm install --save-dev intelliwright</CodeBlock>
        </div>
      </div>
    </header>
  );
}

export default function Home(): ReactNode {
  return (
    <Layout
      title="End-to-end tests with page objects and Jev"
      description="Intelliwright runs end-to-end tests for web apps in real browsers, with page objects and Jev-powered checks, actions and failure triage.">
      <Hero />
      <main>
        <section className={styles.example}>
          <div className="container">
            <div className={styles.exampleGrid}>
              <div>
                <Heading as="h2">Tests read like what the user does</Heading>
                <p>
                  Page objects hold the locators, fixed assertions wait and retry on their own, and Jev checks the
                  things that are about meaning rather than exact text.
                </p>
                <Link to="/docs/getting-started/first-test">Write your first test →</Link>
              </div>
              <CodeBlock language="ts" title="e2e/notes.e2e.ts">
                {EXAMPLE}
              </CodeBlock>
            </div>
          </div>
        </section>
        <section className={styles.features}>
          <div className="container">
            <div className={styles.featureGrid}>
              {FEATURES.map((feature) => (
                <Link key={feature.title} to={feature.to} className={styles.feature}>
                  <Heading as="h3">{feature.title}</Heading>
                  <p>{feature.body}</p>
                </Link>
              ))}
            </div>
          </div>
        </section>
      </main>
    </Layout>
  );
}
