interface Feature {
  title: string;
  desc: string;
}

const LIVE_FEATURES: Feature[] = [
  {
    title: 'In-browser preview',
    desc: 'Your dev server runs in a WebContainer right next to your code. Hot reload, real npm install, real Vite/Next/Expo, no install on your end.',
  },
  {
    title: 'GitHub native',
    desc: 'Sign in, pick a repo and a branch from a searchable list, edit, push back. Branch switching keeps your env vars and Netlify site intact.',
  },
  {
    title: 'One-click Netlify deploys',
    desc: "Hit Deploy. We build the project, zip the output, and ship it to Netlify with your site id remembered. Per-project — no fishing for the right token.",
  },
  {
    title: 'Cross-device project sync',
    desc: "Sign in from any browser on any device. Your projects, env vars, GitHub and Netlify connections, last-open project — all there waiting.",
  },
  {
    title: 'Tabbed mini-browser preview',
    desc: 'Pop open multiple pages of your app at once. Address bar, reload, in-app navigation links handled — without opening real new browser tabs.',
  },
  {
    title: 'Per-repo env vars',
    desc: "Drop your .env file once, it's saved server-side and auto-injected on every pull. Switch branches without losing them.",
  },
  {
    title: 'Download anywhere',
    desc: "One-click download of the whole project, .env included, ready to npm install and run on any machine.",
  },
  {
    title: 'No terminal required',
    desc: 'Buttons for everything: Run, Stop, Pull, Push, Deploy, Download. The terminal is read-only — there to watch, not to type in.',
  },
];

const COMING_FEATURES: Feature[] = [
  {
    title: 'Local agent mode',
    desc: 'Install a tiny script on your laptop. The studio drives your real local dev environment — real Node, real ports, real native modules — through a secure WebSocket relay. Switch between web mode and laptop mode per project.',
  },
  {
    title: 'Chat with Claude / Codex (your subscription)',
    desc: "A chat panel right in the studio that talks to claude or codex on your machine via the agent. Uses your existing $100/mo Claude Max subscription — no per-token billing, no API key, no surprises.",
  },
  {
    title: 'Mobile app builds — no Mac needed',
    desc: 'Click "Build for iOS" or "Build for Android" on any Expo project. We orchestrate the build through EAS in the cloud. Ship to App Store and Play Store from a Chromebook.',
  },
  {
    title: 'Smart project switcher',
    desc: 'Switching projects auto-stops the old dev server, picks the right Node version, runs install if package.json changed, starts the new dev server, and points the preview at it. One click, several seconds.',
  },
  {
    title: 'Quick actions',
    desc: 'Test, lint, format, type-check, clean, kill-all-processes, sync-with-main — all as buttons. Custom recipes per project.',
  },
];

