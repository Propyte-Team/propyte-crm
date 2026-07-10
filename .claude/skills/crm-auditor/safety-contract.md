# Contrato de seguridad de datos QA — PRODUCCIÓN (crm.propyte.com)

> Este es el único lugar donde viven las reglas de datos de prueba. Playbooks y provisioning lo referencian; no lo repiten. **Hay leads REALES en el sistema.** Léelo completo antes de cada corrida.

## Marcador de datos QA (doble señal)

El CRM **sí tiene tags** (`Contact.tags String[]`, validado `z.array(z.string().max(50)).max(20)`, editable en el form de contacto "Etiquetas (separadas por coma)" y por API). Marcador primario:

1. **Tag `QA_AUDIT`** en todo Contact de prueba (≤50 chars, cuenta contra el límite de 20 tags). Es el mecanismo primario, filtrable y disponible hoy.
2. **Prefijo de nombre `QA-{rol}-{timestamp}`** (segunda señal independiente del origen). Ej: `QA-asesor-20260710-1432`.

**NO usar `leadSource` como marcador QA:** el origen se varía a propósito en las pruebas (dimensión "identificar origen"), así que no puede servir de marca. El tag + prefijo de nombre son independientes del origen.

Todo registro QA (Contact, Deal, Quote, Activity, Message) debe ser rastreable a un Contact con tag `QA_AUDIT`.

## Datos de contacto QA (para que el outbound caiga en el equipo)

- **Correo:** de un buzón del equipo interno. Ejemplo: `qa+asesor@propyte.com`. Definir el correo exacto al inicio de la corrida y anotarlo en el `AUDIT.md`.
- **Teléfono:** un WhatsApp de prueba interno del equipo (nunca un número de cliente real). Definir el número exacto al inicio de la corrida.
- Cualquier WhatsApp/email que dispare el sistema debe llegar al equipo, **NUNCA a un cliente real**.

## Reglas duras

1. **Datos reales = SOLO LECTURA.** Jamás crear, modificar o borrar leads/deals/contactos/cotizaciones reales. Sólo se mutan registros marcados QA.
2. **Nunca editar un contacto que ya existía** salvo que tenga el tag `QA_AUDIT` puesto por esta corrida.
3. **Sin acciones irreversibles de negocio** fuera de datos QA: no lanzar campañas, no modificar conectores/credenciales reales en `/conexiones` (sólo lectura de la UI de conectores), no togglear reglas de automatización reales en prod (crear una regla QA aparte si hace falta probar automatización, inactiva por defecto).
4. **Teardown obligatorio.** Al final se borra TODO lo QA. Si algo no se pudo borrar → reportarlo explícito en el `AUDIT.md` (nunca silenciar el fallo de cleanup).
5. **Windows:** nunca matar `node.exe` de forma masiva (hay ~39 Chrome + procesos de Luis). Si Playwright se cuelga, cerrar sólo su navegador.
6. **⚠️ Asesores QA y round-robin (CRÍTICO, aprendido 2026-07-10):** crear un usuario asesor **activo** lo mete al pool de round-robin y el intake le **auto-asigna leads REALES** en minutos (incidente real: un lead de WhatsApp en vivo cayó en el `qa-asesor`). Reglas:
   - Provisionar el asesor QA en una **plaza sin inbound activo** (usar `MERIDA`; el inbound real es PDC/TULUM) para minimizar captura.
   - **Ventana corta**: crear → probar → teardown rápido; no dejar el asesor activo esperando.
   - En el teardown, **antes de borrar/desactivar el usuario**, reasignar (`assignedToId=null`) TODO contacto sin tag `QA_AUDIT` que haya caído en él (son leads reales) y avisar a Luis para que los re-rutee. **Nunca borrar** esos contactos ni sus actividades.
   - Si el usuario QA acumuló actividades reales (p. ej. conversación de WhatsApp), **no se puede borrar** (FK) → dejarlo **inactivo** y reportarlo como residuo.

## Checklist de teardown (copiar al final de cada AUDIT.md)

- [ ] Contacts con tag `QA_AUDIT` borrados (o baja lógica si no hay delete)
- [ ] Deals QA borrados
- [ ] Quotes/cotizaciones QA borradas
- [ ] Activities/tasks QA borradas
- [ ] Mensajes/hilos QA del inbox borrados o cerrados
- [ ] Reglas/planes de automatización QA borrados o dejados inactivos
- [ ] Leads REALES (sin tag `QA_AUDIT`) que cayeron en un asesor QA → reasignados a `null` y reportados a Luis (NO borrados)
- [ ] Usuarios efímeros `qa-*@propyte.local` borrados (o inactivos si tienen actividades reales que impiden el DELETE → reportar residuo)
- [ ] ADMIN temporal (`audit-temp@propyte.local`) devuelto a `isActive=false`
- [ ] Residuo reportado explícito si algo no se pudo limpiar
