"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ArrowRightIcon,
  BracketsCurlyIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CheckCircleIcon,
  CheckIcon,
  CopyIcon,
  DotsThreeIcon,
  FloppyDiskIcon,
  FolderIcon,
  LightbulbIcon,
  LightningIcon,
  ListDashesIcon,
  PlayIcon,
  PlusIcon,
  ShieldCheckIcon,
  UserCircleIcon,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui";
import { easeEntrance } from "@/lib/motion";
import { useFx } from "@/lib/useFx";
import { BrandMark } from "./BrandMark";
import type { ConnectorId, FlowField, FlowGuide, FlowStep } from "./flowGuides";

// The window imitates the Power Automate web designer, so it keeps its own light colours
// in every theme instead of following the app's palette.
const INK = "#242424";
const MUTED = "#616161";
const LINE = "#d1d1d1";
const BLUE = "#0f6cbd";

function ConnectorTile({
  connector,
  size = 34,
}: {
  connector: ConnectorId;
  size?: number;
}) {
  const inner = Math.round(size * 0.62);
  const brand =
    connector === "make"
      ? "powerautomate"
      : connector === "outlook"
        ? "outlook"
        : connector === "onedrive"
          ? "onedrive"
          : connector === "teams"
            ? "teams"
            : null;
  if (brand) {
    return (
      <span
        className="grid shrink-0 place-items-center rounded-md bg-white"
        style={{ width: size, height: size, boxShadow: `inset 0 0 0 1px ${LINE}` }}
      >
        <BrandMark brand={brand} size={inner + 4} />
      </span>
    );
  }
  const Icon =
    connector === "office365users"
      ? UserCircleIcon
      : connector === "select"
        ? ListDashesIcon
        : BracketsCurlyIcon;
  return (
    <span
      className="grid shrink-0 place-items-center rounded-md text-white"
      style={{
        width: size,
        height: size,
        background: connector === "office365users" ? BLUE : "#5a6f8c",
      }}
    >
      <Icon size={inner} weight="bold" />
    </span>
  );
}

const TOKEN =
  /(@\{.*?\}|@(?:outputs|body|union|coalesce|triggerOutputs|actions)\([^"]*)/g;

function Code({ text }: { text: string }) {
  const parts = text.split(TOKEN);
  return (
    <pre
      className="max-h-[190px] overflow-auto rounded border bg-white px-3 py-2 text-[11.5px] leading-[1.55]"
      style={{
        borderColor: "#8a8886",
        color: INK,
        fontFamily: "ui-monospace, Consolas, monospace",
      }}
    >
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <span
            key={i}
            className="rounded-sm px-0.5"
            style={{ background: "#e5f1fb", color: BLUE }}
          >
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </pre>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <button
      type="button"
      aria-label={`Copy ${label}`}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => setCopied(true));
      }}
      className="ml-auto inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold transition-colors hover:bg-[#e5f1fb]"
      style={{ color: BLUE }}
    >
      {copied ? (
        <CheckIcon size={12} weight="bold" />
      ) : (
        <CopyIcon size={12} weight="bold" />
      )}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function Toggle({ value }: { value: string }) {
  if (/^(no|off)$/i.test(value.trim())) {
    return (
      <span
        className="inline-flex items-center gap-2 text-[12.5px]"
        style={{ color: INK }}
      >
        <span
          className="relative h-4 w-8 rounded-full border"
          style={{ borderColor: "#616161" }}
        >
          <span
            className="absolute top-[2px] left-[3px] h-2.5 w-2.5 rounded-full"
            style={{ background: "#616161" }}
          />
        </span>
        {value}
      </span>
    );
  }
  return (
    <span className="flex flex-wrap gap-1.5">
      {value.split("+").map((v) => (
        <span
          key={v}
          className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[12px]"
          style={{ borderColor: BLUE, color: INK, background: "#f0f7fd" }}
        >
          <CheckIcon size={11} weight="bold" style={{ color: BLUE }} />
          {v.trim()}
        </span>
      ))}
    </span>
  );
}

function Pick({ value }: { value: string }) {
  const parts = value.includes("/")
    ? value.split("/").filter(Boolean)
    : value.includes(">")
      ? value.split(">").map((p) => p.trim())
      : [value];
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1">
      <FolderIcon size={14} weight="fill" style={{ color: "#c99a1b" }} />
      {parts.map((p, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <CaretRightIcon size={10} weight="bold" style={{ color: MUTED }} />}
          <span style={{ color: INK }}>{p}</span>
        </span>
      ))}
    </span>
  );
}

