# Prompt de sincronización desde el proyecto padre

Prompt reutilizable para analizar las novedades del proyecto padre y decidir qué incorporar en este proyecto (hijo). Copiar el bloque de abajo, reemplazar los marcadores `<...>` y pegarlo en una sesión de Claude Code abierta en este repositorio.

Este repositorio es una copia saneada: no tiene historial del padre. La única referencia de versión es `package.json` y `CHANGELOG.md`.

---

```text
Actúa sobre el repositorio hijo (directorio actual) para analizar las novedades del proyecto padre.

Datos de partida:
- Ruta local del padre: <RUTA_PADRE>
- Repositorio git del padre (si la ruta local no existe, clónalo desde la variable `PADRE_REPO_URL` del archivo `.env` del hijo, que está ignorado por git): <URL_REPO_PADRE>
- Versión sincronizada en el hijo: <VERSION_HIJO> (leer de package.json y CHANGELOG.md del hijo)
- Idioma de respuesta: español

Pasos:
1. Lee la versión actual del padre en su package.json y el CHANGELOG.md del padre. Usa solo las secciones posteriores a <VERSION_HIJO>.
2. Del CHANGELOG del padre, toma únicamente las secciones "Añadido", "Cambiado", "Corregido" y "Seguridad". Ignora las secciones "Pendiente" y "Verificado".
3. Para cada cambio, revisa el código del padre solo si el CHANGELOG no basta para decidir. No copies nada todavía.
4. Clasifica cada cambio en una de estas categorías:
   - Incorporar: funcionalidad, corrección o mejora aplicable al hijo.
   - Ya existe: el hijo ya tiene el cambio (compruébalo en su código).
   - Descartar: específico de la infraestructura o del entorno del padre.
   - Pregunta: no está claro si aplica; anótala para preguntarme.

Reglas de exclusión (obligatorias):
- No importes planes, temas pendientes, pruebas, informes, análisis de seguridad, notas internas ni contadores de pruebas.
- No importes ni leas para copiar estas rutas del padre: `.claude/`, `.opencode/`, `skills/` (cualquier carpeta de skills), `plans/`, `planes/`, `informes/` y `bin/`.
- No importes `FILEMAP.md`, `ARCHITECTURE.md` ni `SECURITY.md` salvo que yo lo pida.
- No incluyas en ningún texto, código, documento o commit:
  - URLs, hosts, puertos, rutas absolutas o nombres de usuario del padre o de su máquina.
  - Nombres de salas, workspaces, paneles, proyectos o clientes reales del padre.
  - Identificadores de salas, usuarios, dispositivos o sesiones.
  - Tokens, claves, contraseñas, secretos o cualquier dato personal.
  Si un cambio los menciona, reescríbelo con marcadores genéricos (por ejemplo `<sala>`, `<workspace>`, `usuario@ejemplo.org`).
- Usa dominios reservados (example.org) y nombres genéricos en cualquier ejemplo.

Entrega:
1. Tabla con: versión del padre, cambio, categoría y motivo (una línea por cambio).
2. Lista de preguntas para mí, numeradas, antes de tocar código.
3. No modifiques archivos del hijo hasta que yo responda las preguntas, salvo que te lo pida explícitamente.
4. No hagas commit ni push sin que yo lo pida.

Al terminar, indica la versión del padre que queda analizada para usarla como <VERSION_HIJO> en la próxima sincronización.
```

---

## Notas de uso

- `<RUTA_PADRE>`: directorio local del padre. No la publiques en el repositorio hijo.
- `<URL_REPO_PADRE>`: guárdala en `.env` como `PADRE_REPO_URL=...`. `.env` ya está en `.gitignore`, así que no se publica. No la escribas en este archivo.
- `<VERSION_HIJO>`: versión sincronizada actual: `0.24.1`, la misma que el padre. Se actualiza tras cada sincronización aceptada.
- El prompt no fija qué se incorpora: esa decisión la toma la persona que revisa la tabla.
