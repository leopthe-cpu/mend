import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, ClipboardList, FileText, MessageSquare, Search } from "lucide-react";
import { useEffect, useRef } from "react";

import { Logo } from "@/components/brand/Logo";
import { ReadyArt, TextArt, TicketArt } from "@/components/site/HowItWorksArt";
import { SiteFooter } from "@/components/site/SiteFooter";
import { Button } from "@/components/ui/button";

// Marketing site (brand doc "Website Copy and Brand Guidelines - Mend",
// decision 51). The copy follows the doc's structure and tone but only
// claims what Mend does today (Oz's choice): texts are sent after one tap to
// confirm, not automatically, and there is no customer status page yet.
export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Mend · Text updates for repair shops" },
      {
        name: "description",
        content:
          "Spend less time on the phone and more time at your bench. Mend tracks repair jobs and texts customers when their item is ready.",
      },
    ],
  }),
  component: Home,
});

const NAV = [
  { href: "#why", label: "Why Mend" },
  { href: "#how", label: "How It Works" },
  { href: "#features", label: "Features" },
  { href: "#pricing", label: "Pricing" },
];

function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-border/70 bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 md:px-8">
        <Link to="/" aria-label="Mend home" className="rounded-md">
          <Logo height={26} />
        </Link>
        <nav aria-label="Sections" className="hidden flex-1 items-center gap-6 md:flex">
          {NAV.map((n) => (
            <a
              key={n.href}
              href={n.href}
              className="text-[0.9375rem] font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {n.label}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <Link to="/login" className="rounded-md px-2 py-2 text-[0.9375rem] font-medium sm:px-3">
            Log in
          </Link>
          <Button asChild>
            <Link to="/signup">Get Started</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}

/**
 * Hero to "Why Mend" (brand doc): as you scroll, the photo eases from full
 * bleed to a rounded card at 95% scale while the next section slides up over
 * its lower edge, clearing a slight blur. Skipped for reduced motion.
 */
function useHeroScroll(hero: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = hero.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const h = el.offsetHeight || window.innerHeight;
      const p = Math.min(1, Math.max(0, window.scrollY / (h * 0.6)));
      document.documentElement.style.setProperty("--hero-p", p.toFixed(3));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
      document.documentElement.style.removeProperty("--hero-p");
    };
  }, [hero]);
}

function Hero() {
  const ref = useRef<HTMLElement>(null);
  useHeroScroll(ref);
  return (
    <section
      ref={ref}
      className="relative h-[calc(100svh-4rem)] min-h-[34rem]"
      aria-labelledby="hero-title"
    >
      <div
        className="absolute inset-0 overflow-hidden"
        style={{
          transform: "scale(calc(1 - 0.05 * var(--hero-p, 0)))",
          borderRadius: "calc(1.5rem * var(--hero-p, 0))",
          transformOrigin: "50% 0%",
        }}
      >
        {/* Placeholder photo until the craft photography from the brand doc exists. */}
        <img
          src="/images/tailor-and-cleaners-winter.webp"
          alt="A repair shop window glowing on a winter evening"
          className="h-full w-full object-cover"
          width={2000}
          height={2000}
          fetchPriority="high"
        />
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/45 to-black/10"
        />
        {/* Subtle film grain (brand doc: "warm ambient lighting, subtle film grain") */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.08] mix-blend-overlay"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")",
          }}
        />
      </div>
      <div className="relative mx-auto flex h-full max-w-6xl flex-col justify-end px-4 pb-24 md:px-8 md:pb-32">
        <h1
          id="hero-title"
          className="max-w-3xl text-[2.5rem] leading-[1.05] font-bold tracking-[-0.03em] text-white md:text-7xl"
        >
          Spend less time on the phone. More time at your bench.
        </h1>
        <p className="mt-5 max-w-xl text-lg text-white/90 md:text-xl">
          Text updates for cobblers, leather artisans and watchmakers, sent in one tap. No computer
          skills needed.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Button asChild size="lg" className="bg-white text-black hover:bg-white/90">
            <Link to="/signup">Start 14-Day Free Trial</Link>
          </Button>
          <Button
            asChild
            size="lg"
            variant="outline"
            className="border-white/70 bg-transparent text-white hover:bg-white/10 hover:text-white"
          >
            <a href="#how">See How It Works</a>
          </Button>
        </div>
        <p className="mt-4 text-sm text-white/85">
          No card needed. Free while Mend is in early access.
        </p>
      </div>
    </section>
  );
}

