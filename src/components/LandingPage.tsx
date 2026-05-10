import { useRef } from 'react';

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
    desc: "If you don't have a domain, we buy one. If you do, we move it for you. Hosting, SSL, and uptime are all handled and all included. No GoDaddy bills, no Squarespace subscription, no separate hosting plan.",
  },
  {
    icon: '⚙️',
    title: 'Custom software, built around you',
    desc: "Every month we build the next thing your business actually needs: a quote tool, a customer portal, an internal dashboard, a booking system, automations between the apps you already use. Whatever you wish your current software did but doesn't.",
  },
  {
    icon: '🤝',
    title: 'A real developer on your team',
    desc: "Bi-weekly meetings to plan what's next, hear what's working, and walk you through what we shipped. Plus suggestions you can take or leave: the perks of having a developer who's thinking about your business between meetings.",
  },
  {
    icon: '🔓',
    title: 'Your code, your domain, your data',
    desc: "If you ever leave, you walk out with everything. Code is yours. Domain is yours. Data exports cleanly. We'll even help you migrate. The only thing keeping you here is the work being good.",
  },
  {
    icon: '💵',
    title: 'No surprise bills from us',
    desc: "A flat monthly covers all of our development, your website, hosting, domain, meetings, and support. No hourly billing for our time, no overage charges, no separate invoices for each new feature.",
  },
];

interface Faq {
  q: string;
  a: string;
}

const FAQ: Faq[] = [
  {
    q: 'How is this different from buying another piece of software?',
    a: "Software is built for the average customer in your industry. You are not the average customer. Off-the-shelf tools get you about 70 percent of the way to what you want and then stop. A developer keeps going, building exactly the thing your business needs, and changing it as your business changes. If you want something that does what you want, you don't need another subscription. You need a developer.",
  },
  {
    q: 'How is this different from hiring a freelancer per project?',
    a: "Freelancers quote a project, deliver it, and move on. Six months later when you need a change, you start over with someone new who has to learn your business from scratch. We are embedded. We know your workflow, your customers, and your edge cases, so the second month, third month, and twelfth month of work is faster and better than the first.",
  },
  {
    q: 'Why is the price what it is?',
    a: "A US fullstack developer costs $150,000 to $180,000 a year in salary alone, and $200,000 or more once you add benefits, taxes, and equipment. The base service here is roughly $12,000 a year, because we share ourselves across a small group of clients on purpose. It works for you because you don't need 40 hours of dev time a week. It works for us because we keep the roster small and run a tight delivery process.",
  },
  {
    q: 'Why do you keep the client list small?',
    a: "Because the model only works if every client actually gets attention. Larger agencies sign as many clients as they can, hand you a junior account manager, and hope you don't notice. We keep the list small so you get the actual builder on every meeting and the work stays sharp. It also means we can keep the customers we already have happy, which matters more to us than growing fast.",
  },
  {
    q: "What's NOT included?",
    a: "Anything that costs real money to a third party. If your project needs a paid API (a payment processor's transaction fees, an SMS service, a mapping API, a data provider, an AI integration with usage charges, etc.), those costs are passed through to you at cost, with no markup, on your account. We always tell you upfront before turning anything paid on, and you approve it. Our subscription covers our time and the basics. It doesn't cover external services with their own meters.",
  },
  {
    q: "What kind of things do you build?",
    a: "Custom internal tools (CRMs, dashboards, scheduling, ordering, quoting, dispatch, payroll). Customer-facing portals. Integrations between the apps you already use (QuickBooks, Stripe, Shopify, the spreadsheet your team has been living in for years). Automations that replace manual data entry. Marketing sites and landing pages. Industry-specific things like patient care reports, route optimization, inventory tied to job sheets. Basically anything that runs in a browser or on a phone.",
  },
  {
    q: 'Can you build me a real iPhone or Android app?',
    a: "Yes. The mobile app is an add-on to the base service: a one-time additional $1,000 on setup ($2,995 total) and an extra $299 a month on top of the $999 base ($1,298 a month total). We share most of the code between your website and the apps, so it's add-on pricing, not double pricing. You get listings on both the App Store and Google Play. We handle submission, review responses, and the ongoing OS updates that break things every year. Apple's $99 a year and Google's $25 one-time developer fees are passed through.",
  },
  {
    q: "Can I get just the mobile app without a website?",
    a: "The mobile app is an add-on to the base service, not a standalone product. Even if you don't want a website, you're on the $1,298 monthly because the base service is what we build and maintain the app from. The base service still includes everything else (hosting, domain, ongoing development, meetings) just without a public website if you don't need one.",
  },
  {
    q: 'How fast can you ship something?',
    a: "Most small features in days. A first version of a custom internal tool in one to two weeks. A real production-ready website in the first week. We work in two-week cycles with a written plan, so you always know what's coming next.",
  },
  {
    q: 'What if my needs change or I want to slow down?',
    a: "You can change priorities every meeting. That is the point. If your business genuinely doesn't need active development for a stretch, we can pause: we keep maintaining your site and hosting, drop the dev meetings, and resume when you have something new to build. We bill monthly, with no annual lock-in.",
  },
  {
    q: 'Who actually does the work?',
    a: "We do, directly. There is no offshore handoff, no junior on your account, no ticket queue. You meet the person building your software every two weeks. By design we keep the client list small enough that this stays true.",
  },
];

