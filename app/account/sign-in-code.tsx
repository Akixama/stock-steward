'use client';
import { useState } from "react";

// The sign-in code is the owner's session token by another name: pasting it at the sign-in
// screen on another address or device continues this exact workspace.
export default function SignInCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return <div className="account-code-row">
    <input readOnly value={code} aria-label="Sign-in code" spellCheck={false}
      onFocus={(event) => event.currentTarget.select()} />
    <button type="button" onClick={() => {
      navigator.clipboard.writeText(code).then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      }).catch(() => { /* Selecting the field manually still works. */ });
    }}>{copied ? "Copied" : "Copy"}</button>
  </div>;
}
