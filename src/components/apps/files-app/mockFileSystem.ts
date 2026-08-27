/**
 * Plain, framework-agnostic mock file tree — no live component/icon values
 * live here (see FileRow.tsx for the `kind` -> Phosphor icon mapping), so
 * this file never needs "use client" itself. Same data/presentation split
 * as the App Store's `types.ts` (plain shapes) vs `appCatalog.ts` (the one
 * file that actually imports live icon components).
 *
 * Static and read-only: FilesApp only ever walks this tree to render the
 * current folder's children and build the breadcrumb, it never mutates it.
 */

export type FileKind =
  "document" | "image" | "code" | "pdf" | "audio" | "archive" | "spreadsheet" | "text";

export interface FileSystemFile {
  id: string;
  name: string;
  type: "file";
  kind: FileKind;
  sizeLabel: string;
  modifiedLabel: string;
}

export interface FileSystemFolder {
  id: string;
  name: string;
  type: "folder";
  modifiedLabel: string;
  children: FileSystemNode[];
}

export type FileSystemNode = FileSystemFile | FileSystemFolder;

export const fileSystemRoot: FileSystemFolder = {
  id: "root",
  name: "Home",
  type: "folder",
  modifiedLabel: "—",
  children: [
    {
      id: "documents",
      name: "Documents",
      type: "folder",
      modifiedLabel: "Aug 12, 2026",
      children: [
        {
          id: "documents-resume",
          name: "Resume.docx",
          type: "file",
          kind: "document",
          sizeLabel: "48 KB",
          modifiedLabel: "Jul 2, 2026",
        },
        {
          id: "documents-cover-letter",
          name: "Cover-Letter.docx",
          type: "file",
          kind: "document",
          sizeLabel: "22 KB",
          modifiedLabel: "Jul 2, 2026",
        },
        {
          id: "documents-taxes",
          name: "Taxes",
          type: "folder",
          modifiedLabel: "Apr 14, 2026",
          children: [
            {
              id: "documents-taxes-return",
              name: "2025-return.pdf",
              type: "file",
              kind: "pdf",
              sizeLabel: "1.1 MB",
              modifiedLabel: "Apr 14, 2026",
            },
            {
              id: "documents-taxes-receipts",
              name: "receipts.zip",
              type: "file",
              kind: "archive",
              sizeLabel: "3.4 MB",
              modifiedLabel: "Apr 2, 2026",
            },
          ],
        },
      ],
    },
    {
      id: "photos",
      name: "Photos",
      type: "folder",
      modifiedLabel: "Aug 20, 2026",
      children: [
        {
          id: "photos-img-0142",
          name: "IMG_0142.jpg",
          type: "file",
          kind: "image",
          sizeLabel: "3.2 MB",
          modifiedLabel: "Aug 20, 2026",
        },
        {
          id: "photos-img-0143",
          name: "IMG_0143.jpg",
          type: "file",
          kind: "image",
          sizeLabel: "2.9 MB",
          modifiedLabel: "Aug 20, 2026",
        },
        {
          id: "photos-vacation",
          name: "Vacation",
          type: "folder",
          modifiedLabel: "Jun 30, 2026",
          children: [
            {
              id: "photos-vacation-beach",
              name: "beach-sunset.jpg",
              type: "file",
              kind: "image",
              sizeLabel: "4.1 MB",
              modifiedLabel: "Jun 30, 2026",
            },
            {
              id: "photos-vacation-hiking",
              name: "hiking-trail.jpg",
              type: "file",
              kind: "image",
              sizeLabel: "3.8 MB",
              modifiedLabel: "Jun 29, 2026",
            },
          ],
        },
      ],
    },
    {
      id: "projects",
      name: "Projects",
      type: "folder",
      modifiedLabel: "Aug 26, 2026",
      children: [
        {
          id: "projects-ai-os",
          name: "ai-os",
          type: "folder",
          modifiedLabel: "Aug 26, 2026",
          children: [
            {
              id: "projects-ai-os-readme",
              name: "README.md",
              type: "file",
              kind: "text",
              sizeLabel: "6 KB",
              modifiedLabel: "Aug 26, 2026",
            },
            {
              id: "projects-ai-os-index",
              name: "index.ts",
              type: "file",
              kind: "code",
              sizeLabel: "1 KB",
              modifiedLabel: "Aug 25, 2026",
            },
            {
              id: "projects-ai-os-app",
              name: "App.tsx",
              type: "file",
              kind: "code",
              sizeLabel: "4 KB",
              modifiedLabel: "Aug 24, 2026",
            },
          ],
        },
        {
          id: "projects-budget",
          name: "budget.xlsx",
          type: "file",
          kind: "spreadsheet",
          sizeLabel: "88 KB",
          modifiedLabel: "Aug 10, 2026",
        },
      ],
    },
    {
      id: "music",
      name: "Music",
      type: "folder",
      modifiedLabel: "May 3, 2026",
      children: [
        {
          id: "music-morning-drive",
          name: "morning-drive.mp3",
          type: "file",
          kind: "audio",
          sizeLabel: "5.6 MB",
          modifiedLabel: "May 3, 2026",
        },
        {
          id: "music-late-night",
          name: "late-night.mp3",
          type: "file",
          kind: "audio",
          sizeLabel: "6.1 MB",
          modifiedLabel: "May 3, 2026",
        },
      ],
    },
    {
      id: "read-me",
      name: "Read-Me.txt",
      type: "file",
      kind: "text",
      sizeLabel: "2 KB",
      modifiedLabel: "Jan 4, 2026",
    },
  ],
};