interface Review {
  name: string;
  position: string;
  industry: string;
  stars: 4 | 5;
  quote: string;
}

const REVIEWS: Review[] = [
  {
    name: 'Sarah M.',
    position: 'Owner',
    industry: 'Dental practice',
    stars: 5,
    quote:
      "We came in wanting a better patient intake form. The one in our practice management software is awful and we'd been hearing about it from patients for years. About ten minutes into our first meeting, Michael asked how we handled insurance verification. I told him my front desk was on the phone half of every morning calling carriers and re-typing the same information into our system. He paused, then said he thought he could fix it. He built a tool that takes the data from intake, talks to the carriers, and pre-fills our verification screens. We didn't even know to ask for it. It saves us roughly fifteen hours a week. The intake form is great, but that other piece was the real surprise.",
  },
  {
    name: 'Carlos R.',
    position: 'President',
    industry: 'HVAC & air services',
    stars: 5,
    quote:
      "We hired them for a quote tool. The quote tool is solid. The bigger surprise was Luke. Every monthly check-in, he would point out something about our pricing structure or our follow-up process that we had been doing the same way for twelve years. I joked once that he should be charging us extra for the advice. He laughed and said it was part of the deal. Our close rate on quotes went from 35 percent to 58 percent over five months. Some of that is the new tool. A lot of it is what Luke pointed out. We basically got an unexpected business consultant at no extra charge.",
  },
  {
    name: 'Marcus W.',
    position: 'Owner',
    industry: 'Private medical transport',
    stars: 5,
    quote:
      "I called them for a website. That was the entire reason I reached out. Eighteen months later we run our dispatch, billing, payroll, scheduling, inventory, and our patient care reports out of one system they built around how we actually work. The PCR module replaced two pieces of software we were paying for and a process the crews hated. We are saving somewhere north of three thousand dollars a month on cancelled subscriptions, and probably twice that in time my back office used to spend reconciling between systems. None of this was on my list when I signed up. Every couple of months they would say, you know what would be easier, and they were right every time. We came for a website. We stayed because they kept building the rest of our business.",
  },
  {
    name: 'James K.',
    position: 'General Manager',
    industry: 'Local restaurant group',
    stars: 5,
    quote:
      "We were paying for three separate tools. Online ordering, a loyalty program, and an email service. None of them talked to each other, so when a customer ordered online, the loyalty side had no record of them. They rebuilt all three as one system on our domain and connected it to our POS. Customer information now lives in one place. We dropped about four hundred dollars a month in subscriptions the day we switched over. They also reach out before our slow season every year. That kind of attention is unusual. Most vendors just send invoices and stay quiet otherwise.",
  },
  {
    name: 'Diana T.',
    position: 'Co-owner',
    industry: 'Real estate brokerage',
    stars: 4,
    quote:
      "I do not hand out five-star reviews easily, but their work is excellent. The custom listing dashboard and lead capture system they built has already paid for itself. Their check-ins are consistent without being pushy. My one complaint, and it is genuinely petty, is that we meet bi-weekly and I sometimes have a backlog of items between meetings. They offered weekly. Our schedule could not accommodate it. That is on us, not them. Five stars on the work. One off because I am impatient.",
  },
  {
    name: 'Rebecca H.',
    position: 'Office Manager',
    industry: 'Veterinary clinic',
    stars: 5,
    quote:
      "We are a small clinic. Three veterinarians and a front desk. Vaccination reminders used to come from a spreadsheet I maintained on top of my regular work. They are now automated, branded to the clinic, and they follow up automatically if a client does not book within two weeks of getting one. The whole thing was running in under a month. Once a month we review which reminders are working and which need new wording. It feels like having a tech person on staff, which we never could have afforded otherwise. What surprised me was how well they understand our practice. Not in a generic way.",
  },
  {
    name: 'Tony D.',
    position: 'Owner',
    industry: 'Plumbing & drain',
    stars: 5,
    quote:
      "I was skeptical going in. We hired an agency two years ago and paid fifteen thousand dollars for a website I ended up rebuilding myself. Luke called and didn't pitch anything for the first twenty minutes. He asked about my crew, my customers, and my dispatch, and said he'd tell me straight if we weren't a fit. I respected that. Eight months in, we've replaced our scheduling software, our invoicing, and our review request system. It's all one product on our own domain now. Michael shows me what he built every two weeks and asks what's next. I don't know how he keeps everything straight. I've sent three other contractors his way already.",
  },
];