function SectionHeading({ eyebrow, title, id }: { eyebrow: string; title: string; id: string }) {
  return (
    <div className="max-w-2xl">
      <p className="text-sm font-semibold tracking-[0.08em] text-brand-text uppercase">{eyebrow}</p>
      <h2 id={id} className="mt-3 text-3xl leading-tight font-bold tracking-[-0.02em] md:text-5xl">
        {title}
      </h2>
    </div>
  );
}

function Why() {
  const points = [
    {
      title: "No complex software",
      body: "Keep your paper tags or ticket book. Mend just holds the customer, the job and their phone number.",
    },
    {
      title: "One tap to notify",
      body: "Move a job to Ready, check the text, tap Send. Your customer hears from you right away.",
    },
    {
      title: "Fewer interruptions",
      body: "Customers know the moment their repair is done, so they stop calling to ask.",
    },
  ];
  return (
    <section
      id="why"
      aria-labelledby="why-title"
      className="relative z-10 -mt-12 scroll-mt-20 rounded-t-[2rem] bg-background pt-20 pb-24"
      style={{
        filter: "blur(calc(3px * (1 - var(--hero-p, 1))))",
        transition: "filter 0.3s cubic-bezier(0.22, 1, 0.36, 1)",
      }}
    >
      <div className="mx-auto max-w-6xl px-4 md:px-8">
        <SectionHeading
          eyebrow="Why Mend"
          id="why-title"
          title={'Stop answering "Is my repair ready?" calls.'}
        />
        <ul className="mt-12 grid gap-4 md:grid-cols-3">
          {points.map((p) => (
            <li key={p.title} className="rounded-2xl bg-card p-6">
              <span aria-hidden className="block h-1 w-10 rounded-full bg-brand" />
              <h3 className="mt-5 text-xl font-semibold">{p.title}</h3>
              <p className="mt-2 text-muted-foreground">{p.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function How() {
  const steps = [
    {
      n: 1,
      title: "Write the repair ticket",
      body: "Keep using your paper claim tag or logbook if you like. Add the customer's name and phone number to Mend in a few seconds.",
      art: <TicketArt />,
    },
    {
      n: 2,
      title: "Update status in one tap",
      body: "When the work is done, move the job to “Ready for pickup.”",
      art: <ReadyArt />,
    },
    {
      n: 3,
      title: "Customer gets a text",
      body: "Mend shows you the message, you tap Send, and it's on its way. No phone calls required.",
      art: <TextArt />,
    },
  ];
  return (
    <section
      id="how"
      aria-labelledby="how-title"
      className="scroll-mt-20 border-t border-border py-24"
    >
      <div className="mx-auto max-w-6xl px-4 md:px-8">
        <SectionHeading eyebrow="How It Works" id="how-title" title="Simple as 1, 2, 3." />
        <ol className="mt-12 grid gap-8 md:grid-cols-3">
          {steps.map((s) => (
            <li key={s.n} className="flex flex-col">
              {s.art}
              <h3 className="mt-6 flex items-baseline gap-3 text-xl font-semibold">
                <span className="font-mono text-brand-text">{s.n}.</span> {s.title}
              </h3>
              <p className="mt-2 text-muted-foreground">{s.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Features() {
  const items = [
    {
      icon: MessageSquare,
      title: "Instant SMS Alerts",
      body: "Text customers when items are received, in progress or ready. You see every message before it goes.",
    },
    {
      icon: FileText,
      title: "Estimates & Invoices",
      body: "Price jobs from your own list, add discounts, and print a clean estimate or invoice.",
    },
    {
      icon: Search,
      title: "Paper-Friendly",
      body: "Find any job by ticket number, name or phone, and print a claim tag if you want one. No barcode scanners or training required.",
    },
    {
      icon: ClipboardList,
      title: "Simple Daily Log",
      body: "See all active jobs on one clear, uncluttered board.",
    },
  ];
  return (
    <section
      id="features"
      aria-labelledby="features-title"
      className="surface-dark scroll-mt-20 bg-background py-24 text-foreground"
    >
      <div className="mx-auto max-w-6xl px-4 md:px-8">
        <SectionHeading
          eyebrow="Features"
          id="features-title"
          title="Built for hands-on craftsmen."
        />
        <ul className="mt-12 grid gap-4 sm:grid-cols-2">
          {items.map(({ icon: Icon, title, body }) => (
            <li key={title} className="rounded-2xl border border-border bg-card p-6">
              <Icon aria-hidden className="size-6 text-brand-text" />
              <h3 className="mt-4 text-xl font-semibold">{title}</h3>
              <p className="mt-2 text-muted-foreground">{body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Pricing() {
  const plans = [
    {
      name: "Starter",
      price: "$19",
      popular: false,
      features: [
        "Up to 100 repair tickets/mo",
        "SMS notifications",
        "Estimates, invoices and claim tags",
        "Email support",
      ],
    },
    {
      name: "Workshop",
      price: "$39",
      popular: true,
      features: [
        "Unlimited repair tickets",
        "SMS & email notifications",
        "Your shop name on every message and invoice",
        "Priority phone & text support",
      ],
    },
  ];
  return (
    <section id="pricing" aria-labelledby="pricing-title" className="scroll-mt-20 py-24">
      <div className="mx-auto max-w-6xl px-4 md:px-8">
        <SectionHeading eyebrow="Pricing" id="pricing-title" title="Simple, honest pricing." />
        <p className="mt-4 text-lg text-muted-foreground">
          No setup fees. No contracts. Cancel anytime.
        </p>
        <p className="mt-6 inline-flex rounded-full bg-card px-4 py-2 text-sm font-medium">
          Free while Mend is in early access. No card needed.
        </p>
        <ul className="mt-10 grid gap-4 md:grid-cols-2">
          {plans.map((p) => (
            <li
              key={p.name}
              className={
                p.popular
                  ? "surface-dark relative rounded-2xl bg-background p-8 text-foreground"
                  : "rounded-2xl border border-border bg-card p-8"
              }
            >
              {p.popular ? (
                <span className="absolute top-6 right-6 rounded-full bg-[var(--mend-accent-text)] px-3 py-1 text-sm font-semibold text-white">
                  Most Popular
                </span>
              ) : null}
              <h3 className="text-xl font-semibold">{p.name}</h3>
              <p className="mt-4 flex items-baseline gap-1">
                <span className="text-5xl font-bold tracking-[-0.03em]">{p.price}</span>
                <span className="text-muted-foreground">/ month</span>
              </p>
              <ul className="mt-6 flex flex-col gap-3">
                {p.features.map((f) => (
                  <li key={f} className="flex gap-3">
                    <Check aria-hidden className="mt-0.5 size-5 shrink-0 text-brand-text" />
                    {f}
                  </li>
                ))}
              </ul>
              <Button
                asChild
                size="lg"
                className="mt-8 w-full"
                variant={p.popular ? "default" : "outline"}
              >
                <Link to="/signup">Start 14-Day Free Trial</Link>
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Home() {
  return (
    <div className="min-h-svh bg-background text-foreground">
      <a
        href="#why"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-black focus:px-4 focus:py-2 focus:text-white"
      >
        Skip to content
      </a>
      <Header />
      <main>
        <Hero />
        <Why />
        <How />
        <Features />
        <Pricing />
      </main>
      <SiteFooter />
    </div>
  );
}