export default function LandingPage() {
  return (
    <div className="landing">
      <header className="landing-nav">
        <div className="landing-brand">GetXsite.com</div>
        <nav className="landing-nav-links">
          <a href="#features">Features</a>
          <a href="#pricing">Pricing</a>
          <a href="#faq">FAQ</a>
          <a href="/app" className="landing-nav-cta">Sign in</a>
        </nav>
      </header>

      <section className="landing-hero">
        <h1>
          Build, preview, and ship web &amp; mobile apps —
          <span className="landing-accent"> all in one browser tab.</span>
        </h1>
        <p className="landing-subhead">
          GetXsite is an entire dev environment in a browser. Pull from GitHub,
          edit live with hot-reload preview, deploy to Netlify, and ship native
          mobile apps without ever opening a terminal — using your own Claude
          or Codex subscription.
        </p>
        <div className="landing-hero-ctas">
          <a href="/app" className="landing-cta primary">Start building — $8/mo</a>
          <a href="#features" className="landing-cta">See what it does</a>
        </div>
        <div className="landing-hero-fineprint">
          Bring your own Claude Max or ChatGPT subscription · No token billing ·
          Cancel anytime
        </div>
      </section>

      <section className="landing-section" id="features">
        <h2>What's live today</h2>
        <p className="landing-section-sub">
          Sign up and use these right now.
        </p>
        <div className="landing-grid">
          {LIVE_FEATURES.map((f) => (
            <div key={f.title} className="landing-card">
              <div className="landing-card-title">{f.title}</div>
              <div className="landing-card-desc">{f.desc}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="landing-section landing-section-muted" id="coming">
        <h2>Coming soon</h2>
        <p className="landing-section-sub">
          Already in flight. Subscribers get them as they ship — no price
          increase.
        </p>
        <div className="landing-grid">
          {COMING_FEATURES.map((f) => (
            <div key={f.title} className="landing-card">
              <div className="landing-card-tag">soon</div>
              <div className="landing-card-title">{f.title}</div>
              <div className="landing-card-desc">{f.desc}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="landing-section" id="pricing">
        <h2>Pricing</h2>
        <p className="landing-section-sub">
          Simple. One plan. Bring your own AI subscription.
        </p>
        <div className="landing-pricing">
          <div className="landing-price-card">
            <div className="landing-price-name">GetXsite</div>
            <div className="landing-price-amount">
              <span className="landing-price-num">$8</span>
              <span className="landing-price-per">/month</span>
            </div>
            <ul className="landing-price-list">
              <li>Unlimited projects</li>
              <li>In-browser preview &amp; editor</li>
              <li>GitHub sync (private repos OK)</li>
              <li>One-click Netlify deploys</li>
              <li>Cross-device sync</li>
              <li>Local agent mode (when shipped)</li>
              <li>Mobile builds via EAS (when shipped)</li>
              <li>Cancel anytime</li>
            </ul>
            <a href="/app" className="landing-cta primary block">Get started</a>
            <div className="landing-price-fine">
              You bring your own Claude Max ($100/mo) or ChatGPT
              Plus/Pro subscription. We don't charge per token. Ever.
            </div>
          </div>
        </div>
      </section>

      <section className="landing-section landing-section-muted" id="faq">
        <h2>FAQ</h2>
        <div className="landing-faq">
          <details>
            <summary>How is this different from Bolt or Lovable?</summary>
            <p>
              Bolt and Lovable bill you per token — $20+/mo plus
              token usage that adds up fast for active users. We charge a
              flat $8/mo and the AI work runs on <em>your</em> Claude or
              ChatGPT subscription, which you already have. No surprise bills.
            </p>
          </details>
          <details>
            <summary>How is this different from Cursor / VS Code?</summary>
            <p>
              Cursor and VS Code are native apps you install on a single
              machine. GetXsite runs in any browser on any device — and
              still drives a real dev environment, either via WebContainer
              or via a small agent on your laptop.
            </p>
          </details>
          <details>
            <summary>Do I need to know how to use a terminal?</summary>
            <p>
              No. Run, Stop, Pull, Push, Deploy, Download, Build for iOS,
              Build for Android — they're all buttons. The terminal panel
              exists to read logs, not to type commands into.
            </p>
          </details>
          <details>
            <summary>Can I really build iOS apps without a Mac?</summary>
            <p>
              Yes — through EAS (Expo Application Services), the standard
              cloud build pipeline for React Native. We wrap it in a button.
              You get an .ipa download and a "Submit to App Store" link.
              No Xcode, no Mac required. (Coming soon.)
            </p>
          </details>
          <details>
            <summary>Where is my code stored?</summary>
            <p>
              On GitHub. We pull on demand, edit in memory, push back when
              you click Push. Your env vars and project metadata live in
              our Supabase, scoped per user with row-level security.
            </p>
          </details>
          <details>
            <summary>What if I want to leave?</summary>
            <p>
              Click Download — get a zip with everything including your
              .env. Cancel from the billing page. Your code is on GitHub
              the whole time anyway. No lock-in.
            </p>
          </details>
        </div>
      </section>

      <footer className="landing-footer">
        <div>© {new Date().getFullYear()} GetXsite.com</div>
        <div className="landing-footer-links">
          <a href="/app">Sign in</a>
        </div>
      </footer>
    </div>
  );
}
