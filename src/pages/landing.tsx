import * as React from "react"
import { LazyGsap } from "@/lib/gsap"
import { cn } from "@/lib/utils"

const FEATURES = [
  {
    title: "Never oversold",
    copy: "Every batch has a fixed unit count. When the last one is claimed, ordering stops.",
    icon: "🔒",
  },
  {
    title: "Pickup slots",
    copy: "Customers choose a time window, so handovers never pile up at your door.",
    icon: "🕒",
  },
  {
    title: "Automatic sold-out",
    copy: "The storefront flips to “sold out” the moment the final unit is gone.",
    icon: "🪧",
  },
  {
    title: "Prep list",
    copy: "One printable list of everything to bake, grouped by order — no more screenshots.",
    icon: "📋",
  },
  {
    title: "Sold-out waitlist",
    copy: "Cancelled spots go to the next person in line, automatically.",
    icon: "⏳",
  },
  {
    title: "Batch Pulse",
    copy: "See how fast each batch sells and what to bake next time.",
    icon: "📈",
  },
  {
    title: "Share this drop",
    copy: "One tap makes a story-ready image for WhatsApp and Instagram.",
    icon: "📲",
  },
  {
    title: "WhatsApp messaging",
    copy: "A “message the seller” button on every storefront, wired to your number.",
    icon: "💬",
  },
  {
    title: "Pay on pickup",
    copy: "Track paid and unpaid orders. No payment fees — collect cash or transfer at handover.",
    icon: "💵",
  },
]

const CHAT_BUBBLES = [
  { text: "Is this still available?", x: "6%", y: "8%", r: -8, d: 0 },
  { text: "Can I get 2 boxes??", x: "58%", y: "2%", r: 6, d: 0.1 },
  { text: "Did you see my order?", x: "2%", y: "48%", r: 5, d: 0.2 },
  { text: "Sorry, sold out already!", x: "66%", y: "42%", r: -6, d: 0.3 },
]

const STEP_CAPTIONS = [
  "Create a batch with a fixed number of units and pickup slots",
  "Share one link on Instagram or WhatsApp",
  "Get a ready prep list and pickup schedule",
]

/** Where each cupcake floats before it flies into the box (stage units, origin = stage centre). */
const CUPCAKE_START: Array<[number, number]> = [
  [-215, -70],
  [-205, 90],
  [-110, -85],
  [215, -60],
  [205, 100],
  [110, -85],
]

const SECTION_PAD: React.CSSProperties = {
  paddingTop: "clamp(5rem, 10vw, 8rem)",
  paddingBottom: "clamp(5rem, 10vw, 8rem)",
}

const STAGE_W = 480
const STAGE_H = 420

function clamp01(n: number) {
  return Math.min(1, Math.max(0, n))
}
function smoothstep(x: number, e0: number, e1: number) {
  const t = clamp01((x - e0) / (e1 - e0))
  return t * t * (3 - 2 * t)
}

/** Viewport info: mobile flag + a scale for the pastry art that fits its column at each width. */
function useViewport() {
  const read = () => {
    const w = typeof window === "undefined" ? 1280 : window.innerWidth
    return {
      isMobile: w < 768,
      artScale: w < 768 ? 0.62 : w < 1024 ? 0.6 : w < 1280 ? 0.8 : 1,
    }
  }
  const [v, setV] = React.useState(read)
  React.useEffect(() => {
    const on = () =>
      setV((prev) => {
        const n = read()
        return prev.isMobile === n.isMobile && prev.artScale === n.artScale ? prev : n
      })
    on()
    window.addEventListener("resize", on)
    return () => window.removeEventListener("resize", on)
  }, [])
  return v
}

