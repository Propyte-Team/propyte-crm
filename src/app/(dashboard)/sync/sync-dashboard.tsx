"use client";

import * as React from "react";
import {
  FolderSync,
  Plus,
  Play,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  ChevronDown,
  ChevronRight,
  HardDrive,
  Droplets,
  FileSpreadsheet,
  FileImage,
  FileText,
  AlertTriangle,
  Info,
  ExternalLink,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

// ---- Types ----

interface MonitoredFolder {
  id: string;
  provider: "GOOGLE_DRIVE" | "DROPBOX";
  externalFolderId: string;
  folderName: string;
  folderUrl?: string;
  plaza: string;
  developmentType: string;
  isActive: boolean;
  syncInterval: number;
  lastSyncAt?: string;
  lastSyncStatus?: string;
  development?: { id: string; name: string; status: string } | null;
  _count: { syncJobs: number; syncFiles: number };
  syncJobs: Array<{
    id: string;
    status: string;
    filesDiscovered: number;
    filesNew: number;
    unitsCreated: number;
    unitsUpdated: number;
    error?: string;
    startedAt: string;
    completedAt?: string;
  }>;
}

interface SyncJob {
  id: string;
  monitoredFolderId: string;
  status: string;
  triggeredBy: string;
  developmentId?: string;
  filesDiscovered: number;
  filesNew: number;
  filesModified: number;
  unitsCreated: number;
  unitsUpdated: number;
  imagesProcessed: number;
  error?: string;
  startedAt: string;
  completedAt?: string;
  monitoredFolder: { folderName: string; provider: string };
  _count: { logs: number };
}

interface SyncLog {
  id: string;
  step: string;
  level: string;
  message: string;
  data?: Record<string, unknown>;
  createdAt: string;
}

interface JobDetail extends SyncJob {
  crawlData?: Record<string, unknown>;
  parseData?: Record<string, unknown>;
  mapData?: Record<string, unknown>;
  uploadData?: Record<string, unknown>;
  logs: SyncLog[];
}

// ---- Main Component ----

export function SyncDashboard() {
  const [folders, setFolders] = React.useState<MonitoredFolder[]>([]);
  const [jobs, setJobs] = React.useState<SyncJob[]>([]);
  const [selectedJob, setSelectedJob] = React.useState<JobDetail | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [showAddFolder, setShowAddFolder] = React.useState(false);
  const [showBulkImport, setShowBulkImport] = React.useState(false);
  const [selectedFolder, setSelectedFolder] = React.useState<MonitoredFolder | null>(null);
  const [syncing, setSyncing] = React.useState<string | null>(null);
  const [activeTab, setActiveTab] = React.useState<"folders" | "jobs" | "logs">(
    "folders"
  );

  // Fetch initial data
  React.useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [foldersRes, jobsRes] = await Promise.all([
        fetch("/api/sync/folders"),
        fetch("/api/sync/jobs?limit=50"),
      ]);
      const foldersData = await foldersRes.json();
      const jobsData = await jobsRes.json();
      setFolders(foldersData.data || []);
      setJobs(jobsData.data || []);
    } catch (err) {
      console.error("Error loading sync data:", err);
    } finally {
      setLoading(false);
    }
  }

  async function triggerSync(folderId: string) {
    setSyncing(folderId);
    try {
      const res = await fetch("/api/sync/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monitoredFolderId: folderId }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Error al iniciar sync");
        return;
      }
      // Reload data after short delay
      setTimeout(loadData, 1000);
    } catch (err) {
      console.error("Error triggering sync:", err);
    } finally {
      setSyncing(null);
    }
  }

  async function loadJobDetail(jobId: string) {
    try {
      const res = await fetch(`/api/sync/jobs/${jobId}`);
      const data = await res.json();
      setSelectedJob(data.data);
      setActiveTab("logs");
    } catch (err) {
      console.error("Error loading job detail:", err);
    }
  }

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Sincronizacion Drive / Dropbox
          </h1>
          <p className="text-muted-foreground">
            Conecta carpetas de desarrolladores para importar propiedades
            automaticamente
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={loadData}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Actualizar
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowBulkImport(true)}>
            <FileSpreadsheet className="mr-2 h-4 w-4" />
            Importar CSV
          </Button>
          <Button size="sm" onClick={() => setShowAddFolder(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Agregar
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <StatCard
          title="Carpetas Activas"
          value={folders.filter((f) => f.isActive).length}
          icon={<FolderSync className="h-4 w-4" />}
          description={`${folders.length} total`}
        />
        <StatCard
          title="Syncs Completados"
          value={jobs.filter((j) => j.status === "COMPLETED").length}
          icon={<CheckCircle2 className="h-4 w-4 text-green-500" />}
          description="Exitosos"
        />
        <StatCard
          title="Syncs Fallidos"
          value={jobs.filter((j) => j.status === "FAILED").length}
          icon={<XCircle className="h-4 w-4 text-red-500" />}
          description="Con error"
        />
        <StatCard
          title="En Progreso"
          value={
            jobs.filter((j) =>
              ["PENDING", "CRAWLING", "PARSING", "MAPPING", "UPLOADING"].includes(
                j.status
              )
            ).length
          }
          icon={<Loader2 className="h-4 w-4 animate-spin" />}
          description="Ahora mismo"
        />
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 rounded-lg bg-muted p-1">
        {(
          [
            { key: "folders", label: "Carpetas Monitoreadas" },
            { key: "jobs", label: "Historial de Syncs" },
            { key: "logs", label: "Logs en Detalle" },
          ] as const
        ).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              "flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              activeTab === tab.key
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === "folders" && (
        <FoldersTab
          folders={folders}
          syncing={syncing}
          onSync={triggerSync}
          onViewJobs={(folderId) => {
            setJobs((prev) =>
              prev.filter((j) => j.monitoredFolderId === folderId)
            );
            setActiveTab("jobs");
            fetch(`/api/sync/jobs?folderId=${folderId}&limit=50`)
              .then((r) => r.json())
              .then((d) => setJobs(d.data || []));
          }}
          onSelectFolder={(folder) => setSelectedFolder(folder)}
          onReload={loadData}
        />
      )}

      {activeTab === "jobs" && (
        <JobsTab
          jobs={jobs}
          onViewLogs={loadJobDetail}
          onReloadAll={() => {
            fetch("/api/sync/jobs?limit=50")
              .then((r) => r.json())
              .then((d) => setJobs(d.data || []));
          }}
        />
      )}

      {activeTab === "logs" && (
        <LogsTab job={selectedJob} onBack={() => setActiveTab("jobs")} />
      )}

      {/* Add Folder Modal */}
      {showAddFolder && (
        <AddFolderModal
          onClose={() => setShowAddFolder(false)}
          onAdded={() => {
            setShowAddFolder(false);
            loadData();
          }}
        />
      )}

      {/* Bulk Import Modal */}
      {showBulkImport && (
        <BulkImportModal
          onClose={() => setShowBulkImport(false)}
          onImported={() => {
            setShowBulkImport(false);
            loadData();
          }}
        />
      )}

      {/* Folder Detail Panel */}
      {selectedFolder && (
        <FolderDetailPanel
          folder={selectedFolder}
          onClose={() => setSelectedFolder(null)}
          onDeleted={() => {
            setSelectedFolder(null);
            loadData();
          }}
          onUpdated={() => {
            setSelectedFolder(null);
            loadData();
          }}
        />
      )}
    </div>
  );
}

