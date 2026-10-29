"use client";

/** Last resort for an error in the root layout itself, where no theme or
 *  component library is guaranteed to have loaded, so it uses plain markup. */
export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          fontFamily: "system-ui, sans-serif",
          textAlign: "center",
        }}
      >
        <div role="alert">
          <h1>Something went wrong</h1>
          <p>AI OS hit an unexpected problem. Your data is safe.</p>
          <button type="button" onClick={reset}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
