-- 0019_contacto_de_la_sucursal: la SUCURSAL guarda tres datos de contacto OPCIONALES (teléfono, correo y web) y el COMPROBANTE
-- congela los que la sucursal tenía al darse de alta (decisión del dueño, D-98 y D-97, 2026-11-04: «la factura impresa muestra
-- el contacto de la sucursal si existe; el que se imprime es el vigente al emitir y queda congelado con el comprobante»).
-- Diseño: Pedernal-docs/11-especificaciones/diseno-contacto-de-la-sucursal.md (§2).
--
-- Reglas de esta migración (las mismas de 0001 a 0018):
--  * Es ADITIVA: tres columnas nulas en `sucursal`, tres columnas nulas en `comprobante`, una función y un disparador. No borra ni
--    cambia el valor de ninguna fila ni de ninguna función existente: no reemplaza `comprobante_validar_alta` (no se rehace por
--    cuarta vez la copia de 0016/0017). Una columna nula SIN default no reescribe la tabla ni dispara nada (ni siquiera el
--    disparador de versión de `sucursal`): ninguna sucursal cambia de `version` y ningún comprobante cambia.
--  * Los comprobantes que ya existen (emitidos o en vuelo) quedan SIN contacto y se reimprimen igual que hoy; las sucursales
--    existentes quedan sin contacto hasta que alguien lo cargue. Nada se rellena: no hay de dónde sacar un contacto de antes.
--  * Su reversión es un script aparte, revisado y DESTRUCTIVO en lo único que agrega (borra el contacto de cada sucursal y el que
--    cada comprobante congeló, y eso no se puede recomputar): `migraciones/reversiones/0019_revertir_contacto_de_la_sucursal.sql`.
--    El ejecutor no lo aplica.
--  * No agrega ninguna función SECURITY DEFINER. Privilegios nuevos, todos de columna: la aplicación puede ESCRIBIR el contacto de
--    la sucursal (alta y edición; la política ya acota la empresa operable); sobre el contacto del COMPROBANTE no recibe INSERT ni
--    UPDATE (lo copia el disparador y el de cambios lo deja inmutable).
--  * Se aplica una sola vez, como las anteriores (el ejecutor lleva el registro).
--  * DEPENDE de 0016 (la sucursal del comprobante y el disparador que la exige); se comprueba al empezar.
--
-- Decisiones de diseño (todas probadas por tests):
--
--  C1. Nulo = «no existe». Un valor presente nunca es vacío ni lleva blancos en los extremos ni caracteres de control (una sola
--      línea). La web se guarda CANÓNICA, sin `http(s)://` (D-99: la persona la puede escribir con o sin esquema y el CHECK repite la forma guardada). Los largos máximos (teléfono 40, correo 254, web 200) son un SUPUESTO del ingeniero, sin fuente del dueño: son
--      las constantes de `src/primitivas/contacto/` (telefono.ts, email.ts, web.ts) y cambiarlos es un CHECK nuevo, no un cambio de datos.
--  C2. La BASE copia el contacto, no la aplicación (como `sucursal_id` en 0016): el disparador `comprobante_alta_contacto` lee la
--      sucursal del comprobante con FOR SHARE y deja en la fila nueva el contacto VIGENTE EN ESE MOMENTO, pise lo que pise quien
--      inserte. La aplicación no manda esas columnas (no tiene INSERT sobre ellas) y no las puede falsear. «Al emitir» es al crear
--      el comprobante (alta PENDIENTE), no cuando ARCA autoriza segundos después (SUPUESTO del ingeniero; es la misma regla del
--      domicilio del punto de venta, 0009 D8).
--  C3. Una NOTA lleva el contacto VIGENTE de SU sucursal al emitirla (que es la del comprobante que corrige, 0016 S6), no el que
--      la factura corregida congeló (SUPUESTO del ingeniero: es otro comprobante).
--  C4. Inmutable sin código nuevo: `comprobante_validar_cambio` compara todo el contenido (`to_jsonb`) salvo las columnas del
--      estado; el contacto no es del estado, así que ni el dueño de la base puede cambiarlo después.
--  C5. Editar el contacto de la sucursal a la vez que se emite: el FOR SHARE del disparador y el UPDATE de la edición se esperan
--      (uno u otro va primero: el comprobante congela el contacto de antes o el de después, nunca un valor a medias). Una factura
--      ya espera por el FOR SHARE que `comprobante_validar_alta` (0017) toma sobre la sucursal de su punto de venta; el de este
--      disparador hace falta para la NOTA, cuya sucursal es la del comprobante que corrige y puede no ser la de su punto de venta.
--  C6. El orden de los disparadores BEFORE INSERT de un mismo evento es el alfabético: `comprobante_alta_contacto` va DESPUÉS de
--      `comprobante_alta` (que fija `sucursal_id`). Una prueba lo fija con una sonda; si `sucursal_id` llegara vacío, no se copia
--      nada y las columnas quedan nulas (la fila no puede confirmarse: lo impide `comprobante_con_sucursal`, 0016 S4).

