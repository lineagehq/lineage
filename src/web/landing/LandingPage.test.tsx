import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LandingPage } from './LandingPage';
import { heroCarousel, landingMedia } from './landingMedia';

describe('Lineage landing page', () => {
  it('uses the approved messaging and renders the active media slots', () => {
    const html = renderToStaticMarkup(<LandingPage />);

    expect(html).toContain('The UX where humans and agents shape visual work together.');
    expect(html).toContain('Lineage is the shared visual workspace where humans and agents create, review, and evolve creative assets together.');
    expect(html).toContain('Chat is the right UX for directing agent-driven creative work.');
    expect(html).toContain('But it isn’t built to hold the state of that work.');
    expect(html).toContain('One creative state for humans and agents.');
    expect(html).toContain('Lineage preserves every asset, path, prompt, relationship, and decision in a shared record—precise enough for agents to retrieve through the CLI and organized visually for humans to review and direct.');
    expect(html).toContain('Never lose the state behind the work.');
    expect(html).toContain('Every asset, path, prompt, iteration, and relationship stays available so the work can continue accurately.');
    expect(html).toContain('Keep your creative history organized.');
    expect(html).toContain('Review and compare the history, then use selections and annotations to direct the next iteration.');
    expect(html).toContain('Assets + context');
    expect(html).toContain('Selections + annotations');
    expect(html).toContain('A shared creative history you and your agents can build on.');
    expect(html).toContain('Keep every agent attempt tied to your decisions');
    expect(html).toContain('One durable home for visual work made with your agents.');
    expect(html).not.toContain('The agent writes the work into Lineage.');
    expect(html).not.toContain('Not another generation graph.');
    expect((html.match(/<section/g) ?? []).length).toBe(3);

    expect(heroCarousel).toHaveLength(3);
    expect(heroCarousel.map((slide) => slide.title)).toEqual([
      'Turn agent output into visual creative history.',
      'Keep the reasoning behind the visual work.',
      'Humans and agents continue from the same place.',
    ]);
    expect(heroCarousel[2]?.src).not.toBe(landingMedia['agent-to-canvas'].src);
    expect(heroCarousel[2]?.poster).not.toBe(landingMedia['agent-to-canvas'].poster);
    expect(html).not.toContain('Human chooses the next move');

    for (const id of ['agent-to-canvas', 'human-to-agent', 'trace-tree', 'selection-still', 'reroll-history'] as const) {
      expect(landingMedia[id]).toBeDefined();
      expect(html).toContain(`data-media-slot="${id}"`);
    }
    expect(html).toContain('data-media-slot="hero-lineage-growth"');
    expect(html).toContain('hero-carousel-media-viewport');
    expect(html).toContain('hero-carousel-caption-viewport');
    expect(html).toContain('Previous carousel slide');
    expect(html).toContain('Next carousel slide');
    expect(html).toContain('Pause carousel rotation');
    expect(html).toContain('carousel-autoplay-toggle');
    expect((html.match(/class="video-toggle"/g) ?? []).length).toBe(4);
    expect(html).toContain('Play Turn agent output into visual creative history.');
    expect(html).toContain('Play Bring agent results back into the shared state.');
  });

  it('links to the public repository and exposes the documented install command', () => {
    const html = renderToStaticMarkup(<LandingPage />);

    expect(html).toContain('https://github.com/lineagehq/lineage');
    expect(html).toContain('npm install -g @mean-weasel/lineage@latest');
    expect(html).toContain('lineage-channel install stable');
    expect(html).toContain('lineage-stable runtime doctor --json');
    expect(html).toContain('lineage-stable profile init --profile team-production --confirm-write --json');
    expect(html).toContain('lineage-stable profile doctor --profile team-production --json');
    expect(html).toContain('lineage-stable db info --profile team-production --json');
    expect(html).toContain('lineage-stable start --profile team-production');
    expect(html).toContain('Copy first-run commands');
    expect(html).toContain('https://github.com/lineagehq/lineage#first-run');
    expect(html).toContain('Documentation');
    expect(html).toContain('href="/docs/"');
    expect(html).toContain('Browse Lineage documentation');
    expect(html.match(/&amp;&amp;/g)).toHaveLength(7);
  });

  it('keeps every first-run command visible without horizontal scrolling', () => {
    const css = readFileSync(fileURLToPath(new URL('./landing.css', import.meta.url)), 'utf8');

    expect(css).toContain('white-space: pre-wrap');
    expect(css).toContain('overflow-wrap: anywhere');
    expect(css).not.toContain('.install-command pre { overflow-x: auto;');
  });
});
