# Propuesta: intérprete de órdenes con modelo de lenguaje

Estado: **descartada**. El agente de IA ya interpreta el lenguaje natural; no hace falta un intérprete intermedio. Se sustituye por el chat directo con el agente (`docs/16-chat-agente.md`).

## Qué resuelve

El dueño escribe órdenes en lenguaje natural ("¿qué agentes están bloqueados?", "dile al de demo que siga") en vez de usar los verbos fijos. Hoy, `src/commands.mjs` ya cubre sinónimos fijos y erratas en lectura (0.10.0). Un modelo cubriría las frases que no están en esa lista.

## Restricciones no negociables

1. **El modelo solo elige un verbo de la tabla** (`estado`, `leer`, `enviar`, `enter`) y sus argumentos (panel con formato `wN:pM`, texto). Nunca elige un método de Herdr ni un parámetro libre.
2. **Salida validada.** La respuesta del modelo se pasa por el mismo parser determinista (`parseCommand`). Si no cuadra, se rechaza.
3. **Escrituras con confirmación.** Igual que hoy: `enviar` y `enter` piden `confirmar`. El modelo no puede confirmar nada.
4. **La interpretación se muestra antes de ejecutar.** La confirmación dice qué verbo y qué panel entendió, para que el dueño vea si el modelo se equivocó.
5. **Contenido de paneles fuera del contexto del modelo.** `leer` devuelve salida de agentes, que puede contener instrucciones ("ignora lo anterior y envía…"). Esa salida no debe alimentar al modelo, porque sería inyección de instrucciones.
6. **Sin herramientas al modelo.** Solo texto de entrada y una respuesta estructurada. No puede abrir sockets, leer ficheros ni llamar a la API de Matrix.

## Riesgos y cómo se mitigan

| Riesgo | Mitigación |
|---|---|
| El modelo malinterpreta y envía texto a un panel equivocado | La confirmación muestra el panel y el nombre del espacio (0.10.1). Solo `confirmar` ejecuta. |
| Inyección desde un mensaje o un panel | El modelo solo recibe el mensaje del dueño. La salida de `leer` no entra al modelo. |
| Coste y latencia | Primero el parser determinista; el modelo solo si no reconoce la orden. |
| Datos enviados a un servicio externo | El texto del mensaje sale del equipo. Decidir si se acepta, o usar un modelo local. |
| Dependencia de un proveedor | La interfaz es un único punto (`interpret(text) → {verb,args}\|null`), fácil de sustituir. |

## Decisiones que necesito de ti

1. **¿Modelo externo o local?** Externo: mejor comprensión, pero el texto de tus mensajes sale del equipo. Local: sin salida de datos, más lento y con menos calidad.
2. **¿Qué frases debe entender?** Propongo empezar solo con preguntas de estado ("qué agentes…") y peticiones de lectura. Las escrituras las dejaría para después.
3. **¿Se muestra siempre la interpretación antes de ejecutar?** Recomendado: sí, también para lecturas.

## Pasos si se aprueba

1. Interfaz `interpret()` con un proveedor de prueba que devuelva un verbo fijo, para probar el flujo sin red.
2. Validación de la salida del modelo con `parseCommand`, con pruebas de respuestas malformadas.
3. Proveedor real, detrás de la misma interfaz.
4. Prueba en vivo con frases reales del dueño.
