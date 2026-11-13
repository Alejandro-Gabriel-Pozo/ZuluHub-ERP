-- 0050_revertir_plan_en_la_lectura_publica_de_carta: deshace la migración 0050_plan_en_la_lectura_publica_de_carta: quita al rol público la lectura de módulos,
-- plan y ajustes (columnas y las cuatro políticas). NO borra ni cambia ningún dato: solo permisos y políticas. Sin esa lectura, la visita a una carta termina en
-- error de base (no se disfraza de «no disponible»), así que conviene bajar primero el código que la usa (T6). Lo de 0043 y 0044 queda como estaba.
--
-- Este script NO lo aplica el ejecutor de migraciones (solo toma los `NNNN_nombre.sql` de `migraciones/`): se corre a mano, revisado, en una sola transacción y con
-- el rol dueño de la base:
--
--     BEGIN;
--     \i migraciones/reversiones/0050_revertir_plan_en_la_lectura_publica_de_carta.sql
--     COMMIT;
--
-- Se puede repetir sin que cambie nada.

DROP POLICY IF EXISTS ajuste_de_perilla_publico_de_carta ON ajuste_de_perilla;
DROP POLICY IF EXISTS version_de_plan_publico_de_carta ON version_de_plan;
DROP POLICY IF EXISTS plan_de_tenant_publico_de_carta ON plan_de_tenant;
DROP POLICY IF EXISTS modulo_de_empresa_publico_de_carta ON modulo_de_empresa;

REVOKE SELECT ON ajuste_de_perilla, version_de_plan, plan_de_tenant, modulo_de_empresa FROM pedernal_publico;

-- Sin esta fila, la migración figuraría aplicada y el ejecutor no volvería a correrla.
DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre = '0050_plan_en_la_lectura_publica_de_carta.sql';
  END IF;
END
$$;
