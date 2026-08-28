# Tablero de Mejoras IA — este repo

`proyecto` de este repo: **`crm`**

**Pide `mejoras_get_protocol` antes de tomar una tarjeta.** Las reglas del tablero —cómo se
toma una tarea, qué se escribe al cerrarla, qué está prohibido— las sirve el Hub, no este
archivo. Aquí solo vive lo que el Hub no puede saber.

Vivían solo en el repo del Hub, invisibles desde aquí. Por eso este archivo existe.

## Lo que solo sabe este repo

- **Puerta del tablero:** las tools `mejoras_*`. Si no las tienes, el tablero no se toca a
  mano por SQL.
- **Rama:** `mejora/<id>-<slug>`, desde `origin/main` y no desde el `main` local.
- **En un `git worktree` propio.** El árbol principal lo comparten varias sesiones y su rama
  cambia sin avisar.
- **`gh` no está en el PATH:** `"/c/Program Files/GitHub CLI/gh.exe"`.
- Panel del tablero: https://hub.propyte.com/mejoras
- Lo demás de este repo está en `CLAUDE.md`, que manda sobre este archivo si se contradicen.

## Nunca

- **Mergear ni desplegar.** La puerta humana está en el merge.
- **Tocar `propyte_crm.users` sin mirar el Hub.** Los dos comparten esa tabla, así que un
  cambio de esquema aquí sale en el otro producto.
