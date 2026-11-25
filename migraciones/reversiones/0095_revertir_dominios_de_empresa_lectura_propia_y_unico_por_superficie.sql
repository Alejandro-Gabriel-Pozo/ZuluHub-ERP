-- 0095_revertir_dominios_de_empresa_lectura_propia_y_unico_por_superficie: deshace 0095_dominios_de_empresa_lectura_propia_y_unico_por_superficie. Quita la política de
-- lectura propia (la aplicación vuelve a leer solo los dominios canónicos) y el índice único por empresa y superficie. NO borra ni cambia ninguna fila. Conviene bajar antes
-- el código que muestra la dirección propia de la carta (sin la política mostraría siempre la de Pedernal) y el que traduce el error de «ya tiene un host de esa superficie».
--
-- Este script NO lo aplica el ejecutor de migraciones: se corre a mano, revisado, en una sola transacción y con el rol dueño de la base:
--
--     BEGIN;
--     \i migraciones/reversiones/0095_revertir_dominios_de_empresa_lectura_propia_y_unico_por_superficie.sql
--     COMMIT;
--
-- Se puede repetir sin que cambie nada.

DROP POLICY IF EXISTS dominio_app_leer_propio ON dominio;
DROP INDEX IF EXISTS dominio_empresa_superficie_uk;

-- Sin esta fila, la migración figuraría aplicada y el ejecutor no volvería a correrla.
DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre = '0095_dominios_de_empresa_lectura_propia_y_unico_por_superficie.sql';
  END IF;
END
$$;
