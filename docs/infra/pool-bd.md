# Pool de conexiones a la base de datos (tarjeta 974)

## Qué pasa

Algunas pantallas (Hoy, Administración, Huérfanos) fallan a veces con:

    EMAXCONNSESSION ... pool_size: 15

El CRM se conecta a Supabase por el **pooler en modo sesión (puerto 5432)**. En ese modo cada
conexión que abre el CRM queda reservada mientras el proceso vive, y el máximo del pooler es **15**.

El CRM corre en **Hostinger Cloud con Passenger** (no en Vercel). Passenger puede tener varios
procesos de Node a la vez, y cada proceso tiene su propio pool de Prisma del tamaño de
`connection_limit` en `DATABASE_URL` (hoy `5`, puesto en junio de 2026). Con 3 procesos son
15 conexiones: el tope. Si además una pantalla lanza 11–13 consultas a la vez, se piden todas
juntas.

## Qué arregla el código (este PR)

- Hoy, Administración y Huérfanos piden sus datos en tandas de 4 (o 2) en vez de todas a la vez.
- El cliente de Prisma se reutiliza siempre (no se crea uno nuevo si el módulo se recarga).

## Qué hacer en infraestructura (Luis)

**No pasar al puerto 6543 (modo transacción).** En junio de 2026 ese pooler se quedó trabado de
forma permanente (`ECHECKOUTTIMEOUT`) y por eso el CRM está en 5432.

### Paso 1. Bajar `connection_limit` a 3

1. hPanel > Websites > crm.propyte.com > **Node.js** (o «Settings and redeploy») >
   **Variables de entorno**.
2. En `DATABASE_URL`, cambia `connection_limit=5` por `connection_limit=3`. No toques nada más
   de la URL.
3. Guarda y redeploy. Las variables solo se leen al arrancar.

Así 3 procesos usan 9 conexiones y quedan 6 para el Hub, scripts y picos.

### Paso 2 (solo si vuelve a pasar). Subir el tamaño del pool en Supabase

Supabase > proyecto > **Database > Settings > Connection pooling > Pool size**. El máximo
depende del tamaño de la instancia. Subirlo da más margen a todos los que usan el pooler.

### Si algo falla

- Si aparece «Timed out fetching a new connection from the connection pool», sube a
  `connection_limit=4`.
- Para volver atrás, pon de nuevo `connection_limit=5` y redeploy.
