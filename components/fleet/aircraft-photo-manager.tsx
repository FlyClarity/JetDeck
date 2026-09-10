"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";

export function AircraftPhotoManager({
  photos,
  uploadAction,
  removeAction,
  setCoverAction,
}: {
  photos: string[];
  uploadAction: (
    prevState: { error: string } | null,
    formData: FormData
  ) => Promise<{ error: string } | null>;
  removeAction: (url: string) => Promise<void>;
  setCoverAction: (url: string) => Promise<void>;
}) {
  const [state, formAction, pending] = useActionState(uploadAction, null);

  return (
    <div className="flex flex-col gap-3">
      {photos.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {photos.map((url, i) => (
            <div
              key={url}
              className="group relative aspect-video overflow-hidden rounded-md border border-border"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="" className="h-full w-full object-cover" />
              {i === 0 ? (
                <span className="absolute top-1 left-1 rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">
                  Cover
                </span>
              ) : (
                <form
                  action={setCoverAction.bind(null, url)}
                  className="absolute top-1 left-1 opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <Button type="submit" size="sm" variant="secondary" className="h-6 px-2 text-xs">
                    Set as cover
                  </Button>
                </form>
              )}
              <form
                action={removeAction.bind(null, url)}
                className="absolute top-1 right-1 opacity-0 transition-opacity group-hover:opacity-100"
              >
                <Button type="submit" size="sm" variant="destructive" className="h-6 px-2 text-xs">
                  Remove
                </Button>
              </form>
            </div>
          ))}
        </div>
      )}

      <form action={formAction} className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <input
            type="file"
            name="photos"
            accept="image/*"
            multiple
            required
            className="text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium"
          />
          <Button type="submit" variant="outline" size="sm" disabled={pending}>
            {pending ? "Uploading…" : "Upload"}
          </Button>
        </div>
        {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
      </form>
    </div>
  );
}
