-- 0104_nota_libre_en_la_linea_de_comanda: una nota libre corta por plato del pedido («sin cebolla») que sale en el papel de cocina (SAL-G; maqueta y alcance aprobados por el dueño el 25/11/2026).
--  * `linea_de_comanda.nota`: la nota viva; se carga al agregar y se edita SOLO mientras la línea no se envió. Nula = sin nota.
--  * `renglon_de_envio.nota`: la FOTO de lo que vio la cocina (la tabla es de solo inserción: lo impreso no cambia nunca).
--  * Largo máximo 120 (SUPUESTO (DEC-SAL-006); subirlo es cambiar este CHECK; bajarlo con datos cargados recortaría notas) y el conjunto de caracteres permitidos es el de los textos de catálogo
--    (`texto_de_catalogo_valido`, el mismo de `nombre_de_cocina`): sin controles, sin `<` ni `>`, sin espacios de más en los bordes.
--  * Tres reglas de la base (no solo del código): (1) una línea enviada no cambia su nota ni se envía y cambia la nota en el mismo UPDATE; (2) la foto del envío lleva EXACTAMENTE la nota guardada
--    en la línea; (3) una copia (unir, dividir, anular una parte) conserva la nota de su origen. La nota no tiene ninguna relación con precio, stock ni ticket: no hay nada de dinero acá.
-- Reglas de esta migración (las de 0036, 0047 y 0098):
--  * ADITIVA y compatible hacia atrás: dos columnas nulas nuevas; el código viejo no las lee ni las escribe. No rellena, no cambia ni borra datos existentes.
--  * Las tres funciones de disparador se reemplazan con `CREATE OR REPLACE` por las mismas de 0038 MÁS la regla nueva (el resto de cada cuerpo es idéntico).
--  * Su reversión es `migraciones/reversiones/0104_revertir_nota_libre_en_la_linea_de_comanda.sql` (DESTRUCTIVA si hay notas: frena antes). El ejecutor no la aplica.
-- DEPENDE de 0038 (salón y comandas) y 0025/0043 (`texto_de_catalogo_valido`); se comprueba al empezar.

DO $$
BEGIN
  IF to_regclass('public.linea_de_comanda') IS NULL OR to_regclass('public.renglon_de_envio') IS NULL OR to_regclass('public.linea_copiada') IS NULL THEN
    RAISE EXCEPTION '0104 necesita 0038 aplicada antes' USING ERRCODE = '55000';
  END IF;
  IF to_regprocedure('public.texto_de_catalogo_valido(text, integer)') IS NULL
     OR to_regprocedure('public.renglon_validar_alta()') IS NULL
     OR to_regprocedure('public.linea_de_comanda_validar_alta()') IS NULL
     OR to_regprocedure('public.linea_de_comanda_validar_cambio()') IS NULL THEN
    RAISE EXCEPTION '0104 necesita las funciones de 0025/0043 y de 0038' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name IN ('linea_de_comanda', 'renglon_de_envio') AND column_name = 'nota') THEN
    RAISE EXCEPTION '0104: la columna nota ya existe (alguien la creó a mano); hay que revisarla antes de migrar' USING ERRCODE = '55000';
  END IF;
END
$$;

ALTER TABLE linea_de_comanda ADD COLUMN nota text
  CONSTRAINT linea_de_comanda_nota_ck CHECK (nota IS NULL OR texto_de_catalogo_valido(nota, 120));
ALTER TABLE renglon_de_envio ADD COLUMN nota text
  CONSTRAINT renglon_nota_ck CHECK (nota IS NULL OR texto_de_catalogo_valido(nota, 120));

-- Permisos por columna (0038 concede INSERT y UPDATE solo sobre columnas nombradas: sin esto la app recibe «permission denied»).
GRANT INSERT (nota) ON renglon_de_envio TO pedernal_app;
GRANT INSERT (nota), UPDATE (nota) ON linea_de_comanda TO pedernal_app;

-- (2) La foto del envío lleva exactamente la nota guardada en la línea. Igual a 0038 salvo el último IF.
CREATE OR REPLACE FUNCTION renglon_validar_alta() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_envio public.envio_de_comanda%ROWTYPE;
  v_linea public.linea_cuenta%ROWTYPE;
BEGIN
  SELECT * INTO v_envio FROM public.envio_de_comanda e WHERE e.id = NEW.envio_id AND e.empresa_id = NEW.empresa_id AND e.xmin = pg_current_xact_id()::xid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'los renglones de un envío entran con el envío, en la misma transacción'
      USING ERRCODE = '23514', CONSTRAINT = 'renglon_solo_con_el_envio';
  END IF;
  SELECT * INTO v_linea FROM public.linea_cuenta l WHERE l.id = NEW.linea_id AND l.empresa_id = NEW.empresa_id;
  IF NOT FOUND OR v_linea.cuenta_id <> v_envio.cuenta_id OR NEW.cantidad > v_linea.cantidad THEN
    RAISE EXCEPTION 'un renglón es de una línea de la cuenta del envío y no excede su cantidad'
      USING ERRCODE = '23514', CONSTRAINT = 'renglon_linea_ajena';
  END IF;
  IF NEW.nota IS DISTINCT FROM (SELECT d.nota FROM public.linea_de_comanda d WHERE d.linea_id = NEW.linea_id AND d.empresa_id = NEW.empresa_id) THEN
    RAISE EXCEPTION 'la foto del envío lleva la nota guardada en la línea'
      USING ERRCODE = '23514', CONSTRAINT = 'renglon_nota_distinta';
  END IF;
  RETURN NEW;
