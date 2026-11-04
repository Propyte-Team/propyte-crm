// Ejecuta consultas en lotes pequeños para no agotar el pool de conexiones (#974).
// Supavisor en modo sesión da 15 conexiones en total: una pantalla que lanza 11-13 consultas
// a la vez, multiplicada por varios usuarios, lo desborda (EMAXCONNSESSION).
//
// Recibe FUNCIONES (`() => prisma.x.count(...)`), no promesas: una consulta de Prisma arranca al
// llamarla, así que si ya viniera creada no habría nada que escalonar.
// Conserva el orden y los tipos de cada resultado, igual que Promise.all con una tupla.
type Tarea = () => PromiseLike<unknown>;

export async function enLotes<T extends Tarea[]>(
  tareas: readonly [...T],
  tamano = 4,
): Promise<{ [K in keyof T]: Awaited<ReturnType<T[K]>> }> {
  const lote = Math.max(1, Math.floor(tamano));
  const resultados: unknown[] = [];
  for (let i = 0; i < tareas.length; i += lote) {
    const parcial = await Promise.all(tareas.slice(i, i + lote).map((t) => t()));
    resultados.push(...parcial);
  }
  return resultados as { [K in keyof T]: Awaited<ReturnType<T[K]>> };
}
