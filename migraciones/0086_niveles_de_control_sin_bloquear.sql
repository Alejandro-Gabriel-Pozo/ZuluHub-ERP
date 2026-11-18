-- 0086_niveles_de_control_sin_bloquear (número provisorio): ADR-008 opción b, `BLOQUEAR` deja de ofrecerse a las empresas y las sucursales (dueño, 18/11/2026).
-- Empresas y sucursales eligen solo entre PERMITIR y AVISAR; el sistema mantiene un bloqueo FIJO solo para la integridad del dinero, que NO se declara como control.
-- QUÉ HACE: (1) cuenta las filas de `nivel_de_control` con `BLOQUEAR` y deja la cuenta en un `RAISE NOTICE`; (2) las pasa a `AVISAR`; (3) reemplaza `nivel_de_control_nivel_ck` por `CHECK (nivel IN ('PERMITIR', 'AVISAR'))`.
-- TOCA DATOS si la cuenta no es cero (el paso 2 cambia lo que una empresa o sucursal dejó guardado): AVISAR AL DUEÑO antes de aplicarla en una base con clientes. En una base sin clientes la cuenta debe ser cero.
-- NO toca los disparadores de existencia negativa (0030) ni de recepción contra orden (0066, 0067): tienen una rama `BLOQUEAR` que con el CHECK nuevo ya no se puede alcanzar (ninguna fila puede valer `BLOQUEAR`); quedan como código muerto inofensivo.
-- Reversión: `migraciones/reversiones/0086_revertir_niveles_de_control_sin_bloquear.sql`. Vuelve a ampliar el CHECK, pero NO puede restituir qué filas eran `BLOQUEAR`: las que pasaron a `AVISAR` quedan en `AVISAR`
-- (el único rastro es el `RAISE NOTICE` de la corrida de esta migración; la auditoría no registra este cambio porque lo hace la migración, no una persona).
-- Se puede repetir sin que cambie nada (el UPDATE no encuentra filas, el CHECK se reemplaza por el mismo). Sin SECURITY DEFINER, sin funciones nuevas.
-- DEPENDE de 0007 (`nivel_de_control`). Probada por `test/integracion/niveles-de-control-migracion.test.ts`.

DO $$
DECLARE
  v_bloquear bigint;
BEGIN
  IF to_regclass('public.nivel_de_control') IS NULL THEN
    RAISE EXCEPTION 'niveles de control sin bloquear requiere 0007 aplicada antes' USING ERRCODE = '55000';
  END IF;
  -- `nivel_de_control` tiene RLS forzada: sin evadirla el conteo y el UPDATE no verían filas y el CHECK nuevo fallaría a mitad de camino.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'esta migración necesita que el rol que la corre evada RLS (superusuario o BYPASSRLS): si no, el conteo de filas no ve nada' USING ERRCODE = '55000';
  END IF;

  SELECT count(*) INTO v_bloquear FROM public.nivel_de_control WHERE nivel = 'BLOQUEAR';
  RAISE NOTICE 'niveles de control: % fila(s) con BLOQUEAR pasan a AVISAR', v_bloquear;
  IF v_bloquear > 0 THEN
    UPDATE public.nivel_de_control SET nivel = 'AVISAR' WHERE nivel = 'BLOQUEAR';
  END IF;
END
$$;

ALTER TABLE nivel_de_control DROP CONSTRAINT IF EXISTS nivel_de_control_nivel_ck;
ALTER TABLE nivel_de_control ADD CONSTRAINT nivel_de_control_nivel_ck CHECK (nivel IN ('PERMITIR', 'AVISAR'));
