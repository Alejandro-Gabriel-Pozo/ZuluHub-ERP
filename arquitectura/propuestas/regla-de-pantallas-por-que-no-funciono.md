# Por qué no funcionó la regla de las pantallas, y qué reglas la arreglan

Estado: PROPUESTA para aprobación del dueño (vía el orquestador). No hay código de reglas todavía. Fecha: 27/11/2026.
Regla de origen: CLAUDE.md «todo texto y toda pantalla están declarados».

## 1. Causa raíz

1. **El chequeo solo mide.** `declaracion-de-pantallas.test.ts` escribe un informe y falla solo si el propio chequeo se rompe (CLAUDE.md lo dice: «hoy MIDE y no falla por lo existente»). Los tramos que lo iban a activar (U4) nunca se hicieron.
2. **Solo mira lo declarado.** P1, P3 y P4 se aplican únicamente a los archivos que una ficha nombra; fuera de ellas solo se cuentan: informe local `medidas.botonesSinId` = 407 de 407 botones y `modalesSinId` = 38 de 38. Una pantalla sin ficha no genera ninguna falla.
3. **No mira alcanzabilidad.** Nada verifica que una ruta de `apps/web` (134 páginas) tenga fila de menú o un enlace desde otra pantalla. Auditoría del menú: pantallas huérfanas (carta en línea, cuentas de fotos, ficha de producto, entre otras).
4. **No mira el servidor contra la pantalla.** Nada cruza cada caso de uso o consulta pública con una pantalla o con una declaración «solo servidor». Censo (391 funciones): 95 sin pantalla ni terminal; portal entero sin cablear; modelo Libro y «Frase final» de la carta sin campo en la pantalla.
5. **Fichas incompletas.** Hay ~45 archivos de ficha para 134 páginas web + 17 de plataforma (Padre contó 49 de 120 sin ficha): lo que no tiene ficha no se mide.
6. **«Hecho» no incluye un recorrido de usuario.** Se entregaron tramos de servidor con sus pruebas y se dieron por terminados; ningún criterio exige abrir el menú y llegar a la función. Los recorridos (`test:recorrido`) cubren flujos puntuales, no «cada capacidad nueva se alcanza».
7. **Resultado:** cada pieza pasó su chequeo y nadie chequeó la suma.

## 2. Reglas propuestas

Cada una: qué falla, violación inyectada en `test/arquitectura/`, y lo existente con deuda (vencimiento ≤ 90 días, presupuesto que solo baja), como `campos-sin-dato`.

**(a) Alcanzabilidad.** Toda ruta de `apps/web` y `apps/plataforma` tiene una fila de menú o un enlace desde otra pantalla (grafo de la auditoría: rutas del árbol `app/` contra `href`/helpers de ruta). Lo nuevo sin acceso FALLA; las huérfanas actuales entran como deuda. Previene: pantallas terminadas a las que nadie llega. Inyectada: una `page.tsx` nueva sin fila ni enlace.

**(b) Registro de funciones.** Todo caso de uso o consulta pública declara `CON_PANTALLA(ruta)` o `SOLO_SERVIDOR(motivo, tramo previsto)` en un registro único. Lo nuevo sin declarar FALLA; los 95 actuales entran con presupuesto; una declaración `CON_PANTALLA` cuya ruta no existe o no es alcanzable (regla a) también falla. Previene: servidor «hecho» sin que nadie sepa que falta la pantalla. Inyectada: caso nuevo sin declaración; `CON_PANTALLA` con ruta inexistente.

**(c) Ficha obligatoria para pantallas nuevas.** Una `page.tsx` nueva sin ficha FALLA (P1 a P4 pasan a exigirse en sus archivos); las existentes sin ficha, deuda con presupuesto. Previene: lo que hoy solo se mide. Inyectada: página nueva sin ficha.

**(d) Definición de «hecho».** Un PR que agrega una capacidad de usuario trae un recorrido real (`*.recorrido.ts`) que parte del menú y llega a la función; se declara en la descripción del PR y lo exige la plantilla. Mecánico donde se pueda: el registro de (b) con `CON_PANTALLA(ruta)` exige un recorrido que visita esa ruta. Previene: «hecho» sin recorrido de punta a punta. Inyectada: `CON_PANTALLA` sin recorrido que la visite.

## 3. Costos y orden sugerido

Orden: (b) y (a) primero (cierran el hueco que se vio); luego (c); (d) al final porque depende de (a) y (b). Cada una trae su registro de deuda y su prueba; la regla de CLAUDE.md se actualiza al activarse. Supuesto: el registro de (b) se arma desde el censo ya hecho. Decisión del dueño pendiente: si lo existente sin pantalla (95) se agenda o se declara `SOLO_SERVIDOR`.
