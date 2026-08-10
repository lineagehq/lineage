import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowDownRight,
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  GitBranch,
  MousePointer2,
  Pause,
  Play,
  RefreshCcw,
} from 'lucide-react';
import { heroCarousel, landingMedia, type LandingMediaDefinition } from './landingMedia';

const installCommand = [
  'npm install -g @mean-weasel/lineage@latest',
  'lineage-channel install stable',
  'lineage-stable runtime doctor --json',
  'lineage-stable profile init --profile team-production --confirm-write --json',
  'lineage-stable runtime doctor --json',
  'lineage-stable profile doctor --profile team-production --json',
  'lineage-stable db info --profile team-production --json',
  'lineage-stable start --profile team-production',
].join(' &&\n');
const documentationHref = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/docs/`;

export function LandingPage() {
  const [copied, setCopied] = useState(false);

  async function copyInstallCommand() {
    try {
      await navigator.clipboard.writeText(installCommand);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="landing-shell">
      <header className="landing-nav">
        <a aria-label="Lineage home" className="landing-brand" href="#top">
          <span aria-hidden="true" className="landing-brand-mark">
            <span />
            <span />
            <span />
          </span>
          <span>LINEAGE</span>
        </a>
        <nav aria-label="Landing page">
          <a href="#loop">How it works</a>
          <a href="#features">What it enables</a>
          <a href={documentationHref}>Documentation</a>
          <a href="#install">Install</a>
        </nav>
        <a className="nav-cta" href="https://github.com/lineagehq/lineage" rel="noreferrer" target="_blank">
          View on GitHub <ArrowDownRight aria-hidden="true" size={16} />
        </a>
      </header>

      <main id="top">
        <section className="hero-section">
          <div className="hero-grid" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </div>
          <div className="hero-copy">
            <p className="section-index"><span>01</span> Human × agent creative work</p>
            <h1>The UX where humans and agents shape visual work together.</h1>
            <p className="hero-summary">
              Lineage is the shared visual workspace where humans and agents create, review, and evolve creative assets together.
            </p>
            <div className="hero-actions">
              <a className="primary-cta" href="#loop">
                See the collaboration loop <ArrowRight aria-hidden="true" size={18} />
              </a>
              <a className="text-cta" href="#install">Install Lineage</a>
            </div>
          </div>
          <div className="hero-media-wrap">
            <HeroCarousel />
          </div>
        </section>

        <section className="loop-section" id="loop">
          <div className="loop-heading">
            <p className="section-index"><span>02</span> Context travels both ways</p>
            <h2>One creative state for humans and agents.</h2>
            <div className="loop-copy">
              <p className="loop-problem">Chat is the right UX for directing agent-driven creative work. But it isn’t built to hold the state of that work.</p>
              <p>Lineage preserves every asset, path, prompt, relationship, and decision in a shared record—precise enough for agents to retrieve through the CLI and organized visually for humans to review and direct.</p>
            </div>
          </div>

          <div className="interface-grid">
            <article className="interface-card agent-card">
              <div className="interface-number">A</div>
              <div>
                <p className="card-eyebrow">For agents</p>
                <h3>Never lose the state behind the work.</h3>
                <p>Every asset, path, prompt, iteration, and relationship stays available so the work can continue accurately.</p>
              </div>
              <MediaSlot definition={landingMedia['agent-to-canvas']} showCaption />
            </article>

            <div className="loop-bridge" aria-label="Assets, context, selections, and annotations move through one creative state">
              <span>Assets + context</span>
              <div className="bridge-line"><ArrowRight aria-hidden="true" size={18} /></div>
              <strong>ONE CREATIVE<br />STATE</strong>
              <div className="bridge-line reverse"><ArrowRight aria-hidden="true" size={18} /></div>
              <span>Selections + annotations</span>
            </div>

            <article className="interface-card human-card">
              <div className="interface-number">H</div>
              <div>
                <p className="card-eyebrow">For humans</p>
                <h3>Keep your creative history organized.</h3>
                <p>Review and compare the history, then use selections and annotations to direct the next iteration.</p>
              </div>
              <MediaSlot definition={landingMedia['human-to-agent']} showCaption />
            </article>
          </div>
        </section>

        <section className="features-section" id="features">
          <div className="features-heading">
            <p className="section-index"><span>03</span> What it enables</p>
            <h2>A shared creative history you and your agents can build on.</h2>
            <p>Keep the useful context behind every asset available, understandable, and ready for the next human or agent action.</p>
          </div>

          <div className="feature-grid">
            <Feature icon={<GitBranch />} media={landingMedia['trace-tree']} number="01" title="Trace every iteration">
              Follow an asset from its origin through branches, selections, and final campaign formats.
            </Feature>
            <Feature icon={<MousePointer2 />} media={landingMedia['selection-still']} number="02" title="Continue from the exact asset">
              Select any useful point in the lineage and bring that context into the next agent session.
            </Feature>
            <Feature icon={<RefreshCcw />} media={landingMedia['reroll-history']} number="03" title="Keep every agent attempt tied to your decisions">
              Review another pass without losing earlier results, prompts, relationships, or human direction.
            </Feature>
          </div>

          <div className="final-cta" id="install">
            <div>
              <p className="section-index"><span>→</span> Local-first and agent-ready</p>
              <h3>One durable home for visual work made with your agents.</h3>
            </div>
            <div className="install-panel">
              <div className="install-command">
                <span aria-hidden="true">$</span>
                <pre><code>{installCommand}</code></pre>
                <button aria-label="Copy first-run commands" onClick={() => void copyInstallCommand()} type="button">
                  {copied ? <Check aria-hidden="true" size={18} /> : <Copy aria-hidden="true" size={18} />}
                  {copied ? 'Copied' : 'Copy first-run commands'}
                </button>
              </div>
              <a className="install-guide-link" href="https://github.com/lineagehq/lineage#first-run" rel="noreferrer" target="_blank">
                Read the complete first-run guide <ArrowDownRight aria-hidden="true" size={15} />
              </a>
              <a className="install-guide-link" href={documentationHref}>
                Browse Lineage documentation <ArrowDownRight aria-hidden="true" size={15} />
              </a>
              <div className="install-meta">
                <span>Local-first</span>
                <span>MIT licensed</span>
                <span>Codex plugin</span>
                <span>CLI access</span>
              </div>
              <a className="primary-cta dark" href="https://github.com/lineagehq/lineage" rel="noreferrer" target="_blank">
                Explore Lineage on GitHub <ArrowDownRight aria-hidden="true" size={18} />
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer>
        <a className="landing-brand" href="#top">
          <span aria-hidden="true" className="landing-brand-mark"><span /><span /><span /></span>
          <span>LINEAGE</span>
        </a>
        <p>The shared visual workspace for humans and agents.</p>
        <a href="https://github.com/lineagehq/lineage" rel="noreferrer" target="_blank">GitHub <ArrowDownRight aria-hidden="true" size={14} /></a>
      </footer>
    </div>
  );
}

function HeroCarousel() {
  const carouselRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isAutoPlaying, setIsAutoPlaying] = useState(true);
  const [isHovered, setIsHovered] = useState(false);
  const [hasFocusWithin, setHasFocusWithin] = useState(false);
  const [isCarouselInView, setIsCarouselInView] = useState(false);
  const [isPageVisible, setIsPageVisible] = useState(() => (
    typeof document === 'undefined' || document.visibilityState === 'visible'
  ));
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [transition, setTransition] = useState<{
    direction: -1 | 1;
    fromIndex: number;
    initiatedBy: 'automatic' | 'manual';
  } | null>(null);
  const activeSlide = heroCarousel[activeIndex];
  const outgoingSlide = transition ? heroCarousel[transition.fromIndex] : null;
  const transitionDirection = transition?.direction === 1 ? 'next' : 'previous';
  const isRotationActive = isAutoPlaying
    && !isHovered
    && !hasFocusWithin
    && isCarouselInView
    && isPageVisible
    && !prefersReducedMotion
    && !transition;

  useEffect(() => {
    const carousel = carouselRef.current;
    if (!carousel) return;

    if (!('IntersectionObserver' in window)) {
      setIsCarouselInView(true);
      return;
    }

    const observer = new IntersectionObserver(([entry]) => {
      setIsCarouselInView(Boolean(entry && entry.intersectionRatio >= 0.35));
    }, { threshold: 0.35 });

    observer.observe(carousel);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updateMotionPreference = () => setPrefersReducedMotion(motionPreference.matches);

    updateMotionPreference();
    motionPreference.addEventListener('change', updateMotionPreference);
    return () => motionPreference.removeEventListener('change', updateMotionPreference);
  }, []);

  useEffect(() => {
    const updatePageVisibility = () => setIsPageVisible(document.visibilityState === 'visible');

    document.addEventListener('visibilitychange', updatePageVisibility);
    return () => document.removeEventListener('visibilitychange', updatePageVisibility);
  }, []);

  useEffect(() => {
    if (!isRotationActive) return;

    const rotationTimer = window.setTimeout(() => {
      setTransition({ direction: 1, fromIndex: activeIndex, initiatedBy: 'automatic' });
      setActiveIndex((activeIndex + 1) % heroCarousel.length);
    }, 15_000);

    return () => window.clearTimeout(rotationTimer);
  }, [activeIndex, isRotationActive]);

  useEffect(() => {
    if (!transition) return;

    const fallback = window.setTimeout(() => setTransition(null), 700);
    return () => window.clearTimeout(fallback);
  }, [transition]);

  function moveSlide(direction: -1 | 1) {
    showSlide((activeIndex + direction + heroCarousel.length) % heroCarousel.length, direction);
  }

  function showSlide(nextIndex: number, direction: -1 | 1) {
    if (transition || nextIndex === activeIndex) return;

    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setActiveIndex(nextIndex);
      return;
    }

    setTransition({ direction, fromIndex: activeIndex, initiatedBy: 'manual' });
    setActiveIndex(nextIndex);
  }

  return (
    <div
      aria-label="Lineage product tour"
      aria-roledescription="carousel"
      className="hero-carousel"
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setHasFocusWithin(false);
      }}
      onFocusCapture={() => setHasFocusWithin(true)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'ArrowLeft') moveSlide(-1);
        if (event.key === 'ArrowRight') moveSlide(1);
      }}
      role="region"
      ref={carouselRef}
      tabIndex={0}
    >
      <div className="hero-carousel-media-viewport">
        <div
          className={`hero-carousel-media-track ${transition ? `carousel-track-${transitionDirection}` : ''}`}
          onAnimationEnd={(event) => {
            if (event.currentTarget === event.target) setTransition(null);
          }}
        >
          {transition?.direction === -1 && (
            <div className="hero-carousel-media-slide" key={activeSlide.id}>
              <MediaSlot definition={activeSlide} hero />
            </div>
          )}
          <div
            aria-hidden={outgoingSlide ? 'true' : undefined}
            className="hero-carousel-media-slide"
            key={(outgoingSlide ?? activeSlide).id}
          >
            <MediaSlot
              definition={outgoingSlide ?? activeSlide}
              hero
              showPlaybackControl={!outgoingSlide}
            />
          </div>
          {transition?.direction === 1 && (
            <div className="hero-carousel-media-slide" key={activeSlide.id}>
              <MediaSlot definition={activeSlide} hero />
            </div>
          )}
        </div>
      </div>
      <div
        aria-live={isRotationActive || transition?.initiatedBy === 'automatic' ? 'off' : 'polite'}
        className="hero-carousel-caption-viewport"
      >
        {outgoingSlide && (
          <div
            aria-hidden="true"
            className={`hero-carousel-caption carousel-caption-exit carousel-${transitionDirection}`}
            key={outgoingSlide.id}
          >
            <span className="media-eyebrow">{outgoingSlide.eyebrow}</span>
            <strong>{outgoingSlide.title}</strong>
            <small>{outgoingSlide.description}</small>
          </div>
        )}
        <div
          className={`hero-carousel-caption ${transition ? `carousel-caption-enter carousel-${transitionDirection}` : ''}`}
          key={activeSlide.id}
        >
          <span className="media-eyebrow">{activeSlide.eyebrow}</span>
          <strong>{activeSlide.title}</strong>
          <small>{activeSlide.description}</small>
        </div>
      </div>
      <div className="hero-carousel-controls">
        <button aria-label="Previous carousel slide" onClick={() => moveSlide(-1)} type="button">
          <ChevronLeft aria-hidden="true" size={19} />
        </button>
        <div className="carousel-center-controls">
          <button
            aria-label={isAutoPlaying ? 'Pause carousel rotation' : 'Resume carousel rotation'}
            className="carousel-autoplay-toggle"
            onClick={() => setIsAutoPlaying((isPlaying) => !isPlaying)}
            type="button"
          >
            {isAutoPlaying
              ? <Pause aria-hidden="true" size={13} />
              : <Play aria-hidden="true" size={13} />}
          </button>
          <div aria-label={`Slide ${activeIndex + 1} of ${heroCarousel.length}`} className="carousel-progress">
            {heroCarousel.map((slide, index) => (
              <button
                aria-current={index === activeIndex ? 'true' : undefined}
                aria-label={`Show slide ${index + 1}: ${slide.title}`}
                className={index === activeIndex ? 'active' : ''}
                key={slide.id}
                onClick={() => showSlide(index, index > activeIndex ? 1 : -1)}
                type="button"
              />
            ))}
          </div>
        </div>
        <button aria-label="Next carousel slide" onClick={() => moveSlide(1)} type="button">
          <ChevronRight aria-hidden="true" size={19} />
        </button>
      </div>
    </div>
  );
}

function MediaSlot({
  definition,
  hero = false,
  showCaption = false,
  showPlaybackControl = true,
}: {
  definition: LandingMediaDefinition;
  hero?: boolean;
  showCaption?: boolean;
  showPlaybackControl?: boolean;
}) {
  const fitClass = `media-fit-${definition.fit ?? 'cover'}`;
  const positionClass = definition.position === 'left' ? 'media-position-left' : '';

  return (
    <figure
      className={`media-slot media-slot-ready ${fitClass} ${positionClass} ${hero ? 'media-slot-hero' : ''}`}
      data-media-slot={definition.id}
    >
      {definition.kind === 'video' ? (
        <>
          <ViewportVideo definition={definition} showPlaybackControl={showPlaybackControl} />
          {definition.poster && <img alt="" aria-hidden="true" className="reduced-motion-poster" src={definition.poster} />}
        </>
      ) : (
        <img alt={definition.description} loading="lazy" src={definition.src} />
      )}
      {showCaption && (
        <figcaption aria-live={hero ? 'polite' : undefined}>
          <span className="media-eyebrow">{definition.eyebrow}</span>
          <strong>{definition.title}</strong>
          <small>{definition.description}</small>
        </figcaption>
      )}
    </figure>
  );
}

function ViewportVideo({
  definition,
  showPlaybackControl,
}: {
  definition: LandingMediaDefinition;
  showPlaybackControl: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [pausedByUser, setPausedByUser] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    if (pausedByUser) {
      video.pause();
      return;
    }

    if (!('IntersectionObserver' in window)) {
      void video.play().catch(() => undefined);
      return;
    }

    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) {
        void video.play().catch(() => undefined);
      } else {
        video.pause();
      }
    }, { threshold: 0.45 });

    observer.observe(video);
    return () => {
      observer.disconnect();
      video.pause();
    };
  }, [definition.src, pausedByUser]);

  function togglePlayback() {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      setPausedByUser(false);
      void video.play().catch(() => undefined);
    } else {
      setPausedByUser(true);
      video.pause();
    }
  }

  return (
    <>
      <video
        aria-label={definition.description}
        loop
        muted
        onPause={() => setIsPlaying(false)}
        onPlay={() => setIsPlaying(true)}
        playsInline
        poster={definition.poster}
        preload="metadata"
        ref={videoRef}
        src={definition.src}
      />
      {showPlaybackControl && (
        <button
          aria-label={`${isPlaying ? 'Pause' : 'Play'} ${definition.title}`}
          className="video-toggle"
          onClick={togglePlayback}
          type="button"
        >
          {isPlaying ? <Pause aria-hidden="true" size={16} /> : <Play aria-hidden="true" fill="currentColor" size={16} />}
        </button>
      )}
    </>
  );
}

function Feature({
  children,
  icon,
  media,
  number,
  title,
}: {
  children: string;
  icon: ReactNode;
  media: LandingMediaDefinition;
  number: string;
  title: string;
}) {
  return (
    <article className="feature-card">
      <div className="feature-top"><span>{number}</span>{icon}</div>
      <h3>{title}</h3>
      <p>{children}</p>
      <div className="feature-media"><MediaSlot definition={media} /></div>
    </article>
  );
}
