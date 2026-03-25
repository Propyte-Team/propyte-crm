// Widget de tareas vencidas — Design System v2
"use client"

import { useState, useEffect } from "react"
import { differenceInDays, format } from "date-fns"
import { AlertTriangle, CheckCircle2, Check } from "lucide-react"

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

  useEffect(() => {
    fetchTasks()
  }, [])

  async function fetchTasks() {
    try {
      const res = await fetch("/api/activities?status=PENDIENTE&activityType=TASK&sortBy=dueDate&sortOrder=asc&pageSize=20")
      if (res.ok) {
        const json = await res.json()
        const now = new Date()
        const overdue = (json.data ?? []).filter(
          (t: OverdueTask) => t.dueDate && new Date(t.dueDate) < now
        )
        setTasks(overdue)
      }
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }

  async function handleComplete(taskId: string) {
    setCompletingId(taskId)
    try {
      const res = await fetch(`/api/activities`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: taskId, status: "COMPLETADA" }),
      })
      if (res.ok) {
        setTasks((prev) => prev.filter((t) => t.id !== taskId))
      }
    } catch {
      // silent
    } finally {
      setCompletingId(null)
    }
  }

  if (loading) {
    return (
      <div className="crm-card">
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle className="h-4 w-4" style={{ color: "var(--color-error)" }} />
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Tareas Vencidas</h3>
        </div>
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-12 rounded-md animate-pulse" style={{ background: "var(--bg-input)" }} />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="crm-card">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" style={{ color: "var(--color-error)" }} />
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Tareas Vencidas</h3>
        </div>
        {tasks.length > 0 && (
          <span className="badge badge-error">{tasks.length}</span>
        )}
      </div>

      {tasks.length === 0 ? (
        <div className="flex items-center gap-2 py-3 text-sm" style={{ color: "var(--text-secondary)" }}>
          <CheckCircle2 className="h-4 w-4" style={{ color: "var(--color-success)" }} />
          Sin tareas vencidas
        </div>
      ) : (
        <div className="space-y-2 max-h-[300px] overflow-y-auto">
          {tasks.map((task) => {
            const dueDate = new Date(task.dueDate)
            const daysOverdue = differenceInDays(new Date(), dueDate)

            return (
              <div
                key={task.id}
                className="flex items-center justify-between rounded-lg p-3"
                style={{ background: "var(--color-error-bg)", border: "1px solid rgba(239, 68, 68, 0.15)" }}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium truncate" style={{ color: "var(--text-primary)" }}>{task.subject}</p>
                  <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                    {task.contact.firstName} {task.contact.lastName}
                  </p>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-[11px] font-medium" style={{ color: "var(--color-error)" }}>
                      {format(dueDate, "dd/MM/yy")}
                    </span>
                    <span className="badge badge-error text-[10px]">
                      {daysOverdue === 0 ? "Hoy" : `${daysOverdue}d vencida`}
                    </span>
                  </div>
                </div>
                <button
                  className="ml-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors"
                  style={{ background: "var(--color-success-bg)", color: "var(--color-success)" }}
                  disabled={completingId === task.id}
                  onClick={() => handleComplete(task.id)}
                  title="Completar"
                >
                  <Check className="h-4 w-4" />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
