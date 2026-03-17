// ============================================================
// API Route: /api/sync/folders/[id]
// PATCH - Update folder config
// DELETE - Delete folder + related data + development
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";

const ADMIN_ROLES = ["ADMIN", "DIRECTOR", "GERENTE", "DEVELOPER_EXT", "MANTENIMIENTO"];

/**
 * PATCH /api/sync/folders/[id]
 * Update folder configuration.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession();
    if (!session?.user || !ADMIN_ROLES.includes(session.user.role)) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();

    const folder = await prisma.monitoredFolder.findUnique({ where: { id } });
    if (!folder) {
      return NextResponse.json({ error: "Carpeta no encontrada" }, { status: 404 });
    }

    const updated = await prisma.monitoredFolder.update({
      where: { id },
      data: {
        folderName: body.folderName ?? folder.folderName,
        folderUrl: body.folderUrl ?? folder.folderUrl,
        plaza: body.plaza ?? folder.plaza,
        developmentType: body.developmentType ?? folder.developmentType,
        syncInterval: body.syncInterval ?? folder.syncInterval,
        isActive: body.isActive ?? folder.isActive,
      },
    });

    return NextResponse.json({ data: updated });
  } catch (error) {
    console.error("Error updating folder:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

/**
 * DELETE /api/sync/folders/[id]
 * Delete folder + sync jobs + sync files + sync logs + linked development + units.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession();
    if (!session?.user || !ADMIN_ROLES.includes(session.user.role)) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    const { id } = await params;

    const folder = await prisma.monitoredFolder.findUnique({
      where: { id },
      include: { syncJobs: { select: { id: true } } },
    });

    if (!folder) {
      return NextResponse.json({ error: "Carpeta no encontrada" }, { status: 404 });
    }

    // Delete in order (foreign key constraints)
    // 1. Sync logs
    for (const job of folder.syncJobs) {
      await prisma.syncLog.deleteMany({ where: { syncJobId: job.id } });
    }

    // 2. Sync jobs
    await prisma.syncJob.deleteMany({ where: { monitoredFolderId: id } });

    // 3. Sync files
    await prisma.syncFile.deleteMany({ where: { monitoredFolderId: id } });

    // 4. Delete linked development + units (if exists)
    if (folder.developmentId) {
      await prisma.unit.deleteMany({ where: { developmentId: folder.developmentId } });
      await prisma.development.delete({ where: { id: folder.developmentId } }).catch(() => {
        // May fail if development has deals linked — soft delete instead
      });
    }

    // 5. Delete the folder itself
    await prisma.monitoredFolder.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting folder:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
