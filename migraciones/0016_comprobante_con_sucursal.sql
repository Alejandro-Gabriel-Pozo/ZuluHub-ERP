-- 0016_comprobante_con_sucursal: el comprobante guarda a QUÉ SUCURSAL pertenece, para siempre (decisiones del dueño,
-- 2026-10-28: «la factura guarda su sucursal al emitirse y no cambia nunca después»; D-18: el listado muestra solo los
-- comprobantes de la sucursal que la persona elige). Hasta hoy un comprobante solo llegaba a su sucursal por su punto de
-- venta, y la base deja mover un punto de venta de sucursal aunque ya haya emitido (`punto_de_venta.sucursal_id` es
-- actualizable): lo emitido en «Centro» pasaría a verse en «Norte». Con esta columna eso no puede pasar.
--
-- Reglas de esta migración (las mismas de 0001 a 0015):
--  * Es ADITIVA sobre los datos: una columna, una clave foránea compuesta, un índice, un disparador diferido (con su
--    función) y el reemplazo de UNA función (`comprobante_validar_alta`, que ahora además copia la sucursal). No borra ni cambia el valor de ninguna columna
--    existente; la columna nueva se rellena (ver abajo) y no hay privilegios nuevos. Su reversión es un script aparte,
--    revisado y DESTRUCTIVO (borra la sucursal guardada de cada comprobante, que no se puede recomputar si un punto de
--    venta se mudó): `migraciones/reversiones/0016_revertir_comprobante_con_sucursal.sql`. El ejecutor no lo aplica.
--  * Corre limpia sobre una base vacía y sobre una con comprobantes: las filas que ya existen toman la sucursal ACTUAL de
--    su punto de venta (no hay otro dato: hoy no se guardaba), con el RLS evadido por el rol que migra y con los
--    disparadores del comprobante APAGADOS solo durante esa escritura (el de contenido inmutable la rechazaría y el de
--    versión cambiaría `version` y `actualizado_en` de lo ya emitido). Después se vuelven a prender y se comprueba que
--    ninguna fila quedó sin sucursal (y desde entonces un disparador diferido lo exige a toda fila nueva: S4).
--    ATENCIÓN: ese `DISABLE TRIGGER USER` temporal es seguro SOLO porque corre dentro de la transacción del ejecutor
--    (`aplicarMigraciones`), que si algo falla lo deshace y deja los disparadores prendidos. NO correr este archivo con
--    `psql -f` en autocommit: cada sentencia confirmaría por separado y una falla a mitad de camino dejaría el comprobante
--    SIN sus disparadores de inmutabilidad ni de estado.
--  * No agrega ninguna función SECURITY DEFINER ni privilegio alguno: la aplicación NO recibe INSERT ni UPDATE sobre la
--    columna (la copia el disparador de alta y el de cambios la deja inmutable, como al resto del contenido).
--  * Se aplica una sola vez, como las anteriores (el ejecutor lleva el registro).
--  * DEPENDE de 0009 (la tabla `comprobante` y sus disparadores); se comprueba al empezar.
--
-- Decisiones de diseño (todas probadas por tests):
--
--  S1. La sucursal la fija la BASE, no la aplicación: `comprobante_validar_alta` lee el punto de venta con FOR SHARE (como
--      ya hacía para el ambiente) y copia su `sucursal_id`. Una escritura concurrente que mueva el punto de venta espera
--      (el UPDATE necesita el bloqueo que FOR SHARE impide) y el comprobante queda con la sucursal que el punto de venta
--      tenía al emitirse; ni queda sin sucursal ni cambia después.
--  S2. Inmutable sin código nuevo: `comprobante_validar_cambio` compara todo el contenido (`to_jsonb`) salvo las columnas
--      del estado; `sucursal_id` no es del estado, así que ni el dueño de la base puede cambiarla.
--  S3. Clave foránea compuesta `(sucursal_id, empresa_id)` -> `sucursal (id, empresa_id)`, como el punto de venta: una
--      sucursal de otra empresa no existe para el comprobante.
--  S4. La columna es anulable A PROPÓSITO y nunca queda vacía igual: un NOT NULL de columna se comprueba antes que las
--      claves foráneas y taparía los errores de siempre (un punto de venta inexistente o de otra empresa diría «sucursal
--      nula» en vez de `comprobante_pv_fkey`, y la política de otra empresa dejaría de ser lo primero). En su lugar, un
--      disparador diferido (`comprobante_con_sucursal`) rechaza al confirmar toda fila nueva sin sucursal. Como es la
--      misma transacción, el efecto es el mismo: no se confirma un comprobante sin sucursal. Esa equivalencia con un NOT NULL
--      vale para la aplicación y para el dueño de la base. NO vale para quien apaga los disparadores a propósito
--      (`session_replication_role = replica`, `pg_restore --disable-triggers`): una restauración o una carga masiva así puede
--      dejar filas sin sucursal, y quien la haga tiene que rellenarlas antes de volver a operar.
--  S6. Una NOTA (de crédito o de débito) lleva la sucursal del comprobante que corrige o aumenta, no la de su punto de venta de
--      emisión (D-38 y D-40, decisiones del dueño del 2026-10-28 y 2026-10-29), fijada por el mismo disparador de alta e
--      inmutable como todo el contenido. La sucursal del comprobante asociado se lee en la misma lectura que ya valida la nota. El
--      asociado es AUTORIZADO y no cambia nunca, así que su sucursal tampoco: no hace falta bloquearlo. Las notas que ya existían
--      se rellenan igual.