DO $$
BEGIN
  IF to_regprocedure('public.comprobante_validar_alta()') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = to_regclass('public.comprobante') AND attname = 'sucursal_id' AND NOT attisdropped
  ) OR to_regprocedure('public.comprobante_exigir_sucursal()') IS NULL THEN
    RAISE EXCEPTION 'el contacto de la sucursal requiere 0016_comprobante_con_sucursal aplicada antes (falta la sucursal del comprobante o su disparador)'
      USING ERRCODE = '55000';
  END IF;
END
$$;

-- Cada CHECK repite la regla de la primitiva de contacto que se cita (src/primitivas/contacto/): si cambia el tope o la forma,
-- cambian las dos puntas (la constante y un CHECK nuevo en cada tabla que guarde el dato).
ALTER TABLE sucursal
  -- Repite `telefono.ts`: LARGO_MAXIMO_DEL_TELEFONO = 40, texto de una línea sin control, sin blancos en los extremos.
  ADD COLUMN telefono text CONSTRAINT sucursal_telefono_ck CHECK (
    telefono = btrim(telefono) AND char_length(telefono) BETWEEN 1 AND 40 AND telefono !~ '[\x01-\x1F\x7F-\x9F]'),
  -- Repite `email.ts`: `emailDeContactoDesdeTexto` (la regla de `persona_email_ck` y `emailDesdeTexto`, sin blancos adentro) más
  -- LARGO_MAXIMO_DEL_EMAIL_DE_CONTACTO = 254 y sin control.
  ADD COLUMN correo text CONSTRAINT sucursal_correo_ck CHECK (
    correo = lower(btrim(correo)) AND char_length(correo) <= 254 AND correo ~ '^\S+@\S+$'
    AND correo !~ '[\x01-\x1F\x7F-\x9F]'),
  -- Repite `web.ts` (D-99): la forma CANÓNICA, SIN esquema. PATRON_DE_LA_WEB (host en minúsculas con al menos un punto, puerto, y
  -- después / ? # y texto sin blancos), PATRON_DE_HOST_CON_BARRA negado (sin la barra cuando es solo el host), el tope
  -- LARGO_MAXIMO_DE_LA_WEB = 200 sobre lo guardado (ya sin esquema) y sin control. Un `https://` o un `javascript:` no calzan.
  ADD COLUMN web text CONSTRAINT sucursal_web_ck CHECK (
    char_length(web) <= 200
    AND web ~ '^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z0-9]([a-z0-9-]*[a-z0-9])?(:[0-9]{1,5})?([/?#]\S*)?$'
    AND web !~ '^[^/?#]*/$'
    AND web !~ '[\x01-\x1F\x7F-\x9F]');

-- La política `sucursal_app_alta` / `sucursal_app_cambiar` ya acota la empresa operable. La plataforma, que solo siembra
-- (`empresa_id`, `nombre`), no recibe nada.
GRANT INSERT (telefono, correo, web) ON sucursal TO pedernal_app;
GRANT UPDATE (telefono, correo, web) ON sucursal TO pedernal_app;

-- El contacto congelado: sin CHECK ni privilegio, porque solo lo escribe el disparador con valores que la sucursal ya validó.
ALTER TABLE comprobante
  ADD COLUMN sucursal_telefono text,
  ADD COLUMN sucursal_correo text,
  ADD COLUMN sucursal_web text;

CREATE FUNCTION comprobante_copiar_contacto() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_telefono text;
  v_correo text;
  v_web text;
BEGIN
  -- `comprobante_alta` (que dispara antes, C6) fija la sucursal; sin ella no hay nada que copiar.
  IF NEW.sucursal_id IS NULL THEN
    RETURN NEW;
  END IF;
  -- Con FOR SHARE: quien edite el contacto a la vez espera (C5; en una nota es el único bloqueo de esa sucursal). Sin la sucursal (no existe o es de otra empresa) los tres quedan
  -- nulos y la clave foránea rechaza la fila.
  SELECT s.telefono, s.correo, s.web INTO v_telefono, v_correo, v_web
    FROM public.sucursal s
   WHERE s.id = NEW.sucursal_id AND s.empresa_id = NEW.empresa_id
     FOR SHARE;
  NEW.sucursal_telefono := v_telefono;
  NEW.sucursal_correo := v_correo;
  NEW.sucursal_web := v_web;
  RETURN NEW;
END
$$;

CREATE TRIGGER comprobante_alta_contacto BEFORE INSERT ON comprobante
  FOR EACH ROW EXECUTE FUNCTION comprobante_copiar_contacto();
