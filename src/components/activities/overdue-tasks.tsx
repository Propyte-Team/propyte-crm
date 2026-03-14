// ============================================================
// Widget de tareas vencidas para el dashboard
// Lista de tareas pendientes con fecha vencida y botón completar
// ============================================================
"use client"

import { useState, useEffect } from "react"
import { differenceInDays, format } from "date-fns"
import { AlertTriangle, CheckCircle2 } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { ScrollArea } from "@/components/ui/scroll-area"

// Interfaz de tarea vencida
interface OverdueTask {
  id: string
  subject: string
  dueDate: string
  contact: { id: string; firstName: string; lastName: string }
  user: { id: string; name: string }
}

export function OverdueTasks() {
  const [tasks, setTasks] = useState<OverdueTask[]>([])
  const [loading, setLoading] = useState(true)
  const [completingId, setCompletingId] = useState<string | null>(null)

  // Cargar tareas vencidas
  useEffect(() => {
    fetchTasks()
  }, [])

  async function fetchTasks() {
    try {
      const res = await fetch("/api/activities?status=PENDIENTE&activityType=TASK&sortBy=dueDate&sortOrder=asc&pageSize=20")
      if (res.ok) {
        const json = await res.json()
        // Filtrar solo las que tienen dueDate < ahora
        const now = new Date()
        const overdue = (json.data ?? []).filter(
          (t: OverdueTask) => t.dueDate && new Date(t.dueDate) < now
        )
        setTasks(overdue)
      }
    } catch {
      // Error silencioso
    } finally {
      setLoading(false)
    }
  }

  // Completar una tarea
  async function handleComplete(taskId: string) {
    setCompletingId(taskId)
    try {
      const res = await fetch(`/api/activities`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: taskId, status: "COMPLETADA" }),
      })
      if (res.ok) {
        // Remover de la lista
        setTasks((prev) => prev.filter((t) => t.id !== taskId))
      }
    } catch {
      // Error silencioso
    } finally {
      setCompletingId(null)
    }
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Tareas Vencidas</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-sm">
            <AlertTriangle className="h-4 w-4 text-red-500" />
            Tareas Vencidas
          </CardTitle>
          {tasks.length > 0 && (
            <Badge variant="destructive" className="text-xs">
              {tasks.length}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {tasks.length === 0 ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            Sin tareas vencidas
          </div>
        ) : (
          <ScrollArea className="max-h-[300px]">
            <div className="space-y-2">
              {tasks.map((task) => {
                const dueDate = new Date(task.dueDate)
                const daysOverdue = differenceInDays(new Date(), dueDate)

                return (
                  <div
                    key={task.id}
                    className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 p-3"
                  >
                    <div className="flex-1 min-w-0">
                      {/* Asunto de la tarea */}
                      <p className="text-sm font-medium truncate">{task.subject}</p>
                      {/* Contacto asociado */}
                      <p className="text-xs text-muted-foreground">
                        {task.contact.firstName} {task.contact.lastName}
                      </p>
                      {/* Fecha de vencimiento y días vencida */}
                      <div className="mt-1 flex items-center gap-2">
                        <span className="text-xs text-red-600 font-medium">
                          {format(dueDate, "dd/MM/yy")}
                        </span>
                        <Badge variant="destructive" className="text-[10px] px-1 py-0">
                          {daysOverdue === 0 ? "Hoy" : `${daysOverdue}d vencida`}
                        </Badge>
                      </div>
                    </div>

                    {/* Botón completar */}
                    <Button
                      variant="outline"
                      size="sm"
                      className="ml-2 shrink-0 border-green-300 text-green-700 hover:bg-green-50"
                      disabled={completingId === task.id}
                      onClick={() => handleComplete(task.id)}
                    >
                      {completingId === task.id ? "..." : "Completar"}
                    </Button>
                  </div>
                )
              })}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  )
}
