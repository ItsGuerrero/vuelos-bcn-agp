"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", label: "Viajes", icon: "✈️", match: (p: string) => p === "/" || (p.startsWith("/seguimientos/") && !p.endsWith("/nuevo")) },
  { href: "/ofertas", label: "Ofertas", icon: "🔥", match: (p: string) => p.startsWith("/ofertas") },
  { href: "/seguimientos/nuevo", label: "Nuevo", icon: "＋", match: (p: string) => p === "/seguimientos/nuevo" },
  { href: "/cuenta", label: "Cuenta", icon: "👤", match: (p: string) => p.startsWith("/cuenta") },
];

/** Barra de navegación inferior (móvil primero). */
export function BottomNav() {
  const path = usePathname();
  if (path.startsWith("/login") || path.startsWith("/pareja")) return null;
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface/95 backdrop-blur pb-[env(safe-area-inset-bottom)]">
      <ul className="mx-auto grid max-w-lg grid-cols-4">
        {ITEMS.map((it) => {
          const active = it.match(path);
          return (
            <li key={it.href}>
              <Link
                href={it.href}
                className={`flex flex-col items-center gap-0.5 py-2 text-xs font-medium ${active ? "text-accent" : "text-muted"}`}
              >
                <span className="text-lg leading-none">{it.icon}</span>
                {it.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
