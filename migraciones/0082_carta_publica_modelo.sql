-- 0082_carta_publica_modelo (número PROVISORIO: lo asigna el orquestador): el modelo con el que cada carta se dibuja para el comensal, `LISTA` o `LIBRO`.
-- Hasta ahora toda carta se ve como Lista (`carta-libro-especificacion` §3 y §11, tramo L-1; dueño, fila 53 del 12/11/2026 «portal siempre, libro perilla»; Q1 A del 16/11/2026).
-- Se guarda lo que ELIGE la sucursal; lo que se muestra lo decide `modeloEfectivo` (perilla `vidriera_modelo_libro`, ahorro de datos, valor desconocido: ante la duda, Lista).
-- Previene: una elección que se pierde al bajar de plan (queda guardada y la carta se ve en Lista) y un valor fuera de la lista cerrada de modelos (lo impide la base, no el formulario).
-- Probado por `test/integracion/carta-publica-modelo.test.ts`.
--
-- Reglas de esta migración (las mismas de 0036, 0047 y 0058):
--  * ADITIVA y compatible hacia atrás: una columna `text NOT NULL DEFAULT 'LISTA'` con CHECK de lista blanca (todas las cartas que existen quedan en Lista; el código anterior no la
--    nombra y la inserción sigue sin pasarla). No toca datos, no agrega funciones ni cambia roles, no agrega DELETE.
--  * Permisos por columna, como el resto de `carta_publica`: la aplicación puede ACTUALIZARLA (no insertarla: nace en Lista) y el rol público puede LEERLA (la pantalla de la carta la necesita).
--    El disparador `carta_publica_version` ya sube la versión en cada UPDATE (bloqueo optimista) y `carta_publica_cambio` no cambia.
--  * La lista permitida es SOLO `LISTA` y `LIBRO`: Cuadrícula y Tablero se suman con su propia migración cuando existan (nada se habilita sin declararlo).
--  * Su reversión es `migraciones/reversiones/0082_revertir_carta_publica_modelo.sql` (frena si hay cartas en Libro: quitar la columna las pasaría a Lista sin avisar).
-- DEPENDE de 0043 (la tabla, su disparador de versión y sus permisos); se comprueba al empezar.

DO $$
BEGIN
  IF to_regclass('public.carta_publica') IS NULL THEN
    RAISE EXCEPTION '0082 necesita 0043 (carta_publica)';
  END IF;
END
$$;

ALTER TABLE carta_publica
  ADD COLUMN modelo text NOT NULL DEFAULT 'LISTA'
  CONSTRAINT carta_publica_modelo_ck CHECK (modelo IN ('LISTA', 'LIBRO'));

GRANT UPDATE (modelo) ON carta_publica TO pedernal_app;
GRANT SELECT (modelo) ON carta_publica TO pedernal_publico;
