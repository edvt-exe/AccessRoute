// screen readers only announce changes, so the region has to exist before the text changes
export function LiveRegion({ message, assertive }: { message: string; assertive?: boolean }) {
  return (
    <div role={assertive ? "alert" : "status"} aria-live={assertive ? "assertive" : "polite"} aria-atomic="true" className="sr-only">
      {message}
    </div>
  );
}
