# Pool de conexiones a la base de datos (#974)

## Qué pasa

Algunas pantallas (Hoy, Administración, Leads huérfanos) fallan a veces con:

`EMAXCONNSESSION ... pool_size: 15`

Significa que la base de datos (Supabase) ya tiene ocupadas las 15 conexiones que permite
y rechaza la siguiente. No es un error de datos: es un tope de conexiones.

Hoy usamos el pooler de Supabase en modo **sesión** (puerto 5432). En ese modo cada conexión
que abre el CRM se queda reservada y el máximo es 15 en total. El CRM corre en Vercel, que
levanta varias copias de la app a la vez, y cada copia abre varias conexiones por su cuenta
(Prisma abre por defecto unas 9 o más). Con 2 copias activas ya se llena. Además, esas
pantallas lanzaban entre 11 y 13 consultas al mismo tiempo.

## Qué se cambió en el código (ya hecho)

- `src/lib/db/index.ts`: el cliente de Prisma se guarda siempre en `globalThis` (antes solo fuera de
  producción), para no abrir un segundo pool en la misma copia de la app.
- `src/lib/db/lotes.ts` (`enLotes`): corre las consultas en grupos de 4 en lugar de todas a la vez.
- Hoy (`src/server/today.ts`, 13 consultas), Administración (`admin/page.tsx`, 11) y Leads huérfanos
  (`conexiones/huerfanos/page.tsx`) usan `enLotes`. Muestran exactamente lo mismo.

Esto reduce los picos, pero **no basta por sí solo**: el arreglo de fondo es de infraestructura.

## Cambio de infraestructura recomendado (lo haces tú)

Pasar la app al pooler en modo **transacción** (puerto 6543). Ahí una conexión se presta solo
durante cada consulta, y miles de clientes comparten pocas conexiones reales.

### Paso 1. Copiar la cadena de conexión en Supabase

1. Supabase > tu proyecto > **Connect** (o Settings > Database > Connection string).
2. Elige **Transaction pooler**. Copia la URL; trae el puerto **6543**.
3. No pegues la contraseña en chats ni en el repositorio.

### Paso 2. Armar la nueva `DATABASE_URL`

```
postgresql://postgres.<PROJECT_REF>:<PASSWORD>@aws-1-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1
```

- `<PROJECT_REF>` y `<PASSWORD>` son los mismos que ya usas hoy (solo cambia el puerto y lo que va
  después del signo `?`).
- `pgbouncer=true`: necesario en modo transacción para que Prisma no use sentencias preparadas.
- `connection_limit=1`: cada copia de la app en Vercel usa 1 conexión. Es el valor estándar para
  serverless. Si notas lentitud en pantallas con muchas consultas, súbelo a `3`; no pasar de 5.

### Paso 3. Cambiarla en Vercel

1. Vercel > proyecto del CRM > **Settings** > **Environment Variables**.
2. Edita `DATABASE_URL` en **Production** (y Preview si aplica) y pega la URL del paso 2.
3. (Opcional, para migraciones) agrega `DIRECT_URL` con la URL original del puerto **5432**.
   Hoy no la usa ningún comando del repo; si algún día se agrega `directUrl` en
   `prisma/schema.prisma`, ya estará lista.
4. **Deployments** > el último despliegue > **Redeploy** (las variables nuevas solo aplican en un
   despliegue nuevo).

### Paso 4. Verificar

- Abre Hoy, Administración y Leads huérfanos varias veces seguidas, con otra persona entrando a la vez.
- Debe desaparecer el error `EMAXCONNSESSION`.
- En Supabase > Reports > Database puedes ver las conexiones: deben quedar muy por debajo de 15.

## Importante

- En tu computadora, los scripts y migraciones (`prisma db push`, `scripts/*.ts`, aplicar SQL) deben
  seguir usando la URL del puerto **5432** en tu `.env` local. El modo transacción no sirve para
  migraciones. No cambies tu `.env` local, solo la variable de Vercel.
- Si algo falla tras el cambio, vuelve a poner la URL anterior en Vercel y haz Redeploy.
- Si el error persiste con 6543, revisa que no haya otros servicios (workers, crons externos) usando
  la misma base por el puerto 5432: también consumen de las 15 conexiones.
