import { deletePhoto, getPhoto, putPhoto } from "@/lib/staff/server";
import { MAX_PHOTO_BYTES } from "@/lib/staff/photo";
import { readCappedBytes, staffHandler } from "@/lib/staff/http";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** GET /api/staff/photos/<employeeId> -> the image, or 404. */
export function GET(request: Request, context: Context) {
  return staffHandler(request, async () => {
    const { id } = await context.params;
    const photo = await getPhoto(id);
    if (!photo) return new Response(null, { status: 404 });
    return new Response(Buffer.from(photo.bytes), {
      headers: {
        "Content-Type": photo.type,
        // The employee's photoVersion is in the URL, so a new photo is a new URL.
        "Cache-Control": "private, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}

/** PUT /api/staff/photos/<employeeId> with the raw JPEG / PNG / WebP bytes (max 1 MB). */
export function PUT(request: Request, context: Context) {
  return staffHandler(request, async () => {
    const { id } = await context.params;
    await putPhoto(id, await readCappedBytes(request, MAX_PHOTO_BYTES));
    return {};
  });
}

/** DELETE /api/staff/photos/<employeeId>. */
export function DELETE(request: Request, context: Context) {
  return staffHandler(request, async () => {
    const { id } = await context.params;
    await deletePhoto(id);
    return {};
  });
}