function Field({
  field,
  delay,
  animate,
}: {
  field: FlowField;
  delay: number;
  animate: boolean;
}) {
  const copyable =
    field.how === "type" || field.how === "expression" || field.how === "code";
  return (
    <motion.div
      initial={animate ? { opacity: 0, y: 6 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, delay, ease: easeEntrance }}
      className="flex flex-col gap-1"
    >
      <div className="flex items-center gap-2">
        <span className="text-[11.5px] font-semibold" style={{ color: "#424242" }}>
          {field.label}
        </span>
        {field.how === "expression" && (
          <span
            className="rounded px-1 text-[10px] font-bold"
            style={{ background: "#e5f1fb", color: BLUE }}
            title="Open the Expression tab (fx)"
          >
            fx
          </span>
        )}
        {copyable && <CopyButton text={field.value} label={field.label} />}
      </div>
      {field.how === "code" ? (
        <Code text={field.value} />
      ) : field.how === "toggle" ? (
        <Toggle value={field.value} />
      ) : (
        <div
          className="flex min-h-8 items-center rounded border bg-white px-2.5 py-1 text-[12.5px]"
          style={{
            borderColor: "#8a8886",
            color: INK,
            fontFamily:
              field.how === "expression"
                ? "ui-monospace, Consolas, monospace"
                : undefined,
          }}
        >
          {field.how === "pick" ? (
            <Pick value={field.value} />
          ) : (
            <span className="break-all">{field.value}</span>
          )}
        </div>
      )}
      {field.note && (
        <p className="text-[11.5px]" style={{ color: MUTED }}>
          {field.note}
        </p>
      )}
    </motion.div>
  );
}