DO $$
BEGIN
  IF to_regclass('public.comprobante') IS NULL OR to_regprocedure('public.comprobante_validar_alta()') IS NULL THEN
    RAISE EXCEPTION 'la sucursal del comprobante requiere 0009_facturacion aplicada antes (falta el comprobante y su disparador de alta)'
      USING ERRCODE = '55000';
  END IF;
END
$$;

ALTER TABLE comprobante ADD COLUMN sucursal_id uuid;

-- Las filas que ya existen: la sucursal actual de su punto de venta. Con los disparadores de usuario del comprobante
-- apagados SOLO acá (si algo falla, la transacción entera vuelve atrás y quedan prendidos).
ALTER TABLE comprobante DISABLE TRIGGER USER;
UPDATE comprobante c
   SET sucursal_id = p.sucursal_id
  FROM punto_de_venta p
 WHERE p.id = c.punto_de_venta_id AND p.empresa_id = c.empresa_id AND c.sucursal_id IS NULL;
-- D-38 y D-40: una nota (de crédito o de débito) lleva la sucursal del comprobante que corrige o aumenta. El asociado es una factura o
-- una nota de débito (nunca una de crédito) y una nota de débito puede citar a otra: se repite hasta que ninguna cambie, así la
-- sucursal de la factura de origen baja por toda la cadena (un UPDATE solo vería los valores de antes). Termina: una nota cita a un
-- comprobante que ya existía, no hay ciclos.
DO $$
DECLARE
  v_filas bigint;
BEGIN
  LOOP
    UPDATE comprobante n
       SET sucursal_id = f.sucursal_id
      FROM comprobante f
     WHERE n.clase <> 'FACTURA' AND f.id = n.comprobante_asociado_id AND f.empresa_id = n.empresa_id
       AND n.sucursal_id IS DISTINCT FROM f.sucursal_id;
    GET DIAGNOSTICS v_filas = ROW_COUNT;
    EXIT WHEN v_filas = 0;
  END LOOP;
END
$$;
ALTER TABLE comprobante ENABLE TRIGGER USER;

DO $$
DECLARE
  v_sin bigint;
BEGIN
  SELECT count(*) INTO v_sin FROM public.comprobante WHERE sucursal_id IS NULL;
  IF v_sin > 0 THEN
    RAISE EXCEPTION 'hay % comprobantes sin sucursal después del relleno (¿el rol que migra evade RLS?)', v_sin
      USING ERRCODE = '55000';
  END IF;
