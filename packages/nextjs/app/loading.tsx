export default function Loading() {
  return (
    <div
      className="flex min-h-[50vh] w-full flex-col gap-0 px-6 py-6"
      role="status"
      aria-label="Loading page"
    >
      <div className="mb-8 flex animate-pulse items-center gap-4 border-b border-border pb-4">
        <div className="h-9 w-9 rounded-lg bg-muted" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-40 rounded bg-muted" />
          <div className="h-3 w-28 rounded bg-muted/70" />
        </div>
        <div className="h-9 w-28 rounded-md bg-muted" />
      </div>
      <div className="mx-auto w-full max-w-2xl space-y-4">
        <div className="h-32 rounded-lg border border-border bg-card p-4">
          <div className="mb-3 h-3 w-24 rounded bg-muted" />
          <div className="space-y-2">
            <div className="h-3 w-full rounded bg-muted/60" />
            <div className="h-3 w-[90%] rounded bg-muted/60" />
            <div className="h-3 w-[70%] rounded bg-muted/60" />
          </div>
        </div>
        <div className="h-24 rounded-lg border border-border bg-card p-4">
          <div className="h-3 w-32 rounded bg-muted" />
        </div>
      </div>
    </div>
  );
}
