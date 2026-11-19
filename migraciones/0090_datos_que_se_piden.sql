-- 0090_datos_que_se_piden (número PROVISORIO; lo asigna la orquestadora): PR-7-caja. Cada medio de pago puede marcar, dato por dato, que el dato «se pide», y cada cobro
-- queda sellado, al registrarse, con los datos pedidos que quedaron vacíos (criterio permisivo del dueño, 18/11/2026: se registra y se etiqueta «pendiente»; nada se rechaza por un dato que falta).
-- Reemplaza al tramo T1 de la parametrización de medios de pago (columnas `obligatorio_*` con rechazo), que quedó sin efecto y nunca se construyó.
-- QUÉ HACE: (1) `medio_de_pago`: cinco columnas `avisa_si_falta_<dato>` (boolean NOT NULL DEFAULT false) y `medio_de_pago_avisa_ck` (no se puede pedir un dato que el medio no muestra, `pide_<dato>`);
--   permiso de UPDATE de esas columnas para el rol de la aplicación. (2) `cobro`: columna `datos_pendientes text[] NOT NULL DEFAULT '{}'` con un CHECK (subconjunto de los cinco datos, sin repetidos);
--   el rol de la aplicación NO recibe INSERT sobre ella. (3) Reemplaza `cobro_validar_alta` (disparador BEFORE INSERT de 0027): mismo cuerpo, más el sello calculado por la base
--   (los datos con `avisa_si_falta_<dato>` verdadero en el medio del movimiento y la columna del dato nula, en el orden fijo cupón, últimos 4, marca, cuotas, DNI). Ningún rechazo nuevo.
-- NO ES ADITIVA en sentido estricto: reemplaza el cuerpo de una función (sin tocar datos). Lo demás son columnas nuevas con valor por defecto: los cobros existentes quedan con `{}` (correcto: nada se les pedía).
-- NO DESTRUYE NADA. `cobro` sigue siendo de solo inserción: el sello no se cambia nunca, ni con una corrección de medio.
-- Reversión: `migraciones/reversiones/0090_revertir_datos_que_se_piden.sql` (restituye el cuerpo anterior y borra las seis columnas: PIERDE qué datos se pedían y qué cobros quedaron con datos pendientes; avisar al dueño antes de revertir con datos).
-- DEPENDE de 0027 (`medio_de_pago`, `cobro`, `cobro_validar_alta`). Probada por `test/integracion/caja-datos-que-se-piden-migracion.test.ts`.

DO $$
BEGIN
  IF to_regclass('public.cobro') IS NULL OR to_regclass('public.medio_de_pago') IS NULL THEN
    RAISE EXCEPTION 'datos que se piden requiere 0027 aplicada antes' USING ERRCODE = '55000';
  END IF;
END
$$;

ALTER TABLE medio_de_pago
  ADD COLUMN avisa_si_falta_cupon    boolean NOT NULL DEFAULT false,
  ADD COLUMN avisa_si_falta_ultimos4 boolean NOT NULL DEFAULT false,
  ADD COLUMN avisa_si_falta_marca    boolean NOT NULL DEFAULT false,
  ADD COLUMN avisa_si_falta_cuotas   boolean NOT NULL DEFAULT false,
  ADD COLUMN avisa_si_falta_dni      boolean NOT NULL DEFAULT false,
  -- No se puede pedir un dato que el medio no muestra (`pide_x` ya implica que el tipo lo admite: queda cubierto el techo por tipo).
  ADD CONSTRAINT medio_de_pago_avisa_ck CHECK (
    (NOT avisa_si_falta_cupon OR pide_cupon) AND (NOT avisa_si_falta_ultimos4 OR pide_ultimos4)
    AND (NOT avisa_si_falta_marca OR pide_marca) AND (NOT avisa_si_falta_cuotas OR pide_cuotas)
    AND (NOT avisa_si_falta_dni OR pide_dni)
  );

GRANT UPDATE (avisa_si_falta_cupon, avisa_si_falta_ultimos4, avisa_si_falta_marca, avisa_si_falta_cuotas, avisa_si_falta_dni)
  ON medio_de_pago TO pedernal_app;