function Card({
  step,
  index,
  state,
  onSelect,
  animate,
  grow,
  cardRef,
}: {
  step: FlowStep;
  index: number;
  state: "done" | "active" | "later";
  onSelect: () => void;
  animate: boolean;
  /** Animate the card opening (height). Only with the GPU: it relayouts every frame. */
  grow: boolean;
  cardRef: (el: HTMLDivElement | null) => void;
}) {
  const active = state === "active";
  return (
    <div ref={cardRef} className="relative">
      <div
        className="overflow-hidden rounded-lg border bg-white"
        style={{
          borderColor: active ? BLUE : LINE,
          boxShadow: active
            ? "0 4px 12px rgba(15,108,189,0.16)"
            : "0 1px 2px rgba(0,0,0,0.06)",
          opacity: state === "later" ? 0.62 : 1,
        }}
      >
        <button
          type="button"
          onClick={onSelect}
          aria-expanded={active}
          aria-label={`Step ${index + 1}: ${step.title}`}
          className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
        >
          <span className="relative">
            <ConnectorTile connector={step.connector} />
            {state === "done" && (
              <motion.span
                initial={animate ? { scale: 0 } : false}
                animate={{ scale: 1 }}
                className="absolute -right-1.5 -bottom-1.5 grid h-4 w-4 place-items-center rounded-full text-white"
                style={{ background: "#107c10" }}
              >
                <CheckIcon size={10} weight="bold" />
              </motion.span>
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span
              className="block truncate text-[13.5px] font-semibold"
              style={{ color: INK }}
            >
              {step.title}
            </span>
            <span className="block truncate text-[11.5px]" style={{ color: MUTED }}>
              {step.trigger && (
                <span
                  className="mr-1.5 inline-flex items-center gap-0.5 font-semibold"
                  style={{ color: "#8a5a00" }}
                >
                  <LightningIcon size={11} weight="fill" /> Trigger
                </span>
              )}
              {step.action}
            </span>
          </span>
          <DotsThreeIcon size={18} weight="bold" style={{ color: MUTED }} />
        </button>
        <AnimatePresence initial={false}>
          {active && step.fields.length > 0 && (
            <motion.div
              key="body"
              initial={grow ? { height: 0, opacity: 0 } : false}
              animate={{ height: "auto", opacity: 1 }}
              exit={grow ? { height: 0, opacity: 0 } : undefined}
              transition={{ duration: 0.32, ease: easeEntrance }}
              className="overflow-hidden"
            >
              <div
                className="flex flex-col gap-3 border-t px-3.5 py-3.5"
                style={{ borderColor: "#e8e8e8" }}
              >
                {step.fields.map((field, i) => (
                  <Field
                    key={field.label}
                    field={field}
                    delay={0.12 + i * 0.09}
                    animate={animate}
                  />
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/** The wire between two cards. Plain elements with a CSS colour transition: no JS animation
 *  runs per connector, and none at all when `animate` is off. */
function Connector({ lit, animate }: { lit: boolean; animate: boolean }) {
  const wire = {
    background: lit ? BLUE : "#b8b8b8",
    transition: animate ? "background-color 0.4s" : undefined,
  };
  return (
    <div className="flex h-9 flex-col items-center" aria-hidden>
      <span className="w-px flex-1" style={wire} />
      <span
        className="-my-0.5 grid h-5 w-5 place-items-center rounded-full border bg-white"
        style={{ borderColor: LINE }}
      >
        <PlusIcon size={10} weight="bold" style={{ color: BLUE }} />
      </span>
      <span className="w-px flex-1" style={wire} />{" "}
      <ArrowRightIcon
        size={10}
        weight="bold"
        className="rotate-90"
        style={{ color: "#8a8886" }}
      />
    </div>
  );
}

function Chrome({ guide, children }: { guide: FlowGuide; children: ReactNode }) {
  return (
    <div
      className="overflow-hidden rounded-xl border shadow-[0_8px_24px_rgba(20,24,40,0.16)]"
      style={{ borderColor: LINE, background: "#fff", color: INK }}
    >
      <div
        className="flex items-center gap-3 px-3 py-2"
        style={{ background: "#ebebeb" }}
      >
        <span className="flex gap-1.5" aria-hidden>
          <i className="h-2.5 w-2.5 rounded-full" style={{ background: "#ff5f57" }} />
          <i className="h-2.5 w-2.5 rounded-full" style={{ background: "#febc2e" }} />
          <i className="h-2.5 w-2.5 rounded-full" style={{ background: "#28c840" }} />
        </span>
        <span
          className="flex h-6 flex-1 items-center gap-1.5 rounded-md bg-white px-3 text-[11.5px]"
          style={{ color: MUTED, maxWidth: 420 }}
        >
          <ShieldCheckIcon size={12} weight="fill" style={{ color: "#107c10" }} />
          make.powerautomate.com
        </span>
      </div>
      <div
        className="flex items-center gap-3 border-b px-3 py-2"
        style={{ borderColor: "#e0e0e0", background: "#fff" }}
      >
        <BrandMark brand="powerautomate" size={22} />
        <span className="text-[13px] font-semibold">Power Automate</span>
        <span className="mx-1 h-4 w-px" style={{ background: LINE }} aria-hidden />
        <span className="truncate text-[12.5px] font-semibold" style={{ color: INK }}>
          {guide.flowName}
        </span>
        <span
          className="rounded-full px-2 py-0.5 text-[10.5px] font-semibold"
          style={{ background: "#fff4ce", color: "#8a5a00" }}
        >
          Draft
        </span>
        <span className="ml-auto hidden items-center gap-1.5 sm:flex">
          {[
            [FloppyDiskIcon, "Save"],
            [ShieldCheckIcon, "Flow checker"],
            [PlayIcon, "Test"],
          ].map(([Icon, label]) => {
            const I = Icon as typeof FloppyDiskIcon;
            return (
              <span
                key={label as string}
                className="inline-flex items-center gap-1 rounded border px-2 py-1 text-[11.5px] font-semibold"
                style={{ borderColor: LINE, color: "#424242" }}
              >
                <I size={12} weight="bold" />
                {label as string}
              </span>
            );
          })}
        </span>
      </div>
      {children}
    </div>
  );
}

/**
 * One flow shown the way Power Automate draws it: the cards of the flow one under the other,
 * the one being explained open with its fields to fill in, plus plain steps below it.
 */
export function FlowGuideView({
  guide,
  onFinished,
}: {
  guide: FlowGuide;
  /** Called when the last step is acknowledged. */
  onFinished?: () => void;
}) {
  const reduce = useReducedMotion() === true;
  const { fx } = useFx();
  const animate = !reduce;
  // Opening a card resizes it, which relayouts the whole canvas every frame; the smooth
  // scroll that follows would fight it. Both are for the GPU mode only.
  const grow = animate && fx === "rich";
  const [index, setIndex] = useState(0);
  const canvas = useRef<HTMLDivElement>(null);
  const cards = useRef<(HTMLDivElement | null)[]>([]);
  const step = guide.steps[index];
  const last = index === guide.steps.length - 1;

  // A different flow starts from its first card.
  useEffect(() => setIndex(0), [guide.id]);

  // Bring the open card to the top of the canvas once the others have finished resizing.
  useEffect(() => {
    const timer = setTimeout(
      () => {
        const el = cards.current[index];
        if (el && canvas.current) {
          canvas.current.scrollTo({
            top: Math.max(0, el.offsetTop - 18),
            behavior: grow ? "smooth" : "auto",
          });
        }
      },
      grow ? 340 : 0,
    );
    return () => clearTimeout(timer);
  }, [index, grow, guide.id]);

  const states = useMemo(
    () =>
      guide.steps.map((_, i): "done" | "active" | "later" =>
        i < index ? "done" : i === index ? "active" : "later",
      ),
    [guide.steps, index],
  );

  return (
    <div className="flex flex-col gap-4">
      <Chrome guide={guide}>
        <div className="flex" style={{ height: "min(46vh, 430px)" }}>
          <nav
            aria-label="Steps of this flow"
            className="hidden w-[176px] shrink-0 flex-col gap-0.5 overflow-y-auto border-r p-2 md:flex"
            style={{ borderColor: "#e0e0e0", background: "#faf9f8" }}
          >
            {guide.steps.map((s, i) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setIndex(i)}
                aria-current={i === index ? "step" : undefined}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors"
                style={{
                  background: i === index ? "#e5f1fb" : "transparent",
                  color: i === index ? BLUE : "#424242",
                  fontWeight: i === index ? 700 : 500,
                }}
              >
                <span
                  className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full text-[10px] font-bold"
                  style={{
                    background: i < index ? "#107c10" : i === index ? BLUE : "#e1dfdd",
                    color: i <= index ? "#fff" : MUTED,
                  }}
                >
                  {i < index ? <CheckIcon size={10} weight="bold" /> : i + 1}
                </span>
                <span className="truncate">{s.title}</span>
              </button>
            ))}
          </nav>
          <div
            ref={canvas}
            className="relative min-w-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-8"
            style={{
              background: "#f5f5f5",
              backgroundImage: "radial-gradient(#d9d9d9 1px, transparent 1px)",
              backgroundSize: "16px 16px",
              contain: "layout paint",
            }}
          >
            <div className="mx-auto flex max-w-[520px] flex-col">
              {guide.steps.map((s, i) => (
                <div key={s.id}>
                  {i > 0 && <Connector lit={i <= index} animate={animate} />}
                  <Card
                    step={s}
                    index={i}
                    state={states[i]}
                    onSelect={() => setIndex(i)}
                    animate={animate}
                    grow={grow}
                    cardRef={(el) => {
                      cards.current[i] = el;
                    }}
                  />
                </div>
              ))}
              <div className="h-24" />
            </div>
          </div>
        </div>
      </Chrome>

      <AnimatePresence mode="wait" initial={false}>
        <motion.section
          key={`${guide.id}-${step.id}`}
          initial={animate ? { opacity: 0, y: 10 } : false}
          animate={{ opacity: 1, y: 0 }}
          exit={animate ? { opacity: 0, y: -6 } : undefined}
          transition={{ duration: 0.26, ease: easeEntrance }}
          aria-label={`What to do: ${step.title}`}
          className="bg-card border-line rounded-card border px-4 py-3.5"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="bg-accent-soft text-accent-ink rounded-chip px-2.5 py-0.5 text-[11.5px] font-bold">
              Step {index + 1} of {guide.steps.length}
            </span>
            <h4 className="text-ink text-[14px] font-bold">{step.title}</h4>
            <span className="text-ink-muted text-[12px]">{step.action}</span>
          </div>
          <ol className="text-ink-soft mt-2.5 list-decimal space-y-1.5 pl-5 text-[13.5px] leading-snug marker:font-semibold">
            {step.doThis.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ol>
          {step.tip && (
            <p className="text-ink-muted bg-chip/70 mt-3 flex items-start gap-2 rounded-md px-3 py-2 text-[12.5px]">
              <LightbulbIcon
                size={15}
                weight="fill"
                className="text-amber mt-px shrink-0"
              />
              {step.tip}
            </p>
          )}
          <div className="mt-3.5 flex items-center justify-between gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={index === 0}
              onClick={() => setIndex((i) => Math.max(0, i - 1))}
            >
              <CaretLeftIcon size={14} weight="bold" />
              Back
            </Button>
            {last ? (
              <Button size="sm" onClick={onFinished}>
                <CheckCircleIcon size={15} weight="fill" />
                This flow is built
              </Button>
            ) : (
              <Button size="sm" onClick={() => setIndex((i) => i + 1)}>
                Next step
                <CaretRightIcon size={14} weight="bold" />
              </Button>
            )}
          </div>
        </motion.section>
      </AnimatePresence>
    </div>
  );
}