END
$$;

ALTER TABLE comprobante ADD CONSTRAINT comprobante_sucursal_fkey
  FOREIGN KEY (sucursal_id, empresa_id) REFERENCES sucursal (id, empresa_id);
CREATE INDEX comprobante_sucursal_listado_ix ON comprobante (empresa_id, sucursal_id, creado_en DESC, id);

-- Nunca sin sucursal (S4): al confirmar, ninguna fila nueva puede tener la columna vacía.
CREATE FUNCTION comprobante_exigir_sucursal() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  RAISE EXCEPTION 'un comprobante tiene que quedar con la sucursal de su punto de venta'
    USING ERRCODE = '23514', CONSTRAINT = 'comprobante_sin_sucursal';
END
$$;
CREATE CONSTRAINT TRIGGER comprobante_con_sucursal AFTER INSERT ON comprobante
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW.sucursal_id IS NULL) EXECUTE FUNCTION comprobante_exigir_sucursal();

-- El alta fija la sucursal (S1 y S6). Es la función de 0009 con agregados al final y al leer el punto de venta y el asociado (`sucursal_id`).
-- Todo lo demás, igual (los debilitamientos de 0009 buscan esos mismos textos).
CREATE OR REPLACE FUNCTION comprobante_validar_alta() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_pv record;
  v_df record;
  v_cuit text;
  v_aso record;
  v_sucursal uuid;
  v_sucursal_aso uuid;
