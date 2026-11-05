-- 0023_revertir_nombre_solo_con_varias_sucursales_abiertas: deshace la migración 0023_nombre_solo_con_varias_sucursales_abiertas:
-- restaura el cuerpo de `comprobante_copiar_nombre_de_sucursal()` tal como lo dejó 0022 (copia el nombre SIEMPRE).
--
-- NO es destructiva: no borra ni cambia ninguna fila. Los comprobantes que 0023 dejó con el nombre nulo (empresas con una sola sucursal
-- abierta) siguen nulos: ese nombre no se recupera (la sucursal pudo renombrarse). Desde la reversión, los comprobantes NUEVOS vuelven a
-- congelar el nombre aunque la empresa tenga una sola sucursal. No toca la tabla, la columna, el CHECK ni el disparador de 0022.
--
-- Este script NO lo aplica el ejecutor de migraciones (que solo toma los archivos `NNNN_nombre.sql` de la carpeta `migraciones/`): se
-- corre a mano, revisado, en una sola transacción y con el rol dueño de la base:
--
--     BEGIN;
--     \i migraciones/reversiones/0023_revertir_nombre_solo_con_varias_sucursales_abiertas.sql
--     COMMIT;
--
-- Deja el catálogo como estaba después de 0022. Se puede repetir sin que cambie nada.

CREATE OR REPLACE FUNCTION comprobante_copiar_nombre_de_sucursal() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_nombre text;
BEGIN
  -- `comprobante_alta` (que dispara antes, N3) fija la sucursal; sin ella no hay nada que copiar.
  IF NEW.sucursal_id IS NULL THEN
    RETURN NEW;
  END IF;
  -- Con FOR SHARE: quien renombre la sucursal a la vez espera (N6). Sin la sucursal (no existe o es de otra empresa) queda nulo y la
  -- clave foránea rechaza la fila.
  SELECT s.nombre INTO v_nombre
    FROM public.sucursal s
   WHERE s.id = NEW.sucursal_id AND s.empresa_id = NEW.empresa_id
     FOR SHARE;
  NEW.sucursal_nombre := v_nombre;
  RETURN NEW;
END
$$;

-- Sin esta fila, la migración figuraría aplicada y el ejecutor no volvería a correrla.
DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre LIKE '%\_nombre_solo_con_varias_sucursales_abiertas.sql' ESCAPE '\';
  END IF;
END
$$;
