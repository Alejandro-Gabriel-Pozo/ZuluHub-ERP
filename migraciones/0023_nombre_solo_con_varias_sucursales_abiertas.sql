-- 0023_nombre_solo_con_varias_sucursales_abiertas: el comprobante congela el NOMBRE de la sucursal SOLO si la empresa tenía MÁS DE UNA
-- sucursal ABIERTA al darse de alta; con una sola abierta, `comprobante.sucursal_nombre` queda NULO («nada que imprimir») y la factura
-- lleva solo la razón social (decisión del dueño, 2026-11-05, opción B de la maqueta; D-114 con la regla de «una sola sucursal»).
-- Complementa 0022 (que copia el nombre siempre): NO la edita, la deja aplicada y reemplaza solo el CUERPO de la función del disparador.
--
-- Reglas de esta migración (las mismas de 0001 a 0022):
--  * Es ADITIVA en el esquema: ninguna tabla, columna, restricción, privilegio ni disparador nuevo o cambiado. Solo `CREATE OR REPLACE`
--    del cuerpo de `comprobante_copiar_nombre_de_sucursal()` (0022), con la misma firma, el mismo `search_path` y el mismo dueño. No toca
--    ninguna fila: los comprobantes ya emitidos conservan lo que congelaron (con nombre o sin él) y se reimprimen igual.
--  * Su reversión es un script aparte, revisado y NO destructivo: restaura la función de 0022
--    (`migraciones/reversiones/0023_revertir_nombre_solo_con_varias_sucursales_abiertas.sql`). No recupera el nombre de los comprobantes
--    que esta migración dejó nulos (con una sola sucursal): quedan como están. El ejecutor no la aplica.
--  * Sin SECURITY DEFINER ni nada que pida superusuario (la corre el rol dueño de la base de Neon, `neondb_owner`). La aplicación ya
--    lee TODAS las sucursales de su empresa (política `sucursal_app_leer`, 0001: filtra solo por empresa) y la columna `activa`.
--  * Se aplica una sola vez, como las anteriores (el ejecutor lleva el registro).
--  * DEPENDE de 0022 (la función y el disparador que reemplaza); se comprueba al empezar.
--
-- Decisiones de diseño (todas probadas por tests):
--
--  V1. «Abierta» es `sucursal.activa = true`: es lo que el código ya entiende por abierta (`resolverSucursal`, src/capacidades/permisos/
--      alcance.ts: «una sola se entiende entre las abiertas», `elegibles.filter((s) => s.activa)`; D-36 y D-37) y lo que usa 0017 para
--      impedir emitir desde una cerrada (`SELECT s.activa`). Se cuentan las de la EMPRESA del comprobante (`empresa_id = NEW.empresa_id`),
--      todas, sin mirar qué sucursales puede ver quien emite: el nombre congelado no depende del operador.
--  V2. «Más de una» = al menos DOS abiertas; el conteo se corta en 2 (`LIMIT 2`) porque no hace falta saber cuántas más hay. Con una
--      sola abierta, con ninguna abierta (una nota sobre una factura de una sucursal que se cerró) o sin la sucursal (la clave foránea
--      rechaza la fila), la columna queda NULA. Fuente de la regla: decisión del dueño citada arriba.
--  V3. «Al emitir» es al crear el comprobante (alta PENDIENTE), igual que 0019 y 0022: el conteo se hace en la misma transacción del alta.
--      Una NOTA se evalúa con las sucursales ABIERTAS de la empresa de hoy, y toma el nombre de SU sucursal (la del comprobante que corrige).
--  V4. Concurrencia. La sucursal del comprobante sigue leída con FOR SHARE (renombrar y emitir a la vez, 0022 N6). Abrir o cerrar OTRA
--      sucursal a la vez que se emite no necesita bloqueo: el conteo ve lo confirmado al empezar la sentencia y el resultado es el de un
--      orden válido (la emisión antes o después del cambio); nunca un valor a medias. Bajo SERIALIZABLE, la lectura del conjunto y el
--      alta o el cambio concurrente de otra sucursal pueden chocar con 40001, que la aplicación ya repite. El comprobante, una vez creado,
--      sigue siendo inmutable (`comprobante_validar_cambio`, 0009): abrir la segunda sucursal después no cambia lo congelado.
--  V5. Idempotencia: repetir el alta con la misma clave no vuelve a evaluar nada (la unicidad del origen rechaza el duplicado y el
--      comprobante original queda como estaba). Probado.

DO $$
BEGIN
  IF to_regprocedure('public.comprobante_copiar_nombre_de_sucursal()') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = to_regclass('public.comprobante') AND attname = 'sucursal_nombre' AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'el nombre solo con varias sucursales abiertas requiere 0022_nombre_de_la_sucursal_en_el_comprobante aplicada antes (falta la columna o la función)'
      USING ERRCODE = '55000';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION comprobante_copiar_nombre_de_sucursal() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_nombre text;
  v_abiertas integer;
BEGIN
  -- `comprobante_alta` (que dispara antes, 0022 N3) fija la sucursal; sin ella no hay nada que copiar.
  IF NEW.sucursal_id IS NULL THEN
    RETURN NEW;
  END IF;
  -- Con FOR SHARE: quien renombre la sucursal a la vez espera (0022 N6). Sin la sucursal (no existe o es de otra empresa) queda nulo y la
  -- clave foránea rechaza la fila.
  SELECT s.nombre INTO v_nombre
    FROM public.sucursal s
   WHERE s.id = NEW.sucursal_id AND s.empresa_id = NEW.empresa_id
     FOR SHARE;
  -- V1 y V2: las abiertas (`activa`) de ESTA empresa, contadas hasta 2.
  SELECT count(*) INTO v_abiertas
    FROM (SELECT 1 FROM public.sucursal s WHERE s.empresa_id = NEW.empresa_id AND s.activa LIMIT 2) q;
  IF v_abiertas > 1 THEN
    NEW.sucursal_nombre := v_nombre;
  ELSE
    NEW.sucursal_nombre := NULL;
  END IF;
  RETURN NEW;
END
$$;
