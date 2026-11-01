"use client";

import { useEffect, useState } from "react";
import { FlaskIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui";

const NOTE_SEEN_KEY = "ai-os:files-demo-note-seen";

function readSeen(): boolean {
  try {
    return localStorage.getItem(NOTE_SEEN_KEY) === "1";
  } catch {
    return true;
  }
}

/**
 * Files is a demo: this strip is always shown (no close button) so nobody
 * mistakes the sample tree for their real files. The longer explanation shows
 * once, until "Got it" is pressed.
 */
export function SampleFilesBanner() {
  // Start hidden so server and first client render agree; reveal after mount.
  const [showNote, setShowNote] = useState(false);
  useEffect(() => setShowNote(!readSeen()), []);

  function dismissNote() {
    try {
      localStorage.setItem(NOTE_SEEN_KEY, "1");
    } catch {
      /* the note simply shows again next time */
    }
    setShowNote(false);
  }

  return (
    <div className="px-gutter pb-3">
      <div
        role="note"
        className="bg-accent-soft text-accent-ink rounded-control flex items-start gap-2.5 px-3.5 py-2.5 text-[13px]"
      >
        <FlaskIcon size={18} weight="fill" aria-hidden className="mt-px shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Sample files - demo, not your real files</p>
          {showNote && (
            <p className="text-ink-soft mt-0.5 leading-snug">
              The folders and files here are examples to show how Files will look. Nothing
              on this computer is listed, and nothing you do here changes it.
            </p>
          )}
        </div>
        {showNote && (
          <Button variant="ghost" size="sm" onClick={dismissNote}>
            Got it
          </Button>
        )}
      </div>
    </div>
  );
}