// ---- Stat Card ----

function StatCard({
  title,
  value,
  icon,
  description,
}: {
  title: string;
  value: number;
  icon: React.ReactNode;
  description: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        <p className="text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

// ---- Folders Tab ----

function FoldersTab({
  folders,
  syncing,
  onSync,
  onViewJobs,
  onSelectFolder,
  onReload,
}: {
  folders: MonitoredFolder[];
  syncing: string | null;
  onSync: (id: string) => void;
  onViewJobs: (id: string) => void;
  onSelectFolder: (folder: MonitoredFolder) => void;
  onReload: () => void;
}) {
  if (folders.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <FolderSync className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <h3 className="text-lg font-medium mb-1">
            No hay carpetas registradas
          </h3>
          <p className="text-sm text-muted-foreground mb-4">
            Agrega una carpeta de Google Drive o Dropbox para comenzar a
            importar propiedades automaticamente.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {folders.map((folder) => {
        const lastJob = folder.syncJobs?.[0];
        const isRunning =
          syncing === folder.id ||
          (lastJob &&
            ["PENDING", "CRAWLING", "PARSING", "MAPPING", "UPLOADING"].includes(
              lastJob.status
            ));

        return (
          <Card key={folder.id}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-4">
                {/* Left: Folder info */}
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <div
                    className={cn(
                      "mt-0.5 rounded-lg p-2",
                      folder.provider === "GOOGLE_DRIVE"
                        ? "bg-blue-500/10 text-blue-500"
                        : "bg-indigo-500/10 text-indigo-500"
                    )}
                  >
                    {folder.provider === "GOOGLE_DRIVE" ? (
                      <HardDrive className="h-5 w-5" />
                    ) : (
                      <Droplets className="h-5 w-5" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3
                        className="font-medium truncate cursor-pointer hover:text-blue-600 transition-colors"
                        onClick={() => onSelectFolder(folder)}
                      >
                        {folder.folderName}
                      </h3>
                      <Badge variant="outline" className="text-[10px] shrink-0">
                        {folder.provider === "GOOGLE_DRIVE"
                          ? "Drive"
                          : "Dropbox"}
                      </Badge>
                      <Badge
                        variant={folder.isActive ? "secondary" : "outline"}
                        className="text-[10px] shrink-0"
                      >
                        {folder.isActive ? "Activa" : "Inactiva"}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                      <span>Plaza: {folder.plaza}</span>
                      <span>Tipo: {folder.developmentType}</span>
                      <span>Cada {folder.syncInterval} min</span>
                      {folder.development && (
                        <span className="text-green-600">
                          Vinculada: {folder.development.name}
                        </span>
                      )}
                    </div>
                    {/* Last sync info */}
                    {lastJob && (
                      <div className="flex items-center gap-2 mt-2">
                        <StatusBadge status={lastJob.status} />
                        <span className="text-xs text-muted-foreground">
                          {lastJob.completedAt
                            ? `Completado ${formatRelativeTime(lastJob.completedAt)}`
                            : `Iniciado ${formatRelativeTime(lastJob.startedAt)}`}
                        </span>
                        {lastJob.status === "COMPLETED" && (
                          <span className="text-xs text-muted-foreground">
                            {lastJob.filesDiscovered} archivos,{" "}
                            {lastJob.unitsCreated} creadas,{" "}
                            {lastJob.unitsUpdated} actualizadas
                          </span>
                        )}
                        {lastJob.error && (
                          <span className="text-xs text-red-500 truncate max-w-[200px]">
                            {lastJob.error}
                          </span>
                        )}
                      </div>
                    )}
                    {!lastJob && (
                      <p className="text-xs text-muted-foreground mt-2">
                        Nunca sincronizada
                      </p>
                    )}
                  </div>
                </div>

                {/* Right: Actions */}
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onViewJobs(folder.id)}
                  >
                    Historial
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => onSync(folder.id)}
                    disabled={!!isRunning}
                  >
                    {isRunning ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Play className="mr-2 h-4 w-4" />
                    )}
                    {isRunning ? "Sincronizando..." : "Sincronizar"}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// ---- Jobs Tab ----

function JobsTab({
  jobs,
  onViewLogs,
  onReloadAll,
}: {
  jobs: SyncJob[];
  onViewLogs: (jobId: string) => void;
  onReloadAll: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">
          {jobs.length} sync jobs registrados
        </p>
        <Button variant="ghost" size="sm" onClick={onReloadAll}>
          <RefreshCw className="mr-2 h-3 w-3" />
          Todos los jobs
        </Button>
      </div>

      {jobs.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Clock className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <p className="text-sm text-muted-foreground">
              No hay sync jobs aun. Dispara un sync desde una carpeta.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left font-medium">Carpeta</th>
                <th className="px-4 py-3 text-left font-medium">Estado</th>
                <th className="px-4 py-3 text-left font-medium">Trigger</th>
                <th className="px-4 py-3 text-right font-medium">Archivos</th>
                <th className="px-4 py-3 text-right font-medium">Unidades</th>
                <th className="px-4 py-3 text-left font-medium">Hora</th>
                <th className="px-4 py-3 text-right font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr
                  key={job.id}
                  className="border-b last:border-0 hover:bg-muted/30 transition-colors"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {job.monitoredFolder.provider === "GOOGLE_DRIVE" ? (
                        <HardDrive className="h-3.5 w-3.5 text-blue-500" />
                      ) : (
                        <Droplets className="h-3.5 w-3.5 text-indigo-500" />
                      )}
                      <span className="truncate max-w-[150px]">
                        {job.monitoredFolder.folderName}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={job.status} />
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="outline" className="text-[10px]">
                      {job.triggeredBy}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {job.filesDiscovered > 0 && (
                      <span>
                        {job.filesDiscovered}
                        {job.filesNew > 0 && (
                          <span className="text-green-600 ml-1">
                            (+{job.filesNew})
                          </span>
                        )}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {(job.unitsCreated > 0 || job.unitsUpdated > 0) && (
                      <span>
                        {job.unitsCreated > 0 && (
                          <span className="text-green-600">
                            +{job.unitsCreated}
                          </span>
                        )}
                        {job.unitsCreated > 0 && job.unitsUpdated > 0 && " / "}
                        {job.unitsUpdated > 0 && (
                          <span className="text-blue-600">
                            ~{job.unitsUpdated}
                          </span>
                        )}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {formatRelativeTime(job.startedAt)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onViewLogs(job.id)}
                    >
                      Ver logs
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---- Logs Tab ----

function LogsTab({
  job,
  onBack,
}: {
  job: JobDetail | null;
  onBack: () => void;
}) {
  const [expandedSteps, setExpandedSteps] = React.useState<Set<string>>(
    new Set(["CRAWL", "PARSE", "MAP", "UPLOAD", "ORCHESTRATOR"])
  );

  if (!job) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <Info className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <p className="text-sm text-muted-foreground">
            Selecciona un sync job para ver sus logs.
          </p>
          <Button variant="outline" size="sm" className="mt-4" onClick={onBack}>
            Ir al historial
          </Button>
        </CardContent>
      </Card>
    );
  }

  const logsByStep = groupBy(job.logs, (l) => l.step);
  const steps = ["CRAWL", "PARSE", "MAP", "UPLOAD", "ORCHESTRATOR"];

  function toggleStep(step: string) {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(step)) next.delete(step);
      else next.add(step);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      {/* Job header */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onBack}>
          Volver al historial
        </Button>
        <div className="flex items-center gap-2">
          <StatusBadge status={job.status} />
          <span className="text-sm text-muted-foreground">
            {job.monitoredFolder.folderName}
          </span>
        </div>
      </div>

      {/* Job summary */}
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground block">Estado</span>
              <StatusBadge status={job.status} />
            </div>
            <div>
              <span className="text-muted-foreground block">Trigger</span>
              <span className="font-medium">{job.triggeredBy}</span>
            </div>
            <div>
              <span className="text-muted-foreground block">Archivos</span>
              <span className="font-medium">{job.filesDiscovered}</span>
              {job.filesNew > 0 && (
                <span className="text-green-600 ml-1">(+{job.filesNew})</span>
              )}
            </div>
            <div>
              <span className="text-muted-foreground block">Unidades +</span>
              <span className="font-medium text-green-600">
                {job.unitsCreated}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground block">Unidades ~</span>
              <span className="font-medium text-blue-600">
                {job.unitsUpdated}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground block">Duracion</span>
              <span className="font-medium">
                {job.completedAt
                  ? formatDuration(job.startedAt, job.completedAt)
                  : "En progreso..."}
              </span>
            </div>
          </div>
          {job.error && (
            <div className="mt-3 rounded-md bg-red-500/10 p-3 text-sm text-red-600">
              <AlertTriangle className="inline h-4 w-4 mr-1" />
              {job.error}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pipeline Steps */}
      <div className="space-y-2">
        {steps.map((step) => {
          const stepLogs = logsByStep[step] || [];
          if (stepLogs.length === 0) return null;

          const hasErrors = stepLogs.some((l) => l.level === "ERROR");
          const hasWarnings = stepLogs.some((l) => l.level === "WARN");
          const isExpanded = expandedSteps.has(step);

          return (
            <Card key={step}>
              <button
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-muted/30 transition-colors rounded-lg"
                onClick={() => toggleStep(step)}
              >
                <div className="flex items-center gap-2">
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                  <StepIcon step={step} />
                  <span className="font-medium text-sm">{stepLabel(step)}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {stepLogs.length} logs
                  </Badge>
                  {hasErrors && (
                    <Badge variant="destructive" className="text-[10px]">
                      ERROR
                    </Badge>
                  )}
                  {hasWarnings && !hasErrors && (
                    <Badge
                      className="text-[10px] bg-yellow-500/10 text-yellow-600 border-yellow-500/20"
                    >
                      WARN
                    </Badge>
                  )}
                </div>
              </button>

              {isExpanded && (
                <CardContent className="pt-0 pb-3 px-4">
                  <div className="space-y-1 ml-6 border-l-2 border-muted pl-4">
                    {stepLogs.map((log) => (
                      <div key={log.id} className="flex items-start gap-2 py-1">
                        <LogLevelIcon level={log.level} />
                        <div className="flex-1 min-w-0">
                          <span
                            className={cn(
                              "text-xs",
                              log.level === "ERROR" && "text-red-500",
                              log.level === "WARN" && "text-yellow-600",
                              log.level === "INFO" && "text-muted-foreground"
                            )}
                          >
                            {log.message}
                          </span>
                          {log.data && Object.keys(log.data).length > 0 && (
                            <pre className="text-[10px] text-muted-foreground bg-muted/50 rounded p-1.5 mt-1 overflow-x-auto">
                              {JSON.stringify(log.data, null, 2)}
                            </pre>
                          )}
                        </div>
                        <span className="text-[10px] text-muted-foreground shrink-0">
                          {new Date(log.createdAt).toLocaleTimeString()}
                        </span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ---- Add Folder Modal ----

function AddFolderModal({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: () => void;
}) {
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState("");
  const [mode, setMode] = React.useState<"auto" | "manual">("auto");
  const [form, setForm] = React.useState({
    provider: "GOOGLE_DRIVE" as "GOOGLE_DRIVE" | "DROPBOX",
    externalFolderId: "",
    folderName: "",
    folderUrl: "",
    plaza: "PDC",
    developmentType: "PROPIO",
    syncInterval: 15,
    // Campos opcionales (modo manual)
    urlImagenes: "",
    urlRenders: "",
    urlListaPrecios: "",
    urlBrochure: "",
    developerName: "",
    totalUnits: "",
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      const res = await fetch("/api/sync/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Error al registrar carpeta");
        return;
      }

      onAdded();
    } catch {
      setError("Error de conexion");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <Card className="w-full max-w-lg mx-4">
        <CardHeader>
          <CardTitle className="text-lg">Agregar Desarrollo</CardTitle>
          <CardDescription>
            Conecta la carpeta de Drive del desarrollador. El sistema descarga
            la lista de precios, extrae las unidades y publica en el sitio web.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
            {/* Carpeta padre (obligatoria) */}
            <div className="space-y-2">
              <Label htmlFor="folderId" className="font-semibold">
                URL de la carpeta en Drive
              </Label>
              <Input
                id="folderId"
                placeholder="https://drive.google.com/drive/folders/..."
                value={form.folderUrl || ""}
                onChange={(e) => {
                  const value = e.target.value.trim();
                  let folderId = value;
                  if (value.includes("folders/")) {
                    const match = value.match(/folders\/([a-zA-Z0-9_-]+)/);
                    if (match) folderId = match[1];
                  }
                  folderId = folderId.split("?")[0];
                  setForm({ ...form, folderUrl: value, externalFolderId: folderId });
                }}
                required
              />
              <p className="text-[11px] text-muted-foreground">
                Pega la URL de la carpeta principal del desarrollo en Google Drive
              </p>
            </div>

            {/* Nombre */}
            <div className="space-y-2">
              <Label htmlFor="folderName" className="font-semibold">Nombre del desarrollo</Label>
              <Input
                id="folderName"
                placeholder="Soleil Playa del Carmen"
                value={form.folderName}
                onChange={(e) => setForm({ ...form, folderName: e.target.value })}
                required
              />
            </div>

            {/* Desarrolladora */}
            <div className="space-y-2">
              <Label htmlFor="devName">Desarrolladora</Label>
              <Input
                id="devName"
                placeholder="Grupo Inmobiliario XYZ"
                value={form.developerName}
                onChange={(e) => setForm({ ...form, developerName: e.target.value })}
              />
            </div>

            {/* Plaza + Type */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Plaza</Label>
                <Select value={form.plaza} onValueChange={(v) => setForm({ ...form, plaza: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PDC">Playa del Carmen</SelectItem>
                    <SelectItem value="TULUM">Tulum</SelectItem>
                    <SelectItem value="MERIDA">Merida</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Tipo</Label>
                <Select value={form.developmentType} onValueChange={(v) => setForm({ ...form, developmentType: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PROPIO">Propio</SelectItem>
                    <SelectItem value="MASTERBROKER">Masterbroker</SelectItem>
                    <SelectItem value="CORRETAJE">Corretaje</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Total unidades */}
            <div className="space-y-2">
              <Label htmlFor="totalUnits">Total de unidades del proyecto (opcional)</Label>
              <Input
                id="totalUnits"
                type="number"
                placeholder="75"
                value={form.totalUnits}
                onChange={(e) => setForm({ ...form, totalUnits: e.target.value })}
              />
              <p className="text-[11px] text-muted-foreground">
                Si lo sabes, ayuda a calcular la absorcion correcta (vendidas = total - listadas)
              </p>
            </div>

            <Separator />

            {/* Modo: Auto vs Manual */}
            <div className="space-y-2">
              <Label className="font-semibold">Modo de busqueda de archivos</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={mode === "auto" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setMode("auto")}
                  className="flex-1"
                >
                  Automatico
                </Button>
                <Button
                  type="button"
                  variant={mode === "manual" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setMode("manual")}
                  className="flex-1"
                >
                  URLs especificas
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {mode === "auto"
                  ? "El sistema explora la carpeta padre automaticamente buscando subcarpetas de imagenes, renders, precios, etc."
                  : "Pega las URLs directas de cada subcarpeta para acelerar el proceso"}
              </p>
            </div>

            {/* Campos manuales (solo si modo manual) */}
            {mode === "manual" && (
              <div className="space-y-3 rounded-lg border p-3 bg-muted/30">
                <div className="space-y-2">
                  <Label htmlFor="urlListaPrecios" className="text-xs">Lista de precios (carpeta con PDF/Excel)</Label>
                  <Input
                    id="urlListaPrecios"
                    placeholder="https://drive.google.com/drive/folders/..."
                    value={form.urlListaPrecios}
                    onChange={(e) => setForm({ ...form, urlListaPrecios: e.target.value })}
                    className="text-xs h-8"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="urlImagenes" className="text-xs">Imagenes / Renders principales</Label>
                  <Input
                    id="urlImagenes"
                    placeholder="https://drive.google.com/drive/folders/..."
                    value={form.urlImagenes}
                    onChange={(e) => setForm({ ...form, urlImagenes: e.target.value })}
                    className="text-xs h-8"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="urlRenders" className="text-xs">Renders adicionales / Interiores (opcional)</Label>
                  <Input
                    id="urlRenders"
                    placeholder="https://drive.google.com/drive/folders/..."
                    value={form.urlRenders}
                    onChange={(e) => setForm({ ...form, urlRenders: e.target.value })}
                    className="text-xs h-8"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="urlBrochure" className="text-xs">Brochure (opcional)</Label>
                  <Input
                    id="urlBrochure"
                    placeholder="https://drive.google.com/drive/folders/..."
                    value={form.urlBrochure}
                    onChange={(e) => setForm({ ...form, urlBrochure: e.target.value })}
                    className="text-xs h-8"
                  />
                </div>
              </div>
            )}

            {/* Provider hidden */}
            <input type="hidden" value="GOOGLE_DRIVE" />

            {/* Sync interval */}
            <div className="space-y-2">
              <Label htmlFor="syncInterval">Intervalo de sincronizacion (minutos)</Label>
              <Input
                id="syncInterval"
                type="number"
                min={5}
                max={1440}
                value={form.syncInterval}
                onChange={(e) => setForm({ ...form, syncInterval: parseInt(e.target.value) || 15 })}
              />
            </div>

            {/* Error */}
            {error && (
              <div className="rounded-md bg-red-500/10 p-3 text-sm text-red-600">
                {error}
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={submitting}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Registrar Carpeta
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

// ---- Bulk Import Modal ----

function BulkImportModal({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: () => void;
}) {
  const [importing, setImporting] = React.useState(false);
  const [csvText, setCsvText] = React.useState("");
  const [result, setResult] = React.useState<{
    total: number;
    created: number;
    existing: number;
    errors: number;
    queued: number;
  } | null>(null);
  const [error, setError] = React.useState("");

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      setCsvText(ev.target?.result as string || "");
    };
    reader.readAsText(file);
  }

  function parseCSV(text: string): Array<{
    name: string;
    driveUrl: string;
    plaza?: string;
    type?: string;
    developer?: string;
    totalUnits?: number;
  }> {
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) return [];

    const headers = lines[0].toLowerCase().split(",").map((h) => h.trim());
    const nameIdx = headers.findIndex((h) => h.includes("nombre") || h.includes("name") || h.includes("proyecto"));
    const urlIdx = headers.findIndex((h) => h.includes("url") || h.includes("drive") || h.includes("carpeta"));
    const plazaIdx = headers.findIndex((h) => h.includes("plaza") || h.includes("ciudad") || h.includes("city"));
    const typeIdx = headers.findIndex((h) => h.includes("tipo") || h.includes("type"));
    const devIdx = headers.findIndex((h) => h.includes("desarrollador") || h.includes("developer"));
    const unitsIdx = headers.findIndex((h) => h.includes("unidades") || h.includes("units") || h.includes("total"));

    if (nameIdx === -1 || urlIdx === -1) return [];

    return lines.slice(1).map((line) => {
      const cols = line.split(",").map((c) => c.trim());
      return {
        name: cols[nameIdx] || "",
        driveUrl: cols[urlIdx] || "",
        plaza: plazaIdx >= 0 ? cols[plazaIdx] : undefined,
        type: typeIdx >= 0 ? cols[typeIdx] : undefined,
        developer: devIdx >= 0 ? cols[devIdx] : undefined,
        totalUnits: unitsIdx >= 0 ? parseInt(cols[unitsIdx]) || undefined : undefined,
      };
    }).filter((d) => d.name && d.driveUrl);
  }

  async function handleImport() {
    setImporting(true);
    setError("");
    setResult(null);

    const developments = parseCSV(csvText);
    if (developments.length === 0) {
      setError("No se encontraron desarrollos validos. Verifica que el CSV tenga columnas 'nombre' y 'url'.");
      setImporting(false);
      return;
    }

    try {
      const res = await fetch("/api/sync/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ developments }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Error al importar");
        return;
      }

      setResult(data.data);
    } catch {
      setError("Error de conexion");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <Card className="w-full max-w-2xl mx-4">
        <CardHeader>
          <CardTitle className="text-lg">Importar Desarrollos (CSV)</CardTitle>
          <CardDescription>
            Sube un archivo CSV o Excel con multiples desarrollos para importarlos
            y sincronizarlos automaticamente.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!result ? (
            <>
              {/* File upload */}
              <div className="space-y-2">
                <Label>Subir archivo CSV</Label>
                <Input
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  onChange={handleFileUpload}
                />
              </div>

              {/* Or paste */}
              <div className="space-y-2">
                <Label>O pega el contenido CSV</Label>
                <textarea
                  className="w-full h-32 rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
                  placeholder={`nombre,url,plaza,tipo,desarrolladora,total_unidades
Soleil,https://drive.google.com/drive/folders/xxx,PDC,CORRETAJE,Grupo XYZ,60
Noble,https://drive.google.com/drive/folders/yyy,PDC,MASTERBROKER,Noble Dev,40`}
                  value={csvText}
                  onChange={(e) => setCsvText(e.target.value)}
                />
              </div>

              {/* Preview */}
              {csvText && (
                <div className="text-sm text-muted-foreground">
                  {parseCSV(csvText).length} desarrollos detectados
                </div>
              )}

              {error && (
                <div className="rounded-md bg-red-500/10 p-3 text-sm text-red-600">
                  {error}
                </div>
              )}

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={onClose} disabled={importing}>
                  Cancelar
                </Button>
                <Button onClick={handleImport} disabled={importing || !csvText}>
                  {importing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Importar y Sincronizar
                </Button>
              </div>
            </>
          ) : (
            <>
              {/* Results */}
              <div className="space-y-3">
                <div className="grid grid-cols-4 gap-3">
                  <div className="bg-muted/50 rounded-lg p-3 text-center">
                    <div className="text-xl font-bold">{result.total}</div>
                    <div className="text-[11px] text-muted-foreground">Total</div>
                  </div>
                  <div className="bg-green-500/10 rounded-lg p-3 text-center">
                    <div className="text-xl font-bold text-green-600">{result.created}</div>
                    <div className="text-[11px] text-muted-foreground">Creados</div>
                  </div>
                  <div className="bg-blue-500/10 rounded-lg p-3 text-center">
                    <div className="text-xl font-bold text-blue-600">{result.queued}</div>
                    <div className="text-[11px] text-muted-foreground">En cola</div>
                  </div>
                  <div className="bg-red-500/10 rounded-lg p-3 text-center">
                    <div className="text-xl font-bold text-red-600">{result.errors}</div>
                    <div className="text-[11px] text-muted-foreground">Errores</div>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">
                  Los desarrollos se estan sincronizando en cola (1 a la vez).
                  El sitio web se actualiza automaticamente cuando terminen todos.
                </p>
              </div>

              <div className="flex justify-end">
                <Button onClick={onImported}>Cerrar</Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---- Folder Detail Panel ----

function FolderDetailPanel({
  folder,
  onClose,
  onDeleted,
  onUpdated,
}: {
  folder: MonitoredFolder;
  onClose: () => void;
  onDeleted: () => void;
  onUpdated: () => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [form, setForm] = React.useState({
    folderName: folder.folderName,
    folderUrl: folder.folderUrl || "",
    plaza: folder.plaza,
    developmentType: folder.developmentType,
    syncInterval: folder.syncInterval,
    isActive: folder.isActive,
  });

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/sync/folders/${folder.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        onUpdated();
      } else {
        const data = await res.json();
        alert(data.error || "Error al guardar");
      }
    } catch {
      alert("Error de conexion");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/sync/folders/${folder.id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        onDeleted();
      } else {
        const data = await res.json();
        alert(data.error || "Error al eliminar");
      }
    } catch {
      alert("Error de conexion");
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  const lastJob = folder.syncJobs?.[0];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <Card className="w-full max-w-2xl mx-4 max-h-[85vh] overflow-hidden flex flex-col">
        <CardHeader className="flex flex-row items-start justify-between pb-3">
          <div>
            <CardTitle className="text-lg">{folder.folderName}</CardTitle>
            <CardDescription className="flex items-center gap-2 mt-1">
              <Badge variant="outline" className="text-[10px]">
                {folder.provider === "GOOGLE_DRIVE" ? "Google Drive" : "Dropbox"}
              </Badge>
              <Badge variant={folder.isActive ? "secondary" : "outline"} className="text-[10px]">
                {folder.isActive ? "Activa" : "Inactiva"}
              </Badge>
              {folder.development && (
                <span className="text-green-600 text-xs">
                  Vinculada: {folder.development.name}
                </span>
              )}
            </CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} className="mt-0">
            ✕
          </Button>
        </CardHeader>

        <CardContent className="overflow-y-auto flex-1 space-y-4">
          {/* Stats */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-muted/50 rounded-lg p-3 text-center">
              <div className="text-lg font-bold">{folder._count.syncJobs}</div>
              <div className="text-[11px] text-muted-foreground">Syncs</div>
            </div>
            <div className="bg-muted/50 rounded-lg p-3 text-center">
              <div className="text-lg font-bold">{folder._count.syncFiles}</div>
              <div className="text-[11px] text-muted-foreground">Archivos</div>
            </div>
            <div className="bg-muted/50 rounded-lg p-3 text-center">
              <div className="text-lg font-bold">
                {lastJob ? (lastJob.unitsCreated + lastJob.unitsUpdated) : 0}
              </div>
              <div className="text-[11px] text-muted-foreground">Unidades</div>
            </div>
          </div>

          {/* Last sync info */}
          {lastJob && (
            <div className="flex items-center gap-2 text-sm">
              <StatusBadge status={lastJob.status} />
              <span className="text-muted-foreground">
                {lastJob.completedAt
                  ? `Ultimo sync: ${formatRelativeTime(lastJob.completedAt)}`
                  : `Iniciado: ${formatRelativeTime(lastJob.startedAt)}`}
              </span>
              {lastJob.error && (
                <span className="text-red-500 text-xs truncate max-w-[200px]">
                  {lastJob.error}
                </span>
              )}
            </div>
          )}

          <Separator />

          {/* Editable fields */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="font-semibold">Configuracion</Label>
              {!editing ? (
                <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                  Editar
                </Button>
              ) : (
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
                    Cancelar
                  </Button>
                  <Button size="sm" onClick={handleSave} disabled={saving}>
                    {saving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                    Guardar
                  </Button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Nombre</Label>
                {editing ? (
                  <Input
                    value={form.folderName}
                    onChange={(e) => setForm({ ...form, folderName: e.target.value })}
                    className="h-8 text-sm"
                  />
                ) : (
                  <div className="text-sm font-medium">{folder.folderName}</div>
                )}
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Plaza</Label>
                {editing ? (
                  <Select value={form.plaza} onValueChange={(v) => setForm({ ...form, plaza: v })}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PDC">Playa del Carmen</SelectItem>
                      <SelectItem value="TULUM">Tulum</SelectItem>
                      <SelectItem value="MERIDA">Merida</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="text-sm">{folder.plaza}</div>
                )}
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Tipo</Label>
                {editing ? (
                  <Select value={form.developmentType} onValueChange={(v) => setForm({ ...form, developmentType: v })}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PROPIO">Propio</SelectItem>
                      <SelectItem value="MASTERBROKER">Masterbroker</SelectItem>
                      <SelectItem value="CORRETAJE">Corretaje</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="text-sm">{folder.developmentType}</div>
                )}
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Intervalo (min)</Label>
                {editing ? (
                  <Input
                    type="number"
                    value={form.syncInterval}
                    onChange={(e) => setForm({ ...form, syncInterval: parseInt(e.target.value) || 15 })}
                    className="h-8 text-sm"
                  />
                ) : (
                  <div className="text-sm">{folder.syncInterval} min</div>
                )}
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">URL de Drive</Label>
              {editing ? (
                <Input
                  value={form.folderUrl}
                  onChange={(e) => setForm({ ...form, folderUrl: e.target.value })}
                  className="h-8 text-sm"
                />
              ) : (
                <div className="text-sm">
                  {folder.folderUrl ? (
                    <a href={folder.folderUrl} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline flex items-center gap-1">
                      <ExternalLink className="h-3 w-3" />
                      Abrir en Drive
                    </a>
                  ) : (
                    <span className="text-muted-foreground">No configurada</span>
                  )}
                </div>
              )}
            </div>

            {editing && (
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isActive"
                  checked={form.isActive}
                  onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                />
                <Label htmlFor="isActive" className="text-sm">Carpeta activa</Label>
              </div>
            )}
          </div>

          <Separator />

          {/* Folder ID */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">ID interno</Label>
            <div className="text-xs font-mono text-muted-foreground">{folder.id}</div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">ID de Drive</Label>
            <div className="text-xs font-mono text-muted-foreground">{folder.externalFolderId}</div>
          </div>

          <Separator />

          {/* Danger Zone */}
          <div className="rounded-lg border border-red-200 p-3 bg-red-50/50">
            <h4 className="text-sm font-medium text-red-700 mb-2">Zona de peligro</h4>
            {!confirmDelete ? (
              <Button
                variant="outline"
                size="sm"
                className="text-red-600 border-red-200 hover:bg-red-50"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 className="h-3 w-3 mr-1" />
                Eliminar desarrollo
              </Button>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-red-600">
                  Esto eliminara la carpeta monitoreada, todos los sync jobs, archivos rastreados,
                  y el desarrollo vinculado del CRM. Esta accion no se puede deshacer.
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setConfirmDelete(false)}
                    disabled={deleting}
                  >
                    Cancelar
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={handleDelete}
                    disabled={deleting}
                  >
                    {deleting ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                    Si, eliminar todo
                  </Button>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ---- Shared Components ----

function StatusBadge({ status }: { status: string }) {
  const config: Record<
    string,
    { label: string; className: string; icon: React.ReactNode }
  > = {
    PENDING: {
      label: "Pendiente",
      className: "bg-gray-500/10 text-gray-600 border-gray-500/20",
      icon: <Clock className="h-3 w-3" />,
    },
    CRAWLING: {
      label: "Rastreando",
      className: "bg-blue-500/10 text-blue-600 border-blue-500/20",
      icon: <Loader2 className="h-3 w-3 animate-spin" />,
    },
    PARSING: {
      label: "Parseando",
      className: "bg-purple-500/10 text-purple-600 border-purple-500/20",
      icon: <Loader2 className="h-3 w-3 animate-spin" />,
    },
    MAPPING: {
      label: "Mapeando",
      className: "bg-orange-500/10 text-orange-600 border-orange-500/20",
      icon: <Loader2 className="h-3 w-3 animate-spin" />,
    },
    UPLOADING: {
      label: "Subiendo",
      className: "bg-teal-500/10 text-teal-600 border-teal-500/20",
      icon: <Loader2 className="h-3 w-3 animate-spin" />,
    },
    COMPLETED: {
      label: "Completado",
      className: "bg-green-500/10 text-green-600 border-green-500/20",
      icon: <CheckCircle2 className="h-3 w-3" />,
    },
    FAILED: {
      label: "Fallido",
      className: "bg-red-500/10 text-red-600 border-red-500/20",
      icon: <XCircle className="h-3 w-3" />,
    },
  };

  const c = config[status] || config.PENDING;

  return (
    <Badge className={cn("text-[10px] gap-1", c.className)}>
      {c.icon}
      {c.label}
    </Badge>
  );
}

function StepIcon({ step }: { step: string }) {
  const icons: Record<string, React.ReactNode> = {
    CRAWL: <FolderSync className="h-4 w-4 text-blue-500" />,
    PARSE: <FileText className="h-4 w-4 text-purple-500" />,
    MAP: <FileSpreadsheet className="h-4 w-4 text-orange-500" />,
    UPLOAD: <CheckCircle2 className="h-4 w-4 text-green-500" />,
    ORCHESTRATOR: <RefreshCw className="h-4 w-4 text-muted-foreground" />,
  };
  return icons[step] || null;
}

function LogLevelIcon({ level }: { level: string }) {
  if (level === "ERROR") return <XCircle className="h-3 w-3 text-red-500 shrink-0 mt-0.5" />;
  if (level === "WARN") return <AlertTriangle className="h-3 w-3 text-yellow-500 shrink-0 mt-0.5" />;
  return <Info className="h-3 w-3 text-blue-400 shrink-0 mt-0.5" />;
}

// ---- Helpers ----

function stepLabel(step: string): string {
  const labels: Record<string, string> = {
    CRAWL: "Rastreo de carpeta",
    PARSE: "Extraccion de datos",
    MAP: "Mapeo al schema",
    UPLOAD: "Subida al CRM",
    ORCHESTRATOR: "Orquestador",
  };
  return labels[step] || step;
}

function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "hace un momento";
  if (minutes < 60) return `hace ${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours}h`;

  const days = Math.floor(hours / 24);
  return `hace ${days}d`;
}

function formatDuration(start: string, end: string): string {
  const diff = new Date(end).getTime() - new Date(start).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

function groupBy<T>(arr: T[], fn: (item: T) => string): Record<string, T[]> {
  return arr.reduce(
    (acc, item) => {
      const key = fn(item);
      if (!acc[key]) acc[key] = [];
      acc[key].push(item);
      return acc;
    },
    {} as Record<string, T[]>
  );
}
