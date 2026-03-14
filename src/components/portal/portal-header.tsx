// Header del portal de desarrollador externo
// Muestra logo PROPYTE, título y botón de cerrar sesión
"use client";

import { signOut } from "next-auth/react";
import { LogOut } from "lucide-react";

interface PortalHeaderProps {
  userName: string;
}

export function PortalHeader({ userName }: PortalHeaderProps) {
  return (
    <header className="border-b bg-white shadow-sm">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
        {/* Logo y título */}
        <div className="flex items-center gap-3">
          <span className="text-xl font-bold text-[#1E3A5F]">PROPYTE</span>
          <span className="hidden text-sm text-gray-500 sm:inline">|</span>
          <span className="hidden text-sm font-medium text-gray-600 sm:inline">
            Portal de Desarrollador
          </span>
        </div>

        {/* Usuario y logout */}
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-700">{userName}</span>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="flex items-center gap-2 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 transition-colors hover:bg-gray-100"
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">Cerrar sesión</span>
          </button>
        </div>
      </div>
    </header>
  );
}
