# Meta App Review — reenvío de permisos de comentarios (oct 2026)

App: **Propyte CRM** (app ID 1718579335943082)
Rechazados en la revisión enviada el 25-oct-2026:

- `pages_read_user_content`
- `pages_manage_engagement`
- `instagram_manage_comments`

Feature que los usa: **Admin → Reglas de comentarios** (`/admin?tab=comments`).
Código: `src/lib/comments/` (parse, match, graph, handle-comment) + webhook `src/app/api/webhooks/meta-dm/route.ts`.

---

## Motivo del rechazo (resumen)

Los 3 permisos: **"La captura de video no coincide con los detalles del caso de uso"** (Dev Policy 1.6). Meta dice que **el caso de uso SÍ está permitido**; el problema es solo el video. Pide:

1. Flujo de login de Meta completo → **no aplica**: usamos token de System User. Hay que **decirlo explícitamente** (punto 5) y mostrar en el video de dónde sale el acceso (Business Settings → System Users).
2. Un usuario con acceso a la app para el permiso → mostrar el System User con la Página/IG asignados y el token con esos permisos.
3. La experiencia completa del caso de uso → comentario real → se ve en el CRM → respuesta pública visible en FB/IG.
4. **UI en inglés + subtítulos + explicar botones** → el CRM está en español: grabar con el navegador traduciendo a inglés y poner captions/callouts en cada botón.
5. Indicar que es System User / server-to-server.

## 0. Antes de reenviar (checklist)

- [ ] **Usuario para el revisor que SÍ vea la feature.** En el envío anterior la credencial era un usuario QA de rol *asesor*. Si ese rol no entra a `/admin`, el revisor no pudo ver Reglas de comentarios → causa probable del rechazo. Crear un usuario `meta-reviewer` con un rol que vea Admin → Reglas de comentarios e Inbox (y nada más sensible si se puede).
- [ ] Confirmar que el reviewer puede **hacer login** en `https://crm.propyte.com` con esa credencial desde fuera (sin VPN / sin IP allowlist).
- [ ] Webhooks de la app: objeto `page` → campo `feed` suscrito; objeto `instagram` → campo `comments` suscrito.
- [ ] Dejar **una regla activa** de demo (frase `info`) en Propyte (FB) y en la cuenta IG de Propyte, para que el revisor la pueda disparar él mismo.
- [ ] Tener un post de prueba público en FB y en IG, y anotar sus URLs en las instrucciones.
- [ ] Grabar **un video por permiso** (o uno solo con capítulos y el minuto exacto citado en cada permiso).
- [ ] **UI en inglés durante la grabación**: Chrome → clic derecho → "Traducir a English" en crm.propyte.com, y Facebook/Instagram con idioma de la cuenta en inglés. Además, subtítulos en inglés (captions quemados en el video) y un callout por cada botón que se pulse ("Save = guarda la regla", "Activate = la regla empieza a responder").
- [ ] No incluir el permiso en este envío si no se va a usar: los demás ya están aprobados, este envío solo lleva los 3.

---

## 1. Texto para "Tell us how you're using this permission"

**Agregar este párrafo al inicio de los 3 permisos** (responde al punto 5 del rechazo):

> **Authentication note:** Propyte CRM is a server-to-server integration that accesses the Meta APIs with a **System User access token** generated in our own Business Manager (Business Settings → System Users). There is no Facebook Login in our app, so the Meta login flow cannot be shown. Instead, the screencast shows the System User, the Page and Instagram account assigned to it, and the permissions granted to its token, followed by the complete use case.

### pages_read_user_content

> Propyte is a real-estate company in Mexico. Propyte CRM is our internal tool; it is only connected to Facebook Pages our company owns (Propyte, Propyte Market, Nativa Tulum, Yaxnáh Caucel, Avica).
>
> People comment on our Page posts asking for prices or information about the homes we sell (e.g. "info", "precio"). Our app receives each new top-level comment through the Page `feed` webhook and needs `pages_read_user_content` to read the comment text and its author, which are user-generated content on our own Page.
>
> The comment is shown to our marketing admins in **Admin → Comment rules → Log** (author, text, post, timestamp). Our "comment rules" compare the text with keywords configured by the admin; when one matches, the app replies publicly once (see `pages_manage_engagement`) and sends one private reply. We do not read comments from Pages we do not own, we do not store comments that do not match a rule beyond the processing log, and we do not use this data for ads targeting or sell it.

### pages_manage_engagement

> When a comment on our own Facebook Page post matches a comment rule configured by our marketing admin, Propyte CRM publishes **one** public reply to that comment on behalf of the Page (`POST /{comment-id}/comments`), for example: "Thanks! We just sent you the details by private message 📩". The admin writes the reply text (with a few rotating variants) in **Admin → Comment rules**; rules are created paused and must be activated manually.
>
> Limits enforced by the app: only top-level comments, at most one reply per person per post, never replies to comments made by the Page itself (anti-loop), and every action is logged with its status (SENT / FAILED / SKIPPED) so the admin can audit it. We do not like, hide, delete or edit user comments.

### instagram_manage_comments

> Same use case for the Instagram professional accounts linked to our Pages. Propyte CRM receives new comments on our own Instagram posts through the Instagram `comments` webhook, shows them in **Admin → Comment rules → Log** (username, text, media, timestamp), and when a comment matches an admin-configured keyword rule it publishes **one** public reply to that comment (`POST /{ig-comment-id}/replies`).
>
> Same limits as on Facebook: top-level comments only, one reply per person per post, never on our own comments, everything logged and auditable. We do not hide or delete comments and we only access Instagram accounts our company owns.

---

## 2. Guion del video (screencast)