BEGIN
  IF NEW.estado <> 'PENDIENTE' OR NEW.envios <> 0 THEN
    RAISE EXCEPTION 'un comprobante nace PENDIENTE y sin envíos'
      USING ERRCODE = '23514', CONSTRAINT = 'comprobante_alta_invalida';
  END IF;

  -- Un punto de venta, unos datos fiscales o un emisor inexistentes (o de otra empresa) los rechazan las
  -- claves foráneas compuestas: acá solo se compara lo que existe.
  SELECT p.estado, p.numero, p.ambiente, p.sucursal_id INTO v_pv
    FROM public.punto_de_venta p
   WHERE p.id = NEW.punto_de_venta_id AND p.empresa_id = NEW.empresa_id AND p.emisor_id = NEW.emisor_id
     FOR SHARE;
  IF FOUND AND (v_pv.estado <> 'ACTIVO' OR v_pv.numero <> NEW.punto_de_venta_numero
                OR v_pv.ambiente <> NEW.ambiente) THEN
    RAISE EXCEPTION 'el punto de venta no está activo, o su número o su ambiente no son los del comprobante'
      USING ERRCODE = '23514', CONSTRAINT = 'comprobante_alta_invalida';
  END IF;
  -- La sucursal del comprobante es la de su punto de venta EN ESTE MOMENTO, leída con el bloqueo FOR SHARE de arriba: quien
  -- mueva el punto de venta a otra sucursal espera a que esta transacción termine, así que no hay una sucursal leída y otra
  -- al confirmar. Se fija al final de la función (una nota de crédito toma la de la factura que corrige, D-38).
  IF FOUND THEN
    v_sucursal := v_pv.sucursal_id;
  END IF;

  SELECT d.estado, d.razon_social, d.condicion_iva, d.inicio_actividades, d.iibb_numero, d.iibb_condicion
    INTO v_df
    FROM public.datos_fiscales d
   WHERE d.id = NEW.datos_fiscales_id AND d.empresa_id = NEW.empresa_id AND d.emisor_id = NEW.emisor_id;
  IF FOUND AND (v_df.estado <> 'CONFIRMADA'
                OR v_df.razon_social IS DISTINCT FROM NEW.emisor_razon_social
                OR v_df.condicion_iva IS DISTINCT FROM NEW.emisor_condicion_iva
                OR v_df.inicio_actividades IS DISTINCT FROM NEW.emisor_inicio_actividades
                OR v_df.iibb_numero IS DISTINCT FROM NEW.emisor_iibb_numero
                OR v_df.iibb_condicion IS DISTINCT FROM NEW.emisor_iibb_condicion) THEN
    RAISE EXCEPTION 'la foto del emisor no coincide con sus datos fiscales confirmados'
      USING ERRCODE = '23514', CONSTRAINT = 'comprobante_alta_invalida';
  END IF;

  -- El CUIT del emisor principal es el de la empresa (E1 de 0006).
  SELECT coalesce(x.cuit, e.cuit) INTO v_cuit
    FROM public.emisor x JOIN public.empresa e ON e.id = x.empresa_id
   WHERE x.id = NEW.emisor_id AND x.empresa_id = NEW.empresa_id;
  IF FOUND AND v_cuit IS DISTINCT FROM NEW.emisor_cuit THEN
    RAISE EXCEPTION 'el CUIT del comprobante no es el del emisor'
      USING ERRCODE = '23514', CONSTRAINT = 'comprobante_alta_invalida';
  END IF;

  IF NEW.comprobante_asociado_id IS NOT NULL THEN
    SELECT a.estado, a.ambiente, a.clase, a.tipo_comprobante, a.receptor_documento_tipo, a.receptor_documento_numero,
           a.sucursal_id
      INTO v_aso
      FROM public.comprobante a
     WHERE a.id = NEW.comprobante_asociado_id AND a.empresa_id = NEW.empresa_id AND a.emisor_id = NEW.emisor_id;
    IF FOUND AND (v_aso.estado <> 'AUTORIZADO'
                  OR v_aso.ambiente <> NEW.ambiente
                  OR v_aso.clase = 'NOTA_CREDITO'
                  OR right(v_aso.tipo_comprobante, 1) <> right(NEW.tipo_comprobante, 1)
                  OR v_aso.receptor_documento_tipo <> NEW.receptor_documento_tipo
                  OR v_aso.receptor_documento_numero IS DISTINCT FROM NEW.receptor_documento_numero) THEN
      RAISE EXCEPTION 'la nota no corresponde a su comprobante asociado (autorizado, mismo ambiente, misma letra, mismo receptor, y no una nota de crédito)'
        USING ERRCODE = '23514', CONSTRAINT = 'comprobante_asociado_invalido';
    END IF;
    -- La nota lleva la sucursal del comprobante que corrige o aumenta (D-38 y D-40), leída en la MISMA lectura de arriba.
    IF FOUND THEN
      v_sucursal_aso := v_aso.sucursal_id;
    END IF;
  END IF;

  -- La sucursal (S1 y S6). Sin punto de venta (inexistente, de otro emisor o de otra empresa) no hay nada que copiar: la fila no
  -- puede quedar (la clave foránea del punto de venta la rechaza, y la política antes que ella si es de otra empresa) y esos
  -- errores siguen siendo los de siempre. Una NOTA (de crédito o de débito) lleva la sucursal del comprobante que corrige o
  -- aumenta, que no cambia nunca (D-38 y D-40); una factura, la de su punto de venta. Nadie la elige: la aplicación no la manda
  -- (no tiene INSERT sobre la columna) y, si el dueño de la base manda una, tiene que ser esa.
  IF v_sucursal IS NOT NULL THEN
    IF v_sucursal_aso IS NOT NULL THEN
      v_sucursal := v_sucursal_aso;
    END IF;
    IF NEW.sucursal_id IS NOT NULL AND NEW.sucursal_id <> v_sucursal THEN
      RAISE EXCEPTION 'la sucursal del comprobante no es la que le corresponde (la de su punto de venta, o la del comprobante que corrige una nota)'
        USING ERRCODE = '23514', CONSTRAINT = 'comprobante_alta_invalida';
    END IF;
    NEW.sucursal_id := v_sucursal;
  END IF;
  RETURN NEW;
END
$$;
