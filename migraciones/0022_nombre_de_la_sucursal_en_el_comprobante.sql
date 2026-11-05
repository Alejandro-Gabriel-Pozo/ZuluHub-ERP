-- 0022_nombre_de_la_sucursal_en_el_comprobante: el COMPROBANTE congela el NOMBRE de la sucursal que tenía al darse de alta
-- (decisión del dueño, D-114, 2026-11-05: «la factura impresa muestra el nombre de la sucursal arriba y la razón social debajo; el
-- nombre se congela en cada comprobante al emitirse: si después se renombra la sucursal, una reimpresión sale igual»). Texto en
-- Pedernal-docs/11-especificaciones/facturador-contratos-de-pantalla.md. Mismo patrón que 0019 (contacto de la sucursal).
--
-- Reglas de esta migración (las mismas de 0001 a 0021):
--  * Es ADITIVA: una columna nula en `comprobante`, una función, un disparador y un CHECK sobre esa columna (espejo de los de `sucursal.nombre`). No toca ninguna fila
--    existente, ninguna función existente ni nada de 0019 (que queda INTACTA, también donde ya está aplicada: esto se aplica encima).
--    Una columna nula SIN default no reescribe la tabla ni dispara nada.
--  * Los comprobantes que ya existen (emitidos o en vuelo) quedan con `sucursal_nombre` NULO y se reimprimen igual que hoy. Nada se
--    rellena: el nombre que tenía la sucursal al emitir no se puede reconstruir (pudo renombrarse).
--  * Su reversión es un script aparte, revisado y DESTRUCTIVO en lo único que agrega (borra el nombre que cada comprobante congeló, y
--    eso no se puede recomputar): `migraciones/reversiones/0022_revertir_nombre_de_la_sucursal_en_el_comprobante.sql`. El ejecutor no
--    lo aplica.
--  * No agrega ninguna función SECURITY DEFINER ni usa nada que pida superusuario: la corre el rol dueño de la base de Neon
--    (`neondb_owner`, CREATEROLE, sin ser superusuario). Una prueba la corre con ese rol.
--  * Sin privilegios nuevos: la aplicación no recibe INSERT ni UPDATE sobre la columna (la copia el disparador y el de cambios la deja
--    inmutable); ya lee `comprobante` entera con el SELECT de tabla de 0009.
--  * Se aplica una sola vez, como las anteriores (el ejecutor lleva el registro).
--  * DEPENDE de 0016 (la sucursal del comprobante y el disparador que la exige); se comprueba al empezar.
--
-- Decisiones de diseño (todas probadas por tests):
--
--  N1. La BASE copia el nombre, no la aplicación (como `sucursal_id` en 0016 y el contacto en 0019): el disparador
--      `comprobante_alta_sucursal_nombre` lee la sucursal del comprobante con FOR SHARE y deja en la fila nueva el nombre VIGENTE EN
--      ESE MOMENTO, pise lo que pise quien inserte. «Al emitir» es al crear el comprobante (alta PENDIENTE), no cuando ARCA autoriza
--      (SUPUESTO del ingeniero; es la misma regla del contacto, 0019 C2). Una NOTA lleva el nombre de SU sucursal (la del
--      comprobante que corrige, 0016 S6), no el de la factura corregida (SUPUESTO del ingeniero, como 0019 C3).
--  N2. UN DISPARADOR APARTE y no un CREATE OR REPLACE de `comprobante_copiar_contacto`: 0019 queda como está donde ya se aplicó, y la
--      reversión de esta migración es borrar lo que ella agrega (no hay que restaurar el cuerpo de una función ajena). Costo: una
--      segunda lectura de la misma fila de sucursal; como el primer disparador ya la tiene bloqueada con FOR SHARE hasta el final de
--      la transacción, nadie puede cambiarla entre las dos lecturas: el contacto y el nombre congelados salen del mismo estado.
--  N3. Orden: los BEFORE INSERT de un mismo evento corren por orden alfabético. `comprobante_alta_sucursal_nombre` va DESPUÉS de
--      `comprobante_alta` (que fija `sucursal_id`) y de `comprobante_alta_contacto`. Una prueba lo fija con una sonda; si
--      `sucursal_id` llegara vacío, no se copia nada y la columna queda nula (la fila no puede confirmarse: lo impide
--      `comprobante_con_sucursal`, 0016 S4).
--  N4. Nulo = «no hay nombre que imprimir» (comprobante anterior a esta migración). Un valor presente repite EXACTAMENTE los tres CHECK
--      que ya tiene `sucursal.nombre` (0001 `sucursal_nombre_ck`: no vacío y sin blancos en los extremos; 0005 `sucursal_nombre_largo_ck`:
--      hasta LARGO_MAXIMO_DEL_NOMBRE_DE_SUCURSAL = 100 caracteres; 0005 `sucursal_nombre_control_ck`: sin caracteres de control).
--      Por construcción NINGÚN nombre válido de una sucursal puede ser rechazado al copiarse (si el CHECK del comprobante fuera más
--      estricto, esa sucursal no podría emitir nunca: el alta de cada comprobante fallaría); por eso tampoco repite la normalización NFC,
--      que `nombreDeSucursalValido` hace en el dominio pero la base no exige. Una prueba compara las dos puntas (los tres CHECK de la
--      sucursal, el CHECK del comprobante y la constante del dominio).
--  N5. Inmutable sin código nuevo: `comprobante_validar_cambio` compara todo el contenido (`to_jsonb`) salvo las columnas del estado;
--      el nombre no es del estado, así que ni el dueño de la base puede cambiarlo después.
--  N6. Editar el nombre de la sucursal a la vez que se emite: el FOR SHARE del disparador y el UPDATE de la edición se esperan (uno u
--      otro va primero: el comprobante congela el nombre de antes o el de después, nunca un valor a medias).

DO $$
BEGIN
  IF to_regprocedure('public.comprobante_validar_alta()') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = to_regclass('public.comprobante') AND attname = 'sucursal_id' AND NOT attisdropped
  ) OR to_regprocedure('public.comprobante_exigir_sucursal()') IS NULL THEN
    RAISE EXCEPTION 'el nombre de la sucursal en el comprobante requiere 0016_comprobante_con_sucursal aplicada antes (falta la sucursal del comprobante o su disparador)'
      USING ERRCODE = '55000';
  END IF;
END
$$;

-- Espejo de los tres CHECK de `sucursal.nombre` (N4) y de LARGO_MAXIMO_DEL_NOMBRE_DE_SUCURSAL = 100 (src/modulos/empresas/dominio/sucursal.ts):
-- si cambia el tope o la forma, cambian todas las puntas (la constante y un CHECK nuevo en cada tabla). Sin privilegio de columna para
-- la aplicación: no se otorga ningún GRANT sobre `sucursal_nombre`.
ALTER TABLE comprobante
  ADD COLUMN sucursal_nombre text CONSTRAINT comprobante_sucursal_nombre_ck CHECK (
    sucursal_nombre !~ '^\s|\s$' AND sucursal_nombre <> ''
    AND char_length(sucursal_nombre) <= 100
    AND sucursal_nombre !~ '[\x01-\x1F\x7F-\x9F]');

CREATE FUNCTION comprobante_copiar_nombre_de_sucursal() RETURNS trigger LANGUAGE plpgsql
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

CREATE TRIGGER comprobante_alta_sucursal_nombre BEFORE INSERT ON comprobante
  FOR EACH ROW EXECUTE FUNCTION comprobante_copiar_nombre_de_sucursal();
