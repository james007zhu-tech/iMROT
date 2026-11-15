"use client";
/**
 * A password box with an eye: on a phone the surest way to know what was typed is to look at it
 * (2026-11-15: "same password" failed on the phone, and nobody could see what the phone had sent).
 */
import { useState } from "react";

export function PasswordInput({ label, ...props }: Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & { label: { show: string; hide: string } }) {
  const [shown, setShown] = useState(false);
  return (
    <span className="relative block">
      <input {...props} type={shown ? "text" : "password"} autoCapitalize="none" autoCorrect="off" spellCheck={false} className={`${props.className ?? ""} pr-14`} />
      <button type="button" onClick={() => setShown((s) => !s)} aria-pressed={shown} className="absolute inset-y-0 right-0 px-3 text-xs text-blue">{shown ? label.hide : label.show}</button>
    </span>
  );
}