export default function LandingPage() {
  const reviewsScrollRef = useRef<HTMLDivElement>(null);

  // Scroll the review row by ~one card width. We measure the first card's
  // width so we don't have to keep the value in sync with the CSS.
  const scrollReviews = (direction: 'left' | 'right') => {
    const el = reviewsScrollRef.current;
    if (!el) return;
    const card = el.querySelector<HTMLElement>('.landing-review-card');
    const step = (card?.offsetWidth ?? 360) + 20; // gap is 20px
    el.scrollBy({
      left: direction === 'right' ? step : -step,
      behavior: 'smooth',
    });
  };

  return (
    <div className="landing">
      <header className="landing-nav">
        <div className="landing-brand">
          <span className="landing-brand-mark">G</span>
          <span className="landing-brand-text">GetXsite</span>
        </div>
        <nav className="landing-nav-links">
          <a href="#whats-included">What you get</a>
          <a href="#reviews">Reviews</a>
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
          Custom software, built and improved every month,
          <span className="landing-accent"> from $999.</span>
        </h1>
        <p className="landing-subhead">
          You&apos;re already paying for SaaS subscriptions that don&apos;t quite
          fit how your business actually works. Replace them with software built
          around <em>you</em>, by your own developer, for a fraction of what
          hiring full-time costs.
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

      <section className="landing-section" id="whats-included">
        <h2>What you get</h2>
        <p className="landing-section-sub">
          Everything below, every month. One flat price for our time and the
          basics. (Third-party services with their own usage fees are passed
          through at cost. See the <a href="#faq">FAQ</a>.)
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

      <section className="landing-section landing-reviews-section" id="reviews">
        <h2>What our clients say</h2>
        <p className="landing-section-sub">
          Real businesses, real outcomes. Working with Michael (development)
          and Luke (everything else).
        </p>
        <div className="landing-reviews-wrap">
          <button
            type="button"
            className="landing-reviews-arrow left"
            onClick={() => scrollReviews('left')}
            aria-label="Previous reviews"
          >
            ‹
          </button>
          <button
            type="button"
            className="landing-reviews-arrow right"
            onClick={() => scrollReviews('right')}
            aria-label="More reviews"
          >
            ›
          </button>
          <div className="landing-reviews-grid" ref={reviewsScrollRef}>
            {REVIEWS.map((r) => (
            <div key={r.name + r.industry} className="landing-review-card">
              <div className="landing-review-stars" aria-label={`${r.stars} out of 5 stars`}>
                {Array.from({ length: 5 }).map((_, i) => (
                  <span
                    key={i}
                    className={
                      i < r.stars
                        ? 'landing-review-star on'
                        : 'landing-review-star off'
                    }
                    aria-hidden="true"
                  >
                    ★
                  </span>
                ))}
              </div>
              <blockquote className="landing-review-quote">
                {r.quote}
              </blockquote>
              <div className="landing-review-author">
                <div className="landing-review-avatar" aria-hidden="true">
                  {r.name.charAt(0)}
                </div>
                <div>
                  <div className="landing-review-name">{r.name}</div>
                  <div className="landing-review-meta">
                    {r.position} · {r.industry}
                  </div>
                </div>
              </div>
            </div>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-section landing-section-muted" id="why">
        <h2>Why a developer instead of more software</h2>
        <p className="landing-section-sub">
          Off-the-shelf software gets you 70% of the way and stops. The other
          30% is where the actual work of your business lives, and it's where
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
              dozen tools (Squarespace, QuickBooks add-ons, scheduling apps,
              CRM, hosting, email tools), none of which quite do the thing you
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
              A US fullstack developer: about $180,000 a year in salary,
              roughly $215,000 fully loaded. Our base service is $11,988 a
              year. Same role, no recruiting, no payroll, no benefits, no
              risk. We can do that because we share ourselves across a small
              group of clients on purpose, which is why this works for
              both sides.
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
          A one-time setup, then a flat monthly. Add the mobile app if you
          want one. Cancel any month.
        </p>
        <div className="landing-pricing landing-pricing-pair">
          <div className="landing-price-card landing-price-card-pro">
            <div className="landing-price-name">Software &amp; website</div>
            <div className="landing-price-amount">
              <span className="landing-price-num">$999</span>
              <span className="landing-price-per">/month</span>
            </div>
            <div className="landing-price-vs">
              plus a one-time $1,995 setup. vs. $215K/year for a full-time hire.
            </div>
            <ul className="landing-price-list">
              <li>Custom software, built and improved monthly</li>
              <li>Your website rebuilt or built fresh, included</li>
              <li>Free domain (or we move yours)</li>
              <li>Hosting, SSL, and uptime, handled</li>
              <li>Bi-weekly planning and delivery meetings</li>
              <li>Direct access between meetings</li>
              <li>You own the code, the domain, the data</li>
              <li>No annual contract, cancel any month</li>
            </ul>
            <a href={BOOK_CALL_URL} className="landing-cta primary block">
              Book a 20-minute call
            </a>
            <div className="landing-price-fine">
              We work with a small number of clients on purpose, so each one
              gets real attention. We&apos;ll know in the first call whether
              we&apos;re a fit.
            </div>
          </div>

          <div className="landing-price-card landing-price-card-addon">
            <div className="landing-price-tag">Add-on</div>
            <div className="landing-price-name">iOS &amp; Android app</div>
            <div className="landing-price-amount">
              <span className="landing-price-plus">+</span>
              <span className="landing-price-num">$299</span>
              <span className="landing-price-per">/month</span>
            </div>
            <div className="landing-price-vs">
              plus a one-time $1,000 added to setup ($2,995 total). Total
              monthly with base service: $1,298.
            </div>
            <ul className="landing-price-list">
              <li>iOS app on the Apple App Store</li>
              <li>Android app on Google Play</li>
              <li>Shared codebase with your web product, one team</li>
              <li>We handle submission, review responses, OS updates</li>
              <li>Push notifications, deep links, offline mode if needed</li>
              <li>Add or remove anytime</li>
            </ul>
            <a href={BOOK_CALL_URL} className="landing-cta block">
              Add it during onboarding
            </a>
            <div className="landing-price-fine">
              The mobile app is an add-on to the base service, not a
              standalone product. Even if you only want the app, you&apos;re
              on the $1,298 monthly because the base service is what we
              build and maintain it from. Apple&apos;s $99/year and Google&apos;s
              $25 one-time developer fees are passed through at cost.
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
              Your subscription covers <strong>our</strong> work: design,
              development, hosting, domain, meetings, support. If your project
              uses paid third-party services (AI APIs, SMS providers, mapping
              services, payment processor fees, premium data feeds, etc.),
              those costs go on your account at cost with no markup. We
              always show you the cost and get your sign-off before turning
              anything paid on.
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