export function LandingPage() {
  const fixSectionRef = React.useRef<HTMLDivElement>(null)
  const artRef = React.useRef<HTMLDivElement>(null)
  const { isMobile, artScale } = useViewport()
  const [reducedMotion, setReducedMotion] = React.useState(false)
  const [counter, setCounter] = React.useState(24)
  const [activeStep, setActiveStep] = React.useState(0)
  const [showStamp, setShowStamp] = React.useState(false)
  const [revealVisible, setRevealVisible] = React.useState(false)

  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    setReducedMotion(mq.matches)
    const onChange = () => setReducedMotion(mq.matches)
    mq.addEventListener("change", onChange)
    return () => mq.removeEventListener("change", onChange)
  }, [])

  // Pinned "fix" section: scroll drives CSS variables directly (no per-frame React renders).
  React.useEffect(() => {
    const section = fixSectionRef.current
    const art = artRef.current
    if (!section || !art) return

    const apply = (p: number) => {
      art.style.setProperty("--a", smoothstep(p, 0.12, 0.38).toFixed(4))
      art.style.setProperty("--l", smoothstep(p, 0.38, 0.72).toFixed(4))
      art.style.setProperty("--c", smoothstep(p, 0.68, 0.96).toFixed(4))
      // These only re-render when the value actually changes
      setCounter(Math.max(0, Math.round(24 * (1 - Math.min(1, p * 1.15)))))
      setActiveStep(Math.min(2, Math.floor(p * 3)))
      setShowStamp(p > 0.86)
    }

    if (reducedMotion) {
      apply(0)
      return
    }

    let target = 0
    let cur = 0
    let raf = 0
    let running = false

    const loop = () => {
      cur += (target - cur) * 0.14
      if (Math.abs(target - cur) < 0.0005) cur = target
      apply(cur)
      if (cur !== target) {
        raf = requestAnimationFrame(loop)
      } else {
        running = false
      }
    }
    const kick = () => {
      if (running) return
      running = true
      raf = requestAnimationFrame(loop)
    }
    const onScroll = () => {
      const rect = section.getBoundingClientRect()
      const total = Math.max(section.offsetHeight - window.innerHeight, 1)
      target = clamp01(-rect.top / total)
      kick()
    }

    window.addEventListener("scroll", onScroll, { passive: true })
    window.addEventListener("resize", onScroll)
    onScroll()
    return () => {
      window.removeEventListener("scroll", onScroll)
      window.removeEventListener("resize", onScroll)
      cancelAnimationFrame(raf)
    }
  }, [reducedMotion])

  // GSAP scroll animations: chaos bubbles fly in, feature cards stagger.
  // On mobile the bubbles only fade/slide up (no rotation) so the stacked list stays tidy.
  React.useEffect(() => {
    if (reducedMotion) return
    const { gsap } = LazyGsap
    const ctx = gsap.context(() => {
      gsap.utils.toArray<HTMLElement>("[data-chaos-bubble]").forEach((el, i) => {
        gsap.from(el, {
          opacity: 0,
          y: isMobile ? 40 : 90,
          x: isMobile ? 0 : i % 2 === 0 ? -50 : 50,
          rotation: isMobile ? 0 : i % 2 === 0 ? -16 : 14,
          duration: 0.8,
          delay: i * 0.12,
          ease: "power3.out",
          scrollTrigger: { trigger: el, start: "top 88%" },
        })
      })
    })
    return () => ctx.revert()
  }, [reducedMotion, isMobile])

  // Prep list reveal on scroll
  React.useEffect(() => {
    const el = document.getElementById("prep-reveal")
    if (!el) return
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setRevealVisible(true)
          obs.disconnect()
        }
      },
      { threshold: 0.15 }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  // Feature cards: reveal with IntersectionObserver. Unlike a scroll-position tween it can't
  // get stuck hidden when the layout above changes height after load.
  React.useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"))
    if (reducedMotion || typeof IntersectionObserver === "undefined") {
      els.forEach((el) => el.classList.add("is-in"))
      return
    }
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("is-in")
            obs.unobserve(e.target)
          }
        })
      },
      { threshold: 0.05 }
    )
    els.forEach((el) => obs.observe(el))
    return () => obs.disconnect()
  }, [reducedMotion])

  return (
    <div className="min-h-svh overflow-x-clip bg-background">
      {/* ============ HERO ============ */}
      <section className="relative flex min-h-svh items-center overflow-hidden">
        {/* Two real columns on md+ (text | art) so they can never overlap; art stacks on top on mobile */}
        <div className="mx-auto grid w-full max-w-6xl items-center gap-4 px-6 pb-16 pt-10 md:grid-cols-2 md:gap-8 md:py-24">
          <div className="pointer-events-none order-1 flex justify-center md:order-2">
            <ArtFrame scale={artScale}>
              <PastryArt mode="hero" />
            </ArtFrame>
          </div>
          <div className="order-2 max-w-xl md:order-1">
            <p className="mb-4 inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
              <span className="size-2 rounded-full bg-green-600" /> Pre-order storefronts for home kitchens
            </p>
            <h1 className="font-display text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl">
              Sell out your next batch.{" "}
              <span className="text-primary">No more DM chaos.</span>
            </h1>
            <p className="mt-5 max-w-md text-lg text-muted-foreground">
              Home bakers and cooks set a batch size, share one link, and customers
              pre-order until it sells out.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <a
                href="/s/maple-crumb"
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-sm transition-transform hover:scale-[1.02] active:scale-[0.98]"
              >
                Try the demo kitchen
              </a>
              <a
                href="/auth"
                className="inline-flex items-center gap-2 rounded-xl border bg-card px-6 py-3 text-sm font-semibold text-foreground transition-colors hover:bg-secondary"
              >
                Start your kitchen
              </a>
            </div>
            <p className="mt-6 text-xs text-muted-foreground">
              Free while in beta · No payment fees · Pay on pickup
            </p>
          </div>
        </div>
      </section>

      {/* ============ THE CHAOS ============ */}
      <section className="relative overflow-hidden py-20 md:py-28">
        <div className="mx-auto max-w-5xl px-6 text-center">
          <h2 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            Orders in DMs get lost, <span className="text-destructive">oversold</span> and forgotten.
          </h2>
          <p className="mx-auto mt-4 max-w-lg text-muted-foreground">
            You promised two boxes to three different people. Someone paid and never
            got a confirmation. And you still don't know how many loaves to bake.
          </p>
        </div>
        {/* Mobile: normal vertical stack. Desktop (md+): scattered absolute layout. */}
        <div className="relative mx-auto mt-12 flex max-w-4xl flex-col items-center gap-4 px-6 md:mt-16 md:block md:h-72">
          {CHAT_BUBBLES.map((b, i) => (
            <div
              key={i}
              data-chaos-bubble
              className="w-56 max-w-[85vw] rounded-2xl border bg-card p-4 shadow-md md:absolute md:w-56"
              style={
                {
                  ["--bubble-x" as string]: b.x,
                  ["--bubble-y" as string]: b.y,
                  ["--bubble-r" as string]: `${b.r}deg`,
                } as React.CSSProperties
              }
            >
              <p className="text-sm font-medium">“{b.text}”</p>
              <p className="mt-2 text-xs text-muted-foreground">via Instagram DM · 11:0{i + 2} PM</p>
            </div>
          ))}
        </div>
        {/* Always below the bubbles, in normal flow */}
        <div className="mt-8 flex justify-center px-6">
          <div className="rounded-xl bg-destructive/10 px-4 py-2 text-center text-sm font-medium text-destructive">
            ⚠️ You promised 9 boxes. You only have 6 left.
          </div>
        </div>
      </section>

      {/* ============ THE FIX (pinned) ============ */}
      <section ref={fixSectionRef} className="relative" style={{ height: reducedMotion ? "auto" : "300vh" }}>
        <div
          className="sticky top-0 flex min-h-svh items-start overflow-hidden pt-4 md:items-center md:pt-0"
          data-testid="fix-pinned"
        >
          <div className="mx-auto grid w-full max-w-6xl items-center gap-4 px-6 md:grid-cols-2 md:gap-8">
            {/* One instance only (it owns artRef) */}
            <div className="pointer-events-none order-1 flex justify-center md:order-2">
              <ArtFrame scale={isMobile ? 0.5 : artScale}>
                <PastryArt mode="fix" artRef={artRef} />
              </ArtFrame>
            </div>

            <div className="order-2 max-w-md md:order-1">
              <p className="text-sm font-semibold uppercase tracking-wide text-primary">The fix</p>
              <h2 className="mt-2 font-display text-2xl font-semibold tracking-tight sm:text-4xl md:mt-3 md:text-3xl">
                One link. A fixed batch. A calm Friday.
              </h2>

              {/* Animated counter */}
              <div className="mt-4 md:mt-8">
                <div className="flex items-baseline gap-3">
                  <span
                    className="font-display font-semibold tabular-nums text-primary"
                    style={{ fontSize: "clamp(3.5rem, 7vw, 5.5rem)", lineHeight: 1 }}
                    data-testid="batch-counter"
                  >
                    {counter}
                  </span>
                  <span className="text-sm text-muted-foreground">units left</span>
                </div>
                <div className="mt-3 h-2 w-64 max-w-full overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-150"
                    style={{ width: `${(counter / 24) * 100}%` }}
                  />
                </div>
                {showStamp && (
                  <div
                    className="mt-4 inline-block -rotate-6 rounded-lg border-4 border-destructive px-4 py-1 font-display text-xl font-bold text-destructive md:mt-5 md:px-5 md:py-2 md:text-2xl"
                    style={{
                      animation: reducedMotion ? undefined : "stamp-in 300ms ease-out",
                    }}
                    data-testid="sold-out-stamp"
                  >
                    SOLD OUT
                  </div>
                )}
              </div>

              {/* Step captions */}
              <div className="mt-5 space-y-2 md:mt-10 md:space-y-4">
                {STEP_CAPTIONS.map((s, i) => (
                  <div
                    key={i}
                    className={cn(
                      "flex items-start gap-3 rounded-xl border bg-card/80 p-3 transition-opacity duration-500 md:p-4",
                      reducedMotion || activeStep === i ? "opacity-100" : "opacity-30"
                    )}
                  >
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                      {i + 1}
                    </span>
                    <p className="text-sm font-medium">{s}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============ PREP LIST REVEAL ============ */}
      <section id="prep-reveal" className="relative" style={SECTION_PAD}>
        <div className="mx-auto max-w-4xl px-6">
          <div className="text-center">
            <h2 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
              Friday morning, you print one page.
            </h2>
            <p className="mx-auto mt-4 max-w-md text-muted-foreground">
              Every order, every unit, grouped by pickup slot. Bake the right amount —
              not a single cupcake more.
            </p>
          </div>
          <div
            className={cn(
              "mx-auto mt-14 max-w-md rounded-2xl border bg-card shadow-lg transition-all duration-700",
              revealVisible ? "translate-y-0 opacity-100" : "translate-y-12 opacity-0"
            )}
          >
            <div className="border-b bg-secondary/50 px-6 py-4">
              <p className="font-display text-lg font-semibold">Prep list — Friday Drop</p>
              <p className="text-xs text-muted-foreground">8 orders · 24 units · 3 pickup slots</p>
            </div>
            <div className="space-y-3 px-6 py-5">
              {[
                { name: "Chocolate cupcakes (2)", qty: 14 },
                { name: "Lemon tarts (2)", qty: 9 },
                { name: "Sourdough loaves", qty: 3 },
              ].map((row, i) => (
                <div
                  key={row.name}
                  className={cn(
                    "flex items-center justify-between border-b border-dashed pb-2 text-sm transition-all duration-500",
                    revealVisible ? "translate-x-0 opacity-100" : "translate-x-4 opacity-0"
                  )}
                  style={{ transitionDelay: `${200 + i * 150}ms` }}
                >
                  <span className="font-medium">{row.name}</span>
                  <span className="tabular-nums text-muted-foreground">× {row.qty}</span>
                </div>
              ))}
            </div>
            <div className="border-t bg-secondary/30 px-6 py-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Pickup schedule
              </p>
              {[
                { slot: "10:00 AM – 12:00 PM", orders: 3 },
                { slot: "1:00 PM – 3:00 PM", orders: 3 },
                { slot: "5:00 PM – 7:00 PM", orders: 2 },
              ].map((s) => (
                <div key={s.slot} className="flex items-center justify-between py-1 text-sm">
                  <span>{s.slot}</span>
                  <span className="tabular-nums text-muted-foreground">{s.orders} orders</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ============ FEATURES ============ */}
      <section className="relative border-t bg-card/40" style={SECTION_PAD}>
        <div className="mx-auto max-w-5xl px-6">
          <h2 className="text-center font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            Everything a one-person bakery needs
          </h2>
          <p className="mx-auto mt-4 max-w-md text-center text-muted-foreground">
            No apps to manage, no payment gateway. Just a link that does the boring parts.
          </p>
          <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f, i) => (
              <div
                key={f.title}
                data-reveal
                style={{ ["--d" as string]: `${(i % 3) * 90}ms` } as React.CSSProperties}
              >
                <div className="group h-full rounded-2xl border bg-card p-6 shadow-sm transition-all duration-500 hover:-translate-y-1 hover:shadow-md">
                  <div className="flex size-11 items-center justify-center rounded-xl bg-secondary text-xl transition-transform group-hover:scale-110">
                    {f.icon}
                  </div>
                  <h3 className="mt-4 font-semibold">{f.title}</h3>
                  <p className="mt-1.5 text-sm text-muted-foreground">{f.copy}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============ FINAL CTA ============ */}
      <section className="relative overflow-hidden py-24 md:py-32">
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            background: "radial-gradient(600px 300px at 50% 100%, oklch(0.87 0.07 60), transparent)",
          }}
        />
        <div className="relative mx-auto max-w-2xl px-6 text-center">
          <h2 className="font-display text-4xl font-semibold tracking-tight sm:text-5xl">
            Your next batch is waiting.
          </h2>
          <p className="mx-auto mt-4 max-w-md text-muted-foreground">
            Set it up in five minutes. Your customers will do the rest.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <a
              href="/s/maple-crumb"
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-sm transition-transform hover:scale-[1.02] active:scale-[0.98]"
            >
              Try the demo kitchen
            </a>
            <a
              href="/auth"
              className="inline-flex items-center gap-2 rounded-xl border bg-card px-6 py-3 text-sm font-semibold text-foreground transition-colors hover:bg-secondary"
            >
              Start your kitchen
            </a>
          </div>
        </div>
      </section>

      {/* ============ FOOTER ============ */}
      <footer className="border-t py-10">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6">
          <span className="font-display text-lg font-semibold">Batchly</span>
          <p className="text-sm text-muted-foreground">
            Pre-orders for home kitchens — bake the right amount, every time.
          </p>
        </div>
      </footer>

      <style>{`
        @media (min-width: 768px) {
          [data-chaos-bubble] {
            left: var(--bubble-x) !important;
            top: var(--bubble-y) !important;
            transform: rotate(var(--bubble-r)) !important;
          }
        }
        [data-reveal] {
          opacity: 0;
          transform: translateY(40px);
          transition: opacity 600ms ease-out, transform 600ms ease-out;
          transition-delay: var(--d, 0ms);
        }
        [data-reveal].is-in { opacity: 1; transform: none; }
        @media (prefers-reduced-motion: reduce) {
          [data-reveal] { opacity: 1; transform: none; transition: none; }
        }
        @keyframes stamp-in {
          0% { transform: scale(2.2) rotate(-14deg); opacity: 0; }
          60% { transform: scale(0.95) rotate(-5deg); opacity: 1; }
          75% { transform: scale(1.05) rotate(-7deg); }
          100% { transform: scale(1) rotate(-6deg); opacity: 1; }
        }

        /* ---------- Pastry box illustration (pure CSS) ----------
           --a: cupcakes line up above the box   (0..1)
           --l: cupcakes lower into the box      (0..1)
           --c: lid closes                       (0..1)
           Stage origin is its centre; units are px. */
        .pb-stage { --a: 0; --l: 0; --c: 0; position: relative; width: ${STAGE_W}px; height: ${STAGE_H}px; flex: none; }
        .pb-stage--hero { --c: 1; }
        .pb-group { position: absolute; inset: 0; }
        .pb-stage--hero .pb-group { animation: pb-float 6s ease-in-out infinite; }

        .pb-shadow {
          position: absolute; left: 50%; top: 50%; width: 340px; height: 28px;
          margin: 150px 0 0 -170px; border-radius: 50%;
          background: radial-gradient(closest-side, rgba(107,74,50,.22), transparent);
        }
        .pb-back {
          position: absolute; left: 50%; top: 50%; width: 280px; height: 26px;
          margin: 5px 0 0 -140px; border-radius: 8px 8px 0 0; background: #8a6244; z-index: 1;
        }
        .pb-front {
          position: absolute; left: 50%; top: 50%; width: 300px; height: 120px;
          margin: 20px 0 0 -150px; border-radius: 6px 6px 16px 16px; z-index: 3;
          background: linear-gradient(180deg, #f6ead6, #e6cfac);
          box-shadow: 0 18px 30px rgba(107,74,50,.22);
        }
        .pb-front::after {
          content: ""; position: absolute; left: 0; right: 0; top: 46%; height: 10px;
          background: #6b4a32; opacity: .8;
        }
        .pb-lid {
          position: absolute; left: 50%; top: 50%; width: 324px; height: 36px;
          margin-left: -162px; border-radius: 8px; z-index: 4;
          background: linear-gradient(180deg, #c26a45, #b45a38);
          box-shadow: 0 8px 14px rgba(107,74,50,.25);
          transform: translateY(calc((-12 - 158 * (1 - var(--c))) * 1px)) rotate(calc(-6deg * (1 - var(--c))));
        }
        .pb-lid::after {
          content: ""; position: absolute; left: 50%; top: 0; bottom: 0; width: 16px;
          margin-left: -8px; background: #6b4a32; opacity: .85;
        }

        .pb-cc {
          --x1: calc(var(--sx) + (var(--lx) - var(--sx)) * var(--a));
          --x: calc(var(--x1) + (var(--px) - var(--x1)) * var(--l));
          --y1: calc(var(--sy) + (var(--ly) - var(--sy)) * var(--a));
          --y: calc(var(--y1) + (var(--py) - var(--y1)) * var(--l));
          position: absolute; left: 50%; top: 50%; width: 64px; height: 80px; margin: -40px 0 0 -32px; z-index: 2;
          transform: translate(calc(var(--x) * 1px), calc(var(--y) * 1px)) scale(calc(1 - 0.28 * var(--l)));
        }
        .pb-cc-in {
          position: absolute; inset: 0;
          filter: drop-shadow(0 6px 6px rgba(107,74,50,.22));
          animation: pb-bob 3.4s ease-in-out infinite;
          animation-delay: calc(var(--i) * -0.6s);
        }
        .pb-cup {
          position: absolute; left: 6px; right: 6px; bottom: 0; height: 40px;
          background: linear-gradient(90deg, #8f4527, #b45a38 45%, #8f4527);
          clip-path: polygon(0 0, 100% 0, 82% 100%, 18% 100%);
        }
        .pb-frost {
          position: absolute; left: 0; right: 0; top: 14px; height: 42px; border-radius: 50% 50% 46% 46%;
          background: radial-gradient(circle at 35% 30%, #fff3df, #f6ead6 55%, #e3ccaa);
        }
        .pb-cherry {
          position: absolute; left: 50%; top: 3px; width: 14px; height: 14px; margin-left: -7px; border-radius: 50%;
          background: radial-gradient(circle at 35% 30%, #d77a52, #b45a38 60%, #8f4527);
        }

        @keyframes pb-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
        @keyframes pb-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
        @media (prefers-reduced-motion: reduce) {
          .pb-group, .pb-cc-in { animation: none !important; }
        }
      `}</style>
    </div>
  )
}

