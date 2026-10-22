import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "danger";

const base =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border-2 px-5 py-3 text-lg font-semibold " +
  "text-center no-underline disabled:cursor-not-allowed disabled:opacity-50";

const variants: Record<Variant, string> = {
  primary: "border-primary bg-primary text-primary-fg",
  secondary: "border-fg bg-bg text-fg",
  danger: "border-danger bg-danger text-danger-fg",
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant };

export function Button({ variant = "primary", className = "", type = "button", ...props }: ButtonProps) {
  return <button type={type} className={`${base} ${variants[variant]} ${className}`} {...props} />;
}

type LinkButtonProps = { href: string; children: ReactNode; variant?: Variant; className?: string };

export function LinkButton({ href, children, variant = "primary", className = "" }: LinkButtonProps) {
  return (
    <Link href={href} className={`${base} ${variants[variant]} ${className}`}>
      {children}
    </Link>
  );
}
