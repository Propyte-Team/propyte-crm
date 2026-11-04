// Confirmaciones con Dialog en lugar de window.confirm (E1 #962).
//
// Uso:
//   const confirmar = useConfirm()
//   if (!(await confirmar({ titulo: "¿Eliminar regla?", peligroso: true, confirmar: "Eliminar" }))) return
//
// Para avisos usa toast() (use-toast.ts); para confirmaciones useConfirm().
// <ConfirmProvider> ya está montado en el layout del dashboard: un solo diálogo para toda la app.
// Enter confirma (el botón de confirmar recibe el foco) y Escape cancela (Radix).
"use client"

import * as React from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { resolverOpciones, type ConfirmOptions, type ConfirmProps } from "@/components/ui/confirm-dialog-model"

export type { ConfirmOptions }
type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>

const ConfirmContext = React.createContext<ConfirmFn | null>(null)

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [props, setProps] = React.useState<ConfirmProps | null>(null)
  const resolver = React.useRef<((v: boolean) => void) | null>(null)

  const confirmar = React.useCallback<ConfirmFn>((opts) => {
    // Si ya había una abierta, se cancela para no dejar promesas colgadas
    resolver.current?.(false)
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve
      setProps(resolverOpciones(opts))
    })
  }, [])

  const cerrar = React.useCallback((valor: boolean) => {
    resolver.current?.(valor)
    resolver.current = null
    setProps(null)
  }, [])

  return (
    <ConfirmContext.Provider value={confirmar}>
      {children}
      <Dialog open={props !== null} onOpenChange={(abierto) => { if (!abierto) cerrar(false) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{props?.titulo}</DialogTitle>
            {/* DialogDescription siempre presente: Radix avisa de accesibilidad si falta */}
            <DialogDescription className={props?.descripcion ? undefined : "sr-only"}>
              {props?.descripcion ?? props?.titulo}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => cerrar(false)}>
              {props?.cancelar}
            </Button>
            {/* autoFocus: así Enter dispara la confirmación */}
            <Button
              autoFocus
              variant={props?.peligroso ? "destructive" : "default"}
              onClick={() => cerrar(true)}
            >
              {props?.confirmar}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConfirmContext.Provider>
  )
}

export function useConfirm(): ConfirmFn {
  const ctx = React.useContext(ConfirmContext)
  if (!ctx) throw new Error("useConfirm debe usarse dentro de <ConfirmProvider>")
  return ctx
}
