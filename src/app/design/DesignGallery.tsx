"use client";

import { useState } from "react";
import {
  BellIcon,
  FolderIcon,
  GearSixIcon,
  GlobeIcon,
  NotePencilIcon,
  PlusIcon,
  SparkleIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { SettingsMenu } from "@/components/desktop/SettingsMenu";
import { Wallpaper } from "@/components/desktop/Wallpaper";
import {
  Avatar,
  Badge,
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  IconButton,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Progress,
  ScrollArea,
  Slider,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tooltip,
} from "@/components/ui";
import { cn } from "@/lib/cn";

/** A labeled block of the gallery. */
function Section({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn("spot rounded-card bg-card border-line border p-5", className)}
    >
      <h3 className="text-ink-muted mb-3 text-[11.5px] font-bold tracking-[0.08em] uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

const rows = [
  { id: "a", title: "Quarterly roster review", sub: "Updated 2 min ago" },
  { id: "b", title: "December disconnect plan", sub: "Waiting on you" },
  { id: "c", title: "Intake from Outlook", sub: "3 new items" },
];

export function DesignGallery() {
  const [active, setActive] = useState("a");
  const [dark, setDark] = useState(false);
  const [busy, setBusy] = useState(true);

  return (
    <div className="bg-surface text-ink fixed inset-0 overflow-auto">
      <div className="fixed inset-0">
        <Wallpaper />
      </div>
      <SettingsMenu />

      <div className="relative mx-auto grid max-w-[1180px] grid-cols-1 gap-4 px-6 pt-8 pb-24 md:grid-cols-3">
        {/* Window mock: glass-win + brand-bar + headline */}
        <div className="md:col-span-3">
          <div className="shadow-window-focus rounded-surface">
            <div className="glass-win brand-bar rounded-surface relative overflow-hidden">
              <div className="h-titlebar flex items-center gap-2.5 px-4.5">
                <span className="bg-accent-soft text-accent-ink grid h-[30px] w-[30px] place-items-center rounded-[10px]">
                  <SparkleIcon size={16} />
                </span>
                <span className="text-sm font-semibold">Design system</span>
              </div>
              <div className="flex flex-wrap items-end gap-4 px-6 pt-1.5 pb-5">
                <div>
                  <h2 className="font-headline text-[30px] leading-tight tracking-tight">
                    Your <span className="accent-word">tasks</span>, calmly
                  </h2>
                  <p className="text-ink-muted mt-1 text-sm">
                    Frosted glass, three radius tiers, 36px controls.
                  </p>
                </div>
                <Tabs defaultValue="all" className="ml-auto">
                  <TabsList>
                    <TabsTrigger value="all" count={12}>
                      All
                    </TabsTrigger>
                    <TabsTrigger value="mine" count={3}>
                      Mine
                    </TabsTrigger>
                    <TabsTrigger value="done">Done</TabsTrigger>
                  </TabsList>
                  <TabsContent value="all" />
                </Tabs>
              </div>
            </div>
          </div>
        </div>

        <Section title="Buttons">
          <div className="flex flex-wrap items-center gap-2.5">
            <Button>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Line</Button>
            <Button variant="ghost">Ghost</Button>
            <Button disabled>Disabled</Button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2.5">
            <Button size="sm">
              <PlusIcon size={14} weight="bold" />
              Small
            </Button>
            <Button size="lg">Large</Button>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Tooltip label="Notifications">
              <IconButton aria-label="Notifications">
                <BellIcon />
              </IconButton>
            </Tooltip>
            <IconButton aria-label="Settings" variant="secondary">
              <GearSixIcon />
            </IconButton>
            <IconButton aria-label="Add" variant="solid" shape="round">
              <PlusIcon />
            </IconButton>
            <IconButton aria-label="Delete" variant="outline">
              <TrashIcon />
            </IconButton>
          </div>
        </Section>

        <Section title="Badges">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>Neutral</Badge>
            <Badge variant="accent">Accent</Badge>
            <Badge variant="outline">Outline</Badge>
            <Badge variant="success" dot>
              Done
            </Badge>
            <Badge variant="warning" dot pulse>
              Needs you
            </Badge>
            <Badge variant="danger" dot>
              Failed
            </Badge>
            <Badge variant="info">Outlook</Badge>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Badge variant="accent" dot pulse fixedWidth>
              Running
            </Badge>
            <Badge variant="neutral" fixedWidth>
              Idle
            </Badge>
          </div>
        </Section>

        <Section title="Form controls">
          <div className="flex flex-col gap-3">
            <Input placeholder="Search tasks..." aria-label="Search tasks" />
            <label className="flex items-center justify-between text-sm">
              Dark preview
              <Switch
                checked={dark}
                onCheckedChange={setDark}
                aria-label="Dark preview"
              />
            </label>
            <label className="flex items-center justify-between text-sm">
              Notifications
              <Switch defaultChecked aria-label="Notifications" />
            </label>
            <Slider defaultValue={[62]} max={100} aria-label="Volume" />
            <div className="flex items-center gap-3">
              <Avatar fallback="JL" presence="active" />
              <Avatar fallback="MK" presence="idle" />
              <Avatar fallback="SR" size="lg" />
              <Avatar fallback="AI" size="sm" />
            </div>
          </div>
        </Section>

        <Section title="Progress">
          <div className="flex flex-col gap-5">
            <Progress value={42} state="run" label="Reading the inbox" showPercent />
            <Progress value={68} state="gate" label="Waiting for approval" showPercent />
            <Progress value={30} state="err" label="Failed at step 3" showPercent />
            <Progress value={100} state="ok" label="Complete" showPercent />
          </div>
        </Section>

        <Section title="List rows (row-bar + morph)">
          <div className="flex flex-col gap-1" role="listbox" aria-label="Rows">
            {rows.map((r) => (
              <button
                key={r.id}
                type="button"
                role="option"
                aria-selected={active === r.id}
                data-active={active === r.id}
                onClick={() => setActive(r.id)}
                className="row-bar morph-host rounded-control hover:bg-chip data-[active=true]:bg-accent-soft transition-ui flex h-[52px] items-center gap-3.5 px-3.5 text-left"
              >
                <span className="morph bg-chip text-ink-soft grid h-[34px] w-[34px] place-items-center">
                  <FolderIcon size={18} />
                </span>
                <span className="flex-1">
                  <span className="block text-sm leading-tight font-semibold">
                    {r.title}
                  </span>
                  <span className="text-ink-muted text-[12.5px]">{r.sub}</span>
                </span>
              </button>
            ))}
          </div>
        </Section>

        <Section title="Overlays">
          <div className="flex flex-wrap gap-2.5">
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="secondary">Dialog</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogTitle>Rename task</DialogTitle>
                <DialogDescription>
                  Blurred scrim, 24px surface, spring in.
                </DialogDescription>
                <Input
                  className="mt-4"
                  defaultValue="Quarterly roster review"
                  aria-label="Name"
                />
                <DialogFooter>
                  <Button variant="ghost">Cancel</Button>
                  <Button>Save</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="secondary">Popover</Button>
              </PopoverTrigger>
              <PopoverContent>
                <p className="text-sm font-semibold">Frosted popover</p>
                <p className="text-ink-muted mt-1 text-[13px]">
                  Heavier blur, deep shadow.
                </p>
              </PopoverContent>
            </Popover>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary">Menu</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                <DropdownMenuItem>
                  <NotePencilIcon size={16} /> New note
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <GlobeIcon size={16} /> Open browser
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <Button variant="outline">Right-click me</Button>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem>Refresh</ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          </div>
        </Section>

        <Section title="AI ring + glass chrome">
          <div className="flex flex-col gap-4">
            <button
              type="button"
              onClick={() => setBusy((b) => !b)}
              className={cn(
                "glass ai-ring rounded-bar flex h-[58px] items-center gap-3 px-5 text-left text-[15px] font-medium",
                !busy && "[--ai-ring-opacity:0]",
              )}
            >
              <SparkleIcon size={18} className="text-accent-ink" />
              <span className="text-ink-muted">
                Ask AI to do something... (click toggles ring)
              </span>
            </button>
            <div className="flex gap-3">
              {[FolderIcon, NotePencilIcon, GlobeIcon].map((Icon, i) => (
                <button
                  key={i}
                  type="button"
                  aria-label={`Tile ${i + 1}`}
                  data-active={i === 1}
                  className="morph bg-chip text-ink-soft grid h-[46px] w-[46px] place-items-center"
                >
                  <Icon size={20} />
                </button>
              ))}
            </div>
          </div>
        </Section>

        <Section title="Scroll area">
          <ScrollArea className="h-32">
            <div className="pr-3 text-sm">
              {Array.from({ length: 12 }, (_, i) => (
                <p key={i} className="text-ink-soft py-1">
                  Line {i + 1} - themed scrollbar thumb
                </p>
              ))}
            </div>
          </ScrollArea>
        </Section>
      </div>
    </div>
  );
}
