-- 0044_revertir_lectura_publica_de_carta: deshace la migración 0044_lectura_publica_de_carta: quita al rol público la lectura del catálogo (columnas, ejecución de
-- `precio_vigente` y las nueve políticas). NO borra ni cambia ningún dato: solo permisos y políticas. Sin la lectura, el adaptador de la carta pública no puede
-- servir ninguna carta (responde error de base: ver T3), así que conviene bajar primero ese código. `carta_publica` y `disponibilidad_de_producto` (0043) quedan
-- como estaban.
--
-- Este script NO lo aplica el ejecutor de migraciones (solo toma los `NNNN_nombre.sql` de `migraciones/`): se corre a mano, revisado, en una sola transacción y con
-- el rol dueño de la base:
--
--     BEGIN;
--     \i migraciones/reversiones/0044_revertir_lectura_publica_de_carta.sql
--     COMMIT;
--
-- Se puede repetir sin que cambie nada.

DROP POLICY IF EXISTS precio_de_venta_publico_de_carta ON precio_de_venta;
DROP POLICY IF EXISTS version_de_opcion_publico_de_carta ON version_de_opcion;
DROP POLICY IF EXISTS opcion_publico_de_carta ON opcion;
DROP POLICY IF EXISTS grupo_de_elecciones_publico_de_carta ON grupo_de_elecciones;
DROP POLICY IF EXISTS producto_publico_de_carta ON producto;
DROP POLICY IF EXISTS seccion_de_carta_publico_de_carta ON seccion_de_carta;
DROP POLICY IF EXISTS sucursal_publico_de_carta ON sucursal;
DROP POLICY IF EXISTS tenant_publico_de_carta ON tenant;
DROP POLICY IF EXISTS empresa_publico_de_carta ON empresa;

REVOKE EXECUTE ON FUNCTION precio_vigente(uuid, uuid, uuid, uuid, timestamptz) FROM pedernal_publico;
REVOKE SELECT ON precio_de_venta, version_de_opcion, opcion, grupo_de_elecciones, producto, seccion_de_carta, sucursal, tenant, empresa FROM pedernal_publico;

-- Sin esta fila, la migración figuraría aplicada y el ejecutor no volvería a correrla.
DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre = '0044_lectura_publica_de_carta.sql';
  END IF;
END
$$;
