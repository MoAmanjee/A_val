"use client";

import { useState } from "react";

export function PayfastTemplateCopy({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="payfast-guide-template-wrap">
      <pre className="payfast-guide-template">{text}</pre>
      <button
        type="button"
        className="payfast-guide-copy"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
          } catch {
            /* select manually */
          }
        }}
      >
        {copied ? "Copied" : "Copy template"}
      </button>
    </div>
  );
}
