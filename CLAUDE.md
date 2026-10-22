# Instrucciones para Claude Code

> Para contexto de este proyecto lee: `~/.claude/projects/c--Users-Luis/memory/project_propyte_crm.md`

## Reglas de seguridad
- NUNCA leas ni muestres el contenido de archivos .env
- NUNCA accedas a archivos .pem, .key, o carpetas .ssh/.aws
- Siempre trabaja en la rama actual, nunca cambies a main sin preguntar
- Pregunta antes de eliminar archivos o carpetas

## Lineamientos para evitar Fallos
- Antes de editar, lee MÁXIMO 3 archivos.
- No hagas grep exploratorio sin pedirlo.
- Pregunta si necesitas más contexto.

## Variables de entorno
Este proyecto usa variables de entorno definidas en .env.example
Los valores reales estan en .env (que NO debes acceder).
Consulta .env.example para conocer la estructura.

## Dependencias: solo pnpm 10 (#921)
- Producción (Hostinger) instala con **pnpm 10** a partir de `pnpm-lock.yaml`. La CI usa lo mismo, con `--frozen-lockfile`.
- **No uses `npm install` ni `npm ci`**: generarían `package-lock.json`, que está en `.gitignore`. Usa `npx pnpm@10 install` (o `pnpm install` si lo tienes instalado), y `npx pnpm@10 add <paquete>` para agregar uno.
- Si cambias `package.json`, commitea también `pnpm-lock.yaml`. Si no, la CI falla con `ERR_PNPM_OUTDATED_LOCKFILE`, y es a propósito.
- `npm run <script>` sigue funcionando para correr scripts (`build`, `lint`, `typecheck`, `test`).

## Estructura del proyecto
<!-- Describe aqui la estructura de tu proyecto -->

## Convenciones
<!-- Agrega aqui las convenciones de codigo de tu equipo -->