Duración objetivo: 2–3 min por permiso. Resolución ≥ 1080p, cursor visible, sin cortes en los pasos clave. Poner un título/caption en inglés en cada paso.

**Toma 0 — Acceso con System User (sustituye al login de Meta; puntos 1, 2 y 5 del rechazo)**

0a. Caption de apertura: *"Propyte CRM is a server-to-server app. It uses a System User token from our Business Manager; there is no Facebook Login, so no Meta login flow exists to show."*
0b. Abrir business.facebook.com → **Business Settings → Users → System Users** → seleccionar el System User del CRM. *Caption: "This System User is the 'user with access to the app'."*
0c. Mostrar **Assigned assets**: la Página Propyte y la cuenta de Instagram, con control total. *Caption: "Only Pages and Instagram accounts owned by our business are assigned."*
0d. Mostrar **Installed apps → Propyte CRM** y "Generate token" (sin terminar de generar o tapando el token) con los permisos marcados: `pages_read_user_content`, `pages_manage_engagement`, `instagram_manage_comments`, etc. *Caption: "The token used by the CRM includes these permissions."* **Nunca mostrar el token en pantalla.**

**Toma A — Contexto y configuración (sirve para los 3)**

1. Abrir `https://crm.propyte.com` → login con el usuario `meta-reviewer`. *Caption: "Login to Propyte CRM (internal tool, no Facebook Login)."*
2. Admin → **Integraciones**: mostrar la Página de Facebook y la cuenta de Instagram conectadas. *Caption: "Only Pages/IG accounts owned by our business are connected via System User token."*
3. Admin → **Reglas de comentarios** → crear regla:
   - Cuenta: Página Propyte (FB) — y otra para IG
   - Frase: `info`
   - Respuesta pública: "Thanks! We just sent you the details by DM 📩"
   - DM privado: texto de bienvenida
   - Guardar → mostrar que **nace en pausa** → activarla.
   *Caption: "The admin configures the keyword and the public reply. Rules start paused."*
4. (Opcional) Usar el **Probador** con `mándame info` para mostrar qué respondería, sin publicar.

**Toma B — Facebook (`pages_read_user_content` + `pages_manage_engagement`)**

5. En otra pestaña/teléfono, con una **cuenta personal de prueba**, abrir el post de prueba de la Página y comentar `info`. Que se vea el comentario publicado.
6. Volver al CRM → Reglas de comentarios → **Log**: refrescar, mostrar la fila nueva con autor, texto del comentario y post. *Caption: "pages_read_user_content: the app reads the user's comment on our Page post (feed webhook)."*
7. Mostrar en la fila "público: SENT".
8. Volver al post en Facebook → refrescar → mostrar la **respuesta pública** de la Página debajo del comentario. *Caption: "pages_manage_engagement: the app published one public reply as the Page."*
9. Comentar `info` otra vez con la misma cuenta → mostrar en el log **SKIPPED** (una respuesta por persona por post).

**Toma C — Instagram (`instagram_manage_comments`)**

10. Con cuenta personal de IG, comentar `info` en el post de prueba de Instagram.
11. CRM → Log: mostrar la fila de IG (usuario, texto, media). *Caption: "instagram_manage_comments: comment received via the Instagram comments webhook."*
12. Abrir el post en Instagram → mostrar la **respuesta pública** de la cuenta business. *Caption: "instagram_manage_comments: one public reply published by our account."*

**Cierre (opcional, refuerza que es atención al cliente)**

13. Mostrar el DM privado recibido en la cuenta personal y el hilo en el **Inbox** del CRM. *Caption: "The conversation continues in the CRM inbox, where a human advisor can take over."*

> Si se hace un solo video: en cada permiso citar los minutos, p. ej. "pages_manage_engagement: see 1:45–2:10".

---

## 3. Instrucciones para el revisor (campo "Web reviewer instructions")

> Propyte CRM is the internal CRM of Propyte, a real-estate company in Mexico, used only by our staff. **This is a server-to-server app that uses a System User access token**: there is no Facebook Login, so the Meta login flow is not shown in the screencasts. The CRM connects only to the Facebook Pages and Instagram professional accounts our company owns; the screencasts show the System User, its assigned assets and the permissions of its token instead of a login flow. The CRM interface is in Spanish; the screencasts were recorded with the browser translated to English and include English captions.
>
> **Login:** https://crm.propyte.com — user and password below (account created for Meta reviewers).
>
> **Where the permissions are used:** Admin → Comment rules ("Reglas de comentarios"). This screen lists the keyword rules, a tester, and a log of every comment received and every reply sent.
>
> **How to test it yourself:**
> 1. With any personal Facebook account, comment `info` on this post of our Page: <URL post FB>.
> 2. Within a few seconds our Page replies publicly to your comment (pages_manage_engagement) and sends you one private message. Your comment appears in Admin → Comment rules → Log (pages_read_user_content).
> 3. With any personal Instagram account, comment `info` on this post: <URL post IG>. Our account replies publicly to your comment (instagram_manage_comments) and the comment appears in the same log.
> 4. Commenting `info` again on the same post does not generate another reply (one reply per person per post).
>
> The rule for the keyword `info` is active on both accounts for the duration of the review. The screencasts show the same flow.

*(Pegar la credencial del usuario `meta-reviewer` en el campo de credenciales; no guardarla en este archivo.)*

---

## 4. Motivo del rechazo (texto de Meta, 26-oct-2026)

Igual para los 3 permisos: *"La captura de video no coincide con los detalles del caso de uso"* — Política 1.6. Caso de uso permitido; el video no mostraba la experiencia completa. Pide: login de Meta completo (o declarar System User / server-to-server), usuario con acceso, experiencia completa, UI en inglés con subtítulos y explicación de botones. Ver resumen al inicio del documento.