ALTER TABLE cobro
  ADD COLUMN datos_pendientes text[] NOT NULL DEFAULT '{}',
  -- Subconjunto de los cinco datos y sin repetidos (cada dato cuenta a lo sumo una vez: la cantidad de elementos es la de datos distintos presentes).
  ADD CONSTRAINT cobro_datos_pendientes_ck CHECK (
    datos_pendientes <@ ARRAY['cupon', 'ultimos4', 'marca', 'cuotas', 'dni']::text[]
    AND cardinality(datos_pendientes) = (datos_pendientes @> ARRAY['cupon']::text[])::int + (datos_pendientes @> ARRAY['ultimos4']::text[])::int
      + (datos_pendientes @> ARRAY['marca']::text[])::int + (datos_pendientes @> ARRAY['cuotas']::text[])::int
      + (datos_pendientes @> ARRAY['dni']::text[])::int
  );
-- El rol de la aplicación no recibe INSERT sobre `datos_pendientes` (el GRANT de 0027 lista las columnas insertables y esta no se agrega): lo calcula el disparador.

CREATE OR REPLACE FUNCTION cobro_validar_alta() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_mov record;
  v_medio record;
BEGIN
  SELECT m.clase, m.medio_de_pago_id INTO v_mov
    FROM public.movimiento_caja m WHERE m.id = NEW.movimiento_id AND m.empresa_id = NEW.empresa_id;
  IF NOT FOUND OR v_mov.clase <> 'COBRO' THEN
    RAISE EXCEPTION 'la fila de cobro es de un movimiento de clase COBRO'
      USING ERRCODE = '23514', CONSTRAINT = 'cobro_clase_invalida';
  END IF;
  SELECT d.pide_cupon, d.pide_ultimos4, d.pide_marca, d.pide_cuotas, d.pide_dni,
         d.avisa_si_falta_cupon, d.avisa_si_falta_ultimos4, d.avisa_si_falta_marca, d.avisa_si_falta_cuotas, d.avisa_si_falta_dni INTO v_medio
    FROM public.medio_de_pago d WHERE d.id = v_mov.medio_de_pago_id AND d.empresa_id = NEW.empresa_id;
  -- Cada dato presente tiene que estar habilitado en el medio del movimiento (la pantalla no lo ofrece y el servidor no lo confía).
  IF (NEW.cupon IS NOT NULL AND NOT v_medio.pide_cupon)
     OR (NEW.ultimos4 IS NOT NULL AND NOT v_medio.pide_ultimos4)
     OR (NEW.marca_de_tarjeta_id IS NOT NULL AND NOT v_medio.pide_marca)
     OR (NEW.cuotas IS NOT NULL AND NOT v_medio.pide_cuotas)
     OR (NEW.dni IS NOT NULL AND NOT v_medio.pide_dni) THEN
    RAISE EXCEPTION 'el medio de pago no habilitó ese dato'
      USING ERRCODE = '23514', CONSTRAINT = 'cobro_dato_no_habilitado';
  END IF;
  -- La marca es de la lista de marcas y está activa al cobrar (los cobros viejos conservan la que se desactivó después).
  IF NEW.marca_de_tarjeta_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.valor_de_lista v
     WHERE v.id = NEW.marca_de_tarjeta_id AND v.lista = 'MARCAS_DE_TARJETA' AND v.activo
  ) THEN
    RAISE EXCEPTION 'la marca no es una marca de tarjeta activa'
      USING ERRCODE = '23514', CONSTRAINT = 'cobro_marca_invalida';
  END IF;
  -- El sello (PR-7-caja): qué datos que el medio pide quedaron vacíos AHORA, en el orden fijo de los datos. Lo calcula la base con la configuración
  -- vigente al insertar; el código no lo escribe (sin INSERT sobre la columna) ni lo puede olvidar. No rechaza nada. Un cobro nunca cambia después (solo inserción).
  NEW.datos_pendientes := array_remove(ARRAY[
    CASE WHEN v_medio.avisa_si_falta_cupon AND NEW.cupon IS NULL THEN 'cupon' END,
    CASE WHEN v_medio.avisa_si_falta_ultimos4 AND NEW.ultimos4 IS NULL THEN 'ultimos4' END,
    CASE WHEN v_medio.avisa_si_falta_marca AND NEW.marca_de_tarjeta_id IS NULL THEN 'marca' END,
    CASE WHEN v_medio.avisa_si_falta_cuotas AND NEW.cuotas IS NULL THEN 'cuotas' END,
    CASE WHEN v_medio.avisa_si_falta_dni AND NEW.dni IS NULL THEN 'dni' END
  ]::text[], NULL);
  RETURN NEW;
END
$$;
