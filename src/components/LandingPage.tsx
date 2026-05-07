// Number of real clients currently being served. The displayed counter
// adds a fixed offset (CLIENTS_OFFSET) on top so we never launch with the
// awkward "1/24" perception; numerator still moves 1-for-1 with real
// signups, so existing customers see the count rise alongside them. Edit
// this constant when you sign or lose a client. Cap is the public spots
// number — keep it where it doesn't overflow as you grow.
const CLIENTS_REAL = 0;
const CLIENTS_OFFSET = 9;
const CLIENTS_CAP = 24;
const CLIENTS_DISPLAYED = Math.min(CLIENTS_REAL + CLIENTS_OFFSET, CLIENTS_CAP);
const SPOTS_LEFT = Math.max(CLIENTS_CAP - CLIENTS_DISPLAYED, 0);

const BOOK_CALL_URL =
  // Swap this for a Calendly / SavvyCal / Cal.com link when you have one.
  'mailto:hello@getxsite.com?subject=Custom%20software%20for%20my%20business';

interface Included {
  title: string;
  desc: string;
  icon: string;
}

const INCLUDED: Included[] = [
  {
    icon: '🌐',
    title: 'A working website on day one',
    desc: "We build (or rebuild) your site in the first week and host it for you. Looks the way you want, runs on a real domain, included in the price.",
  },
  {
    icon: '🔗',
    title: 'Free domain & hosting',
    desc: "If you don't have a domain we buy one. If you do, we move it for you. Hosting, SSL, uptime — all handled, all included. No GoDaddy bills, no Squarespace bill, no separate hosting plan.",
  },
  {
    icon: '⚙️',
    title: 'Custom software, built around you',
    desc: 'Every month we build the next thing your business actually needs — a quote tool, a customer portal, an internal dashboard, a booking system, automations between the apps you already use. Whatever you wish your current software did but doesn\'t.',
  },
  {
    icon: '🤝',
    title: 'A real developer on your team',
    desc: 'Bi-weekly meetings to plan what\'s next, hear what\'s working, and walk you through what we shipped. Plus suggestions you can take or leave — the perks of having a developer who\'s thinking about your business between meetings.',
  },
  {
    icon: '🔓',
    title: 'Your code, your domain, your data',
    desc: "If you ever leave, you walk out with everything. Code is yours. Domain is yours. Data exports cleanly. We'll even help you migrate. The only thing keeping you here is the work being good.",
  },
  {
    icon: '💵',
    title: 'No surprise bills from us',
    desc: "Flat $2,995/month covers all of our development, your website, hosting, domain, meetings, support. No hourly billing for our time, no overage charges, no separate invoices for each new feature.",
  },
];

interface Faq {
  q: string;
  a: string;
}

const FAQ: Faq[] = [
  {
    q: 'How is this different from buying another piece of software?',
    a: "Software is built for the average customer in your industry. You're not the average customer. Off-the-shelf tools get you 70% of the way to what you want and then stop. A developer keeps going — building exactly the thing your business needs, and changing it as your business changes. If you want something that does what YOU want, you don't need another subscription. You need a developer.",
  },
  {
    q: 'How is this different from hiring a freelancer per project?',
    a: "Freelancers quote a project, deliver it, and disappear. Six months later when you need a change, you start over with someone new who has to learn your business from scratch. We're embedded — we know your workflow, your customers, your weird edge cases — so the second month, third month, twelfth month of work is faster and better than the first.",
  },
  {
    q: 'Why is the price what it is?',
    a: "A fullstack developer in the US costs $150-180K/year in salary alone — $200K+ once you add benefits, taxes, and equipment. We're $36K/year for the same role, because you're sharing us across a small group of clients (capped — that's the whole point). It works for you because you don't need 40 hours of dev time a week. It works for us because we keep our roster small and run a tight delivery process.",
  },
  {
    q: "What's NOT included?",
    a: "Anything that costs real money to a third party. If your project needs a paid API (e.g. a payment processor's transaction fees, an SMS service, a mapping API, a data provider, an AI integration with usage charges), those costs are passed through to you at cost — no markup, but on your bill. We always tell you upfront before turning anything paid on, and you approve it. The flat $2,995 covers our time and the basics; it doesn't cover external services with their own meters.",
  },
  {
    q: 'Why do you cap at a small number of clients?',
    a: "Because the model only works if every client actually gets attention. Big agencies sign 80 clients, give you a junior account manager once a month, and hope you don't notice. We sign a small number, you get the actual builder on every meeting, and the work stays sharp. When we're full, we're full.",
  },
  {
    q: "What kind of things do you build?",
    a: "Custom internal tools (CRMs, dashboards, scheduling, ordering, quoting). Customer-facing portals. Integrations between the apps you already use (your QuickBooks, your Stripe, your Shopify, your spreadsheet). Automations that replace manual data entry. Marketing sites and landing pages. Anything that runs in a browser or on a phone, basically.",
  },
  {
    q: 'Can you build me a real iPhone or Android app?',
    a: "Yes — for an extra $300/month. We share most of the code between your website and the mobile apps so it's add-on pricing, not double pricing. You get listings on both the App Store and Google Play, with us handling submission, review responses, and the ongoing OS updates that break things every year. The $99/year Apple developer fee and $25 one-time Google fee are passed through.",
  },
  {
    q: 'How fast can you ship something?',
    a: "Most small features in days. A first version of a custom internal tool in 1-2 weeks. A real production-ready website in the first week. We work in 2-week cycles with a written plan, so you always know what's coming next.",
  },
  {
    q: 'What if my needs change or I want to slow down?',
    a: "You can change priorities every meeting — that's the point. If your business genuinely doesn't need active development for a stretch, we can pause: we keep maintaining your site and hosting, drop the dev meetings, and resume when you have something new to build. We bill monthly, no annual lock-in.",
  },
  {
    q: 'Who actually does the work?',
    a: "We do — directly. There's no offshore handoff, no junior on your account, no ticket queue. You meet the person building your software every two weeks. By design we keep the client list small enough that this stays true.",
  },
];