END
$$;

-- (3) Una copia (unir, dividir, anular una parte) conserva la nota de su origen. Igual a 0038 salvo que busca el origen siempre y suma el último IF.
CREATE OR REPLACE FUNCTION linea_de_comanda_validar_alta() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_linea public.linea_cuenta%ROWTYPE;
  v_origen uuid;
  v_envio_origen uuid;
  v_nota_origen text;
  v_envio public.envio_de_comanda%ROWTYPE;
BEGIN
  SELECT * INTO v_linea FROM public.linea_cuenta l WHERE l.id = NEW.linea_id AND l.empresa_id = NEW.empresa_id;
  IF NOT FOUND OR v_linea.cuenta_id <> NEW.cuenta_id OR v_linea.estado <> 'VIGENTE' THEN
    RAISE EXCEPTION 'el estado de comanda es de una línea vigente de su cuenta'
      USING ERRCODE = '23514', CONSTRAINT = 'linea_de_comanda_linea_invalida';
  END IF;
  SELECT c.linea_origen_id INTO v_origen FROM public.linea_copiada c WHERE c.linea_nueva_id = NEW.linea_id AND c.empresa_id = NEW.empresa_id;
  IF NEW.envio_id IS NOT NULL THEN
    -- Una línea nace ya enviada solo si es la copia de una ya enviada (unir, dividir, anular una parte): conserva su envío.
    SELECT d.envio_id INTO v_envio_origen FROM public.linea_de_comanda d WHERE d.linea_id = v_origen AND d.empresa_id = NEW.empresa_id;
    IF v_origen IS NULL OR v_envio_origen IS DISTINCT FROM NEW.envio_id THEN
      RAISE EXCEPTION 'una línea nace sin enviar, salvo la copia de una ya enviada'
        USING ERRCODE = '23514', CONSTRAINT = 'linea_de_comanda_alta_invalida';
    END IF;
  END IF;
  IF v_origen IS NOT NULL THEN
    SELECT d.nota INTO v_nota_origen FROM public.linea_de_comanda d WHERE d.linea_id = v_origen AND d.empresa_id = NEW.empresa_id;
    IF NEW.nota IS DISTINCT FROM v_nota_origen THEN
      RAISE EXCEPTION 'una copia de línea conserva la nota de su origen'
        USING ERRCODE = '23514', CONSTRAINT = 'linea_de_comanda_nota_de_la_copia';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

-- (1) La nota solo cambia mientras la línea no se envió, y no en el mismo UPDATE que la envía. Igual a 0038 salvo el IF nuevo dentro del bloque de «se envía».
CREATE OR REPLACE FUNCTION linea_de_comanda_validar_cambio() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_envio public.envio_de_comanda%ROWTYPE;
BEGIN
  IF NEW.empresa_id IS DISTINCT FROM OLD.empresa_id OR NEW.linea_id IS DISTINCT FROM OLD.linea_id OR NEW.cuenta_id IS DISTINCT FROM OLD.cuenta_id
     OR NEW.creado_en IS DISTINCT FROM OLD.creado_en THEN
    RAISE EXCEPTION 'la identidad del estado de comanda no se puede cambiar'
      USING ERRCODE = '23514', CONSTRAINT = 'linea_de_comanda_inmutable';
  END IF;
  -- S4: el envío se fija una sola vez, y la salida y la nota solo cambian mientras la línea no se envió.
  IF OLD.envio_id IS NOT NULL THEN
    RAISE EXCEPTION 'una línea ya enviada no cambia su envío, su salida ni su nota'
      USING ERRCODE = '23514', CONSTRAINT = 'linea_de_comanda_ya_enviada';
  END IF;
  IF NEW.envio_id IS NOT NULL THEN
    SELECT * INTO v_envio FROM public.envio_de_comanda e WHERE e.id = NEW.envio_id AND e.empresa_id = NEW.empresa_id AND e.xmin = pg_current_xact_id()::xid;
    IF NOT FOUND OR v_envio.cuenta_id <> OLD.cuenta_id THEN
      RAISE EXCEPTION 'la línea se envía en un envío de su cuenta, creado en esta transacción'
        USING ERRCODE = '23514', CONSTRAINT = 'linea_de_comanda_envio_invalido';
    END IF;
    IF NEW.salida IS DISTINCT FROM OLD.salida OR NEW.nota IS DISTINCT FROM OLD.nota THEN
      RAISE EXCEPTION 'al enviar una línea no se cambia su salida ni su nota'
        USING ERRCODE = '23514', CONSTRAINT = 'linea_de_comanda_ya_enviada';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