/**
 * Reserves layout space that matches the *scaled* size of the art.
 * CSS `transform: scale()` alone doesn't change layout size, which is why
 * the unscaled 480×420 stage used to spill behind the text on mobile.
 */
function ArtFrame({
  scale,
  children,
  className,
}: {
  scale: number
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn("relative shrink-0", className)}
      style={{ width: STAGE_W * scale, height: STAGE_H * scale }}
    >
      <div
        className="absolute left-1/2 top-1/2"
        style={{
          width: STAGE_W,
          height: STAGE_H,
          transform: `translate(-50%, -50%) scale(${scale})`,
          transformOrigin: "center",
        }}
      >
        {children}
      </div>
    </div>
  )
}

/**
 * Pastry box + cupcakes, built from plain divs and CSS. No canvas, no WebGL,
 * so it can't go blank. In "fix" mode the parent writes --a / --l / --c on
 * the stage element as you scroll.
 */
function PastryArt({
  mode,
  artRef,
  className,
}: {
  mode: "hero" | "fix"
  artRef?: React.Ref<HTMLDivElement>
  className?: string
}) {
  return (
    <div
      ref={artRef}
      className={cn("pb-stage", mode === "hero" && "pb-stage--hero", className)}
      aria-hidden="true"
    >
      <div className="pb-group">
        <div className="pb-shadow" />
        <div className="pb-back" />
        {CUPCAKE_START.map(([sx, sy], i) => (
          <div
            key={i}
            className="pb-cc"
            style={
              {
                ["--i" as string]: i,
                ["--sx" as string]: sx,
                ["--sy" as string]: sy,
                ["--lx" as string]: (i - 2.5) * 52,
                ["--ly" as string]: -60,
                ["--px" as string]: (i - 2.5) * 46,
                ["--py" as string]: 40,
              } as React.CSSProperties
            }
          >
            <div className="pb-cc-in">
              <div className="pb-cup" />
              <div className="pb-frost" />
              <div className="pb-cherry" />
            </div>
          </div>
        ))}
        <div className="pb-front" />
        <div className="pb-lid" />
      </div>
    </div>
  )
}