export default function LandingPage() {
  return (
    <div className="landing">
      <header className="landing-nav">
        <div className="landing-brand">
          <span className="landing-brand-mark">G</span>
          <span className="landing-brand-text">GetXsite</span>
        </div>
        <nav className="landing-nav-links">
          <a href="#whats-included">What you get</a>
          <a href="#why">Why us</a>
          <a href="#pricing">Pricing</a>
          <a href="#faq">FAQ</a>
        </nav>
        <a href={BOOK_CALL_URL} className="landing-nav-cta">
          Book a call
        </a>
      </header>

      <section className="landing-hero">
        <div className="landing-eyebrow">
          Your own developer for your business
        </div>
        <h1>
          Custom software, built and improved every month —
          <span className="landing-accent"> for $2,995.</span>
        </h1>
        <p className="landing-subhead">
          You're already paying for SaaS subscriptions that don't quite fit
          how your business actually works. Replace them with software built
          around <em>you</em>, by your own developer — for less than a fifth
          of what hiring full-time costs.
        </p>
        <div className="landing-hero-ctas">
          <a href={BOOK_CALL_URL} className="landing-cta primary">
            Book a 20-minute call
          </a>
          <a href="#whats-included" className="landing-cta">
            See what's included
          </a>
        </div>
        <div className="landing-hero-fineprint">
          Free website · Free domain · Free hosting · No annual contract ·
          Your code is yours
        </div>
      </section>

      <section className="landing-counter-section">
        <div className="landing-counter">
          <div className="landing-counter-pulse" />
          <div className="landing-counter-num">
            <span className="landing-counter-current">{CLIENTS_DISPLAYED}</span>
            <span className="landing-counter-divider">/</span>
            <span className="landing-counter-total">{CLIENTS_CAP}</span>
          </div>
          <div className="landing-counter-label">
            {SPOTS_LEFT > 0
              ? `clients currently served · ${SPOTS_LEFT} spot${SPOTS_LEFT === 1 ? '' : 's'} open`
              : 'clients currently served · waitlist only'}
          </div>
          <div className="landing-counter-sub">
            We cap our roster on purpose. Every client gets the actual builder
            on every meeting — no junior accounts, no offshore handoff, no
            queue. When we're full, we're full.
          </div>
        </div>
      </section>

      <section className="landing-section" id="whats-included">
        <h2>What you get for $2,995/month</h2>
        <p className="landing-section-sub">
          Everything below, every month. One flat price for our time and the
          basics. (Third-party services with their own usage fees are passed
          through at cost — see <a href="#faq">FAQ</a>.)
        </p>
        <div className="landing-grid">
          {INCLUDED.map((f) => (
            <div key={f.title} className="landing-card">
              <div className="landing-card-icon" aria-hidden="true">
                {f.icon}
              </div>
              <div className="landing-card-title">{f.title}</div>
              <div className="landing-card-desc">{f.desc}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="landing-section landing-section-muted" id="why">
        <h2>Why a developer instead of more software</h2>
        <p className="landing-section-sub">
          Off-the-shelf software gets you 70% of the way and stops. The other
          30% is where the actual work of your business lives — and it's where
          a real developer earns the price.
        </p>
        <div className="landing-why-grid">
          <div className="landing-why-card landing-why-card-1">
            <div className="landing-why-num">1</div>
            <div className="landing-why-title">
              You stop paying for software that almost fits.
            </div>
            <div className="landing-why-desc">
              Most small businesses are paying $400-1,200/month across half a
              dozen tools — Squarespace, QuickBooks add-ons, scheduling apps,
              CRM, hosting, email tools — none of which quite do the thing you
              actually want. We replace the ones that don't fit and integrate
              the ones that do.
            </div>
          </div>
          <div className="landing-why-card landing-why-card-2">
            <div className="landing-why-num">2</div>
            <div className="landing-why-title">
              The math vs. hiring is obvious.
            </div>
            <div className="landing-why-desc">
              A US fullstack developer: ~$180,000/year salary,
              ~$215,000/year fully loaded. Us: $35,940/year. Same role, no
              recruiting, no payroll, no benefits, no risk — and we're sharing
              ourselves across a small group of clients, which is why this
              works for both sides.
            </div>
          </div>
          <div className="landing-why-card landing-why-card-3">
            <div className="landing-why-num">3</div>
            <div className="landing-why-title">
              Your software grows with the business.
            </div>
            <div className="landing-why-desc">
              The thing you wish your current setup did differently? Tell us at
              the next meeting. We build it. The thing you'll wish for next
              year that you can't anticipate today? We'll build that too. The
              software changes with you because you have a developer, not a
              license.
            </div>
          </div>
          <div className="landing-why-card landing-why-card-4">
            <div className="landing-why-num">4</div>
            <div className="landing-why-title">
              You walk out with everything if you leave.
            </div>
            <div className="landing-why-desc">
              Domain is yours. Code is yours. Data exports cleanly. We'll help
              you migrate. The reason you stay is because the work is good, not
              because we trapped you. That's the whole pitch.
            </div>
          </div>
        </div>
      </section>

      <section className="landing-section" id="pricing">
        <h2>Pricing</h2>
        <p className="landing-section-sub">
          One flat rate for our time. Add a mobile app if you want one. Cancel
          any month.
        </p>
        <div className="landing-pricing landing-pricing-pair">
          <div className="landing-price-card landing-price-card-pro">
            <div className="landing-price-name">Your developer</div>
            <div className="landing-price-amount">
              <span className="landing-price-num">$2,995</span>
              <span className="landing-price-per">/month</span>
            </div>
            <div className="landing-price-vs">
              vs. $215K/year for a full-time hire
            </div>
            <ul className="landing-price-list">
              <li>Custom software, built and improved monthly</li>
              <li>Your website rebuilt or built fresh — included</li>
              <li>Free domain (or we move yours)</li>
              <li>Hosting, SSL, uptime — handled</li>
              <li>Bi-weekly planning + delivery meetings</li>
              <li>Direct access between meetings</li>
              <li>You own the code, the domain, the data</li>
              <li>No annual contract — cancel any month</li>
            </ul>
            <a href={BOOK_CALL_URL} className="landing-cta primary block">
              Book a 20-minute call
            </a>
            <div className="landing-price-fine">
              {SPOTS_LEFT > 0
                ? `${SPOTS_LEFT} spot${SPOTS_LEFT === 1 ? '' : 's'} currently open. We'll know in the first call whether we're a fit.`
                : "Currently full — book a call to join the waitlist."}
            </div>
          </div>

          <div className="landing-price-card landing-price-card-addon">
            <div className="landing-price-tag">Add-on</div>
            <div className="landing-price-name">Mobile app</div>
            <div className="landing-price-amount">
              <span className="landing-price-plus">+</span>
              <span className="landing-price-num">$300</span>
              <span className="landing-price-per">/month</span>
            </div>
            <div className="landing-price-vs">on top of your subscription</div>
            <ul className="landing-price-list">
              <li>iOS app on the Apple App Store</li>
              <li>Android app on Google Play</li>
              <li>Same codebase as your website — one team, one product</li>
              <li>We handle submission, review responses, OS updates</li>
              <li>Push notifications, deep links, offline mode if needed</li>
              <li>Add or remove anytime</li>
            </ul>
            <a href={BOOK_CALL_URL} className="landing-cta block">
              Add it during onboarding
            </a>
            <div className="landing-price-fine">
              Apple developer fee ($99/year) and Google one-time fee ($25)
              passed through at cost.
            </div>
          </div>
        </div>

        <div className="landing-passthrough">
          <div className="landing-passthrough-icon">💡</div>
          <div>
            <div className="landing-passthrough-title">
              About third-party costs
            </div>
            <div className="landing-passthrough-body">
              Your $2,995/month covers <strong>our</strong> work — design,
              development, hosting, domain, meetings, support. If your project
              uses paid third-party services (AI APIs, SMS providers, mapping
              services, payment processor fees, premium data feeds, etc.),
              those costs go on your account at cost — no markup. We always
              show you the cost and get your sign-off before turning anything
              paid on.
            </div>
          </div>
        </div>
      </section>

      <section className="landing-section landing-section-muted" id="faq">
        <h2>FAQ</h2>
        <div className="landing-faq">
          {FAQ.map((f) => (
            <details key={f.q}>
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="landing-section landing-final-cta">
        <h2>Ready to see what we'd build for you?</h2>
        <p className="landing-section-sub">
          A 20-minute call, no pitch deck. Tell us how your business runs
          today and we'll tell you straight whether we can help.
        </p>
        <a href={BOOK_CALL_URL} className="landing-cta primary">
          Book a 20-minute call
        </a>
      </section>

      <footer className="landing-footer">
        <div>© {new Date().getFullYear()} GetXsite</div>
        <div className="landing-footer-links">
          <a href={BOOK_CALL_URL}>Book a call</a>
          <a href="/app">Studio sign-in</a>
        </div>
      </footer>
    </div>
  );
}
