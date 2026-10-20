-- 0009_facturacion: el comprobante fiscal (factura, nota de crédito y nota de débito) con su ciclo frente a
-- ARCA, sus renglones y su desglose de IVA, los certificados de ARCA, el ticket de acceso y los intentos
-- contra ARCA (H7 facturación, tramo F2: `h7-facturacion.md` §B.8; ADR-004, ADR-006, ADR-007, ADR-011).
-- Decisiones del dueño (2026-10-13): una sola tabla de comprobantes, `RECHAZADO` terminal, factura A, B y C
-- con nota de crédito y de débito, ambiente por punto de venta (QF2), salida de una serie bloqueada (QF1).
--
-- Reglas de esta migración (las mismas de 0001 a 0008):
--  * Es ADITIVA sobre los datos: crea tablas, funciones, restricciones, disparadores y políticas. Sobre
--    objetos de 0006 hace SOLO cuatro cambios, todos sobre estructura y sin tocar una fila: (a) agrega
--    `ambiente` a `punto_de_venta` y a `serie_comprobante` (las filas existentes quedan en
--    `HOMOLOGACION`, el valor con que nace todo punto de venta); (b) cambia la clave primaria de la serie
--    para incluir el ambiente (`DROP CONSTRAINT serie_pkey` + `ADD CONSTRAINT serie_pkey`: con
--    `ambiente` constante en todas las filas existentes no puede fallar); (c) quita el valor por
--    defecto de `serie_comprobante.ambiente` una vez rellenado (`DROP DEFAULT`); (d) reemplaza una
--    función (`serie_comprobante_validar_cambio`) y suma una única `datos_fiscales_id_empresa_emisor_uk`.
--    Su reversión es un script aparte, revisado y DESTRUCTIVO para todo lo facturado:
--    `migraciones/reversiones/0009_revertir_facturacion.sql` (el ejecutor no lo aplica).
--  * No agrega NINGUNA función SECURITY DEFINER: la única del esquema sigue siendo `contexto_firmado()`.
--  * Toda función nueva fija `search_path = pg_catalog, public, pg_temp`, califica sus tablas con `public.`
--    y nace sin EXECUTE para PUBLIC. Solo la de validación de textos se otorga (a la aplicación, que
--    escribe las columnas que valida). Las funciones de disparador no se otorgan a nadie.
--  * Nadie recibe DELETE ni TRUNCATE (retención: decisión 11 abierta). Un comprobante no se borra: se
--    anula con un registro nuevo (nota de crédito) o se descarta (estado). Los disparadores frenan el
--    borrado y el vaciado aun al dueño de la base. INSERT y UPDATE van por columna.
--  * RLS activa y FORZADA en toda tabla nueva. Toda única de una tabla con `empresa_id` lo incluye. Ninguna
--    política `FOR ALL`. Los demás roles (plataforma, grupo, trabajos, público, captación,
--    autenticación) no reciben nada: fallan cerrados hasta que fiscal publique una consulta propia.
--  * Dinero en `numeric` exacto (importes `numeric(18,2)`, precio `numeric(18,6)`, cantidad
--    `numeric(18,4)`), nunca flotantes, y moneda explícita. DEPENDE de 0006 (la fiscal base) y de 0007
--    (`sin_borrado()`); se comprueba al empezar.
--  * Sin contraseñas, claves ni cadenas de conexión; no toca ningún rol.
--
-- Decisiones de diseño (todas probadas por tests; los números son de esta migración):
--
--  D1. Una sola tabla `comprobante` con siete estados. La base impone EXACTAMENTE la tabla de transiciones
--      del dominio (`TRANSICIONES_DE_COMPROBANTE`) con `comprobante_cambio`; un test recorre los 49 pares
--      y los compara. Lo que se envió a ARCA no cambia nunca: ni una columna de contenido (renglones,
--      importes, emisor, punto de venta, receptor, asociado) se puede modificar, tampoco por el dueño.
--  D2. Identidad: a lo sumo UN comprobante vigente por `(empresa, origen_tipo, origen_id, emisor,
--      clase)` (`comprobante_identidad_uk`, parcial: `RECHAZADO` y `DESCARTADO` liberan el origen) y, para
--      lo manual, una clave NUNCA da dos comprobantes (`comprobante_manual_uk`, sin la condición de
--      estado): corregir es otro pedido con otra clave. Esto último el spec lo pide en prosa (§B.4.1)
--      pero no lo trae en el SQL; sin la base, un reintento tardío de red tras un rechazo crearía un
--      segundo intento a espaldas del usuario.
--  D3. El número se reserva en el trabajo de validación, no al crear: `PENDIENTE` no tiene número. Cuando
--      el comprobante está `EN_VALIDACION` o `INCIERTO`, la serie `(punto de venta, tipo, ambiente)` está
--      `EN_CURSO` con SU reserva (`comprobante_coherente_con_serie`, diferido) y, a la inversa, una
--      serie no puede dejar de tenerla mientras un comprobante la use (`comprobante_serie_con_reserva`,
--      diferido, sobre la serie): así no hay dos comprobantes con el mismo número en vuelo, ni un
--      autorizado que no avanzó la serie, ni una serie cerrada con un comprobante colgado. Los dos
--      disparadores leen la fila tal como queda al confirmar, no la del evento (un comprobante que
--      pasa por dos estados en la misma transacción encola dos eventos).
--  D4. El contenido nace completo: renglones y desglose se insertan en la transacción que crea el
--      comprobante (`creado_en = now()`) y `comprobante_cuadra` (diferido) comprueba al confirmar que
--      suman exactamente lo informado: renglones numerados desde 1 que suman el total, desglose por
--      alícuota igual a la suma de sus renglones, neto, IVA, exento y no gravado iguales a las
--      columnas del comprobante, y letra C sin alícuotas. Se dispara solo desde `comprobante` (los
--      renglones y el desglose no se pueden agregar después: D5).
--  D5. Renglones, desglose e intentos son de SOLO INSERCIÓN (`solo_insercion()` de 0001, aun contra el
--      dueño); un renglón tardío (otra transacción, o un comprobante ya enviado) se rechaza.
--  D6. Ambiente: `punto_de_venta.ambiente` (HOMOLOGACION por defecto), `serie_comprobante.ambiente` (parte
--      de la clave, sin valor por defecto: una serie de producción no se crea como homologación por
--      omisión) y `comprobante.ambiente`, que copia el del punto de venta al nacer. Números de
--      homologación no avanzan la serie de producción del mismo punto de venta. El cambio de ambiente
--      del punto de venta se frena con una serie EN_CURSO, y de PRODUCCION a HOMOLOGACION si la serie
--      de producción ya se usó (decisión QF2 del dueño: «sin volver atrás»; el spec §I la matiza con
--      «solo si todavía no tiene comprobantes autorizados en producción», que es lo que impone la
--      base). Que haya un certificado de producción vigente lo exige el caso de uso (§B.8.1).
--  D7. `BLOQUEADA -> LIBRE` es la única salida de una serie bloqueada (QF1): el último número puede saltar
--      hacia adelante (los números del medio los emitió otro sistema) y nunca baja.
--  D8. Foto del emisor y del punto de venta: al nacer, el comprobante copia CUIT, razón social, condición,
--      domicilio, inicio de actividades e IIBB del emisor, y número y domicilio del punto de venta; la base
--      comprueba que lo copiado coincide con su fuente (datos fiscales CONFIRMADOS del mismo emisor,
--      punto de venta ACTIVO, CUIT del emisor o de la empresa). Una copia mal armada es un comprobante
--      fiscal con datos de otro.
--  D9. Notas: la nota nace solo si su asociado está AUTORIZADO, es de la misma empresa, del mismo
--      emisor (clave foránea compuesta), del mismo ambiente y de la misma letra, no es una nota de crédito
--      y lleva el mismo receptor (tipo y número de documento).
--  D10. Certificados de ARCA: `PEDIDO_GENERADO -> VIGENTE -> REEMPLAZADO` y `PEDIDO_GENERADO ->
--      DESCARTADO`, a lo sumo uno VIGENTE por `(emisor, ambiente)`; el contenido (pedido, clave
--      cifrada, certificado, huella) no cambia después. Esta migración solo trae las tablas: el cifrado, la
--      carga y el ticket de acceso son de otros tramos.
--  D11. Los CHECK se escriben sin comparaciones con NULL sueltas: una condición como `a = b AND c ~ 'x'` con
--      `c` NULL no es falsa y el CHECK la dejaría pasar (la trampa que ya documentó 0006, E4). Todo
--      importe lleva además una cota superior: `numeric` acepta `NaN`, que es mayor que cualquier número
--      y pasaría un `>= 0`.

-- ---------------------------------------------------------------------------------------------
-- Verificaciones previas: se frena con un mensaje claro, sin haber cambiado nada
-- ---------------------------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.serie_comprobante') IS NULL OR to_regclass('public.datos_fiscales') IS NULL
     OR to_regclass('public.punto_de_venta') IS NULL THEN
    RAISE EXCEPTION 'facturación requiere 0006_fiscal aplicada antes (faltan los datos fiscales, el punto de venta y la serie)'
      USING ERRCODE = '55000';
  END IF;
  IF to_regprocedure('public.sin_borrado()') IS NULL THEN
    RAISE EXCEPTION 'facturación requiere 0007_marcas_y_planes aplicada antes (falta sin_borrado())'
      USING ERRCODE = '55000';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- Cambios sobre las tablas de 0006: el ambiente (D6) y lo que pide la clave foránea del comprobante
-- ---------------------------------------------------------------------------------------------
ALTER TABLE punto_de_venta ADD COLUMN ambiente text NOT NULL DEFAULT 'HOMOLOGACION'
  CONSTRAINT punto_de_venta_ambiente_ck CHECK (ambiente IN ('HOMOLOGACION', 'PRODUCCION'));

ALTER TABLE serie_comprobante ADD COLUMN ambiente text NOT NULL DEFAULT 'HOMOLOGACION'
  CONSTRAINT serie_ambiente_ck CHECK (ambiente IN ('HOMOLOGACION', 'PRODUCCION'));
-- De ahora en más el ambiente de una serie se dice siempre: sin valor por defecto no se crea una serie de
-- producción como homologación por omisión (el INSERT sin `ambiente` viola NOT NULL).
ALTER TABLE serie_comprobante ALTER COLUMN ambiente DROP DEFAULT;
ALTER TABLE serie_comprobante DROP CONSTRAINT serie_pkey,
  ADD CONSTRAINT serie_pkey PRIMARY KEY (empresa_id, punto_de_venta_id, tipo_comprobante, ambiente);

-- El comprobante apunta a SUS datos fiscales: del mismo emisor y de la misma empresa en una sola clave
-- (el spec dejaba solo `(id, empresa_id)`; con el emisor en la clave, la base impide apuntar a los datos
-- de otro emisor de la misma empresa sin necesitar un disparador).
ALTER TABLE datos_fiscales
  ADD CONSTRAINT datos_fiscales_id_empresa_emisor_uk UNIQUE (id, empresa_id, emisor_id);

-- ---------------------------------------------------------------------------------------------
-- Validación de textos (la misma regla de 0006: sin blancos en los extremos ni caracteres de control)
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION texto_fiscal_valido(t text, p_maximo integer) RETURNS boolean LANGUAGE sql IMMUTABLE
  SET search_path = pg_catalog, public, pg_temp AS
$$
  SELECT CASE
    WHEN t IS NULL OR p_maximo IS NULL OR char_length(t) NOT BETWEEN 1 AND p_maximo THEN false
    ELSE t !~ '^\s|\s$' AND t !~ '[\x01-\x1F\x7F-\x9F]'
  END
$$;

-- ---------------------------------------------------------------------------------------------
-- Comprobante
-- ---------------------------------------------------------------------------------------------
CREATE TABLE comprobante (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),  -- lo manda la aplicación: es la «solicitud» de la serie
  empresa_id          uuid NOT NULL REFERENCES empresa (id),
  emisor_id           uuid NOT NULL,
  punto_de_venta_id   uuid NOT NULL,
  ambiente            text NOT NULL CONSTRAINT comprobante_ambiente_ck CHECK (ambiente IN ('HOMOLOGACION', 'PRODUCCION')),
  -- identidad y origen (catálogo abierto con CHECK: lo decidió el spec; fiscal no interpreta los orígenes)
  origen_tipo         text NOT NULL CONSTRAINT comprobante_origen_tipo_ck CHECK (origen_tipo IN
                        ('MANUAL', 'EJEMPLAR_DE_TICKET', 'PROPINA_DE_TICKET', 'CORRECCION_DE_TICKET', 'SUSCRIPCION')),
  origen_id           text NOT NULL CONSTRAINT comprobante_origen_id_ck CHECK (
                        origen_id = btrim(origen_id) AND char_length(origen_id) BETWEEN 1 AND 100),
  clase               text NOT NULL CONSTRAINT comprobante_clase_ck CHECK (clase IN ('FACTURA', 'NOTA_DEBITO', 'NOTA_CREDITO')),
  -- Los nueve tipos del dominio (`TIPOS_DE_COMPROBANTE`); los códigos de ARCA viven en el adaptador.
  tipo_comprobante    text NOT NULL CONSTRAINT comprobante_tipo_ck CHECK (tipo_comprobante IN (
                        'FACTURA_A', 'FACTURA_B', 'FACTURA_C', 'NOTA_DEBITO_A', 'NOTA_DEBITO_B', 'NOTA_DEBITO_C',
                        'NOTA_CREDITO_A', 'NOTA_CREDITO_B', 'NOTA_CREDITO_C')),
  -- La clase es la del tipo: `NOTA_CREDITO_B` es una `NOTA_CREDITO`.
  CONSTRAINT comprobante_clase_tipo_ck CHECK (tipo_comprobante = clase || '_' || right(tipo_comprobante, 1)),
  concepto            text NOT NULL CONSTRAINT comprobante_concepto_ck CHECK (concepto IN
                        ('PRODUCTOS', 'SERVICIOS', 'PRODUCTOS_Y_SERVICIOS')),
  servicio_desde      date,
  servicio_hasta      date,
  vencimiento_pago    date,
  -- Productos: ninguna fecha. Servicios (o ambos): las tres, y el período en orden.
  CONSTRAINT comprobante_servicio_ck CHECK (
    (concepto = 'PRODUCTOS' AND servicio_desde IS NULL AND servicio_hasta IS NULL AND vencimiento_pago IS NULL)
    OR (concepto <> 'PRODUCTOS' AND servicio_desde IS NOT NULL AND servicio_hasta IS NOT NULL
        AND vencimiento_pago IS NOT NULL AND servicio_desde <= servicio_hasta)),
  -- Moneda explícita (ADR-006): sin valor por defecto. Hoy solo pesos.
  moneda              char(3) NOT NULL CONSTRAINT comprobante_moneda_ck CHECK (moneda = 'ARS'),
  modo_de_precio      text NOT NULL CONSTRAINT comprobante_modo_ck CHECK (modo_de_precio IN ('IVA_INCLUIDO', 'IVA_DISCRIMINADO')),
  -- La letra C no discrimina IVA: su precio es el final.
  CONSTRAINT comprobante_modo_c_ck CHECK (right(tipo_comprobante, 1) <> 'C' OR modo_de_precio = 'IVA_INCLUIDO'),
  -- Importes (ADR-006): exactos, positivos (también en una nota de crédito: la clase da el sentido) y con
  -- la cota de `ImpTotal` de WSFE (trece enteros y dos decimales); la cota deja afuera a `NaN` (D11).
  total               numeric(18,2) NOT NULL,
  neto_gravado        numeric(18,2) NOT NULL,
  iva                 numeric(18,2) NOT NULL,
  exento              numeric(18,2) NOT NULL,
  no_gravado          numeric(18,2) NOT NULL,
  CONSTRAINT comprobante_importes_ck CHECK (
    total > 0 AND total <= 9999999999999.99
    AND neto_gravado >= 0 AND neto_gravado <= total AND iva >= 0 AND iva <= total
    AND exento >= 0 AND exento <= total AND no_gravado >= 0 AND no_gravado <= total
    AND total = neto_gravado + iva + exento + no_gravado),
  -- Letra C: sin IVA, todo es neto.
  CONSTRAINT comprobante_c_sin_iva_ck CHECK (right(tipo_comprobante, 1) <> 'C' OR (iva = 0 AND neto_gravado = total)),
  -- Foto del emisor y del punto de venta al emitir (D8). Cambiar la configuración después no altera lo emitido.
  datos_fiscales_id   uuid NOT NULL,
  emisor_cuit         text NOT NULL CONSTRAINT comprobante_emisor_cuit_ck CHECK (cuit_valido(emisor_cuit)),
  emisor_razon_social text NOT NULL CONSTRAINT comprobante_emisor_razon_social_ck CHECK (texto_fiscal_valido(emisor_razon_social, 200)),
  emisor_condicion_iva text NOT NULL CONSTRAINT comprobante_emisor_condicion_ck CHECK (
                        emisor_condicion_iva IN ('RESPONSABLE_INSCRIPTO', 'MONOTRIBUTO', 'EXENTO')),
  emisor_domicilio_fiscal text NOT NULL CONSTRAINT comprobante_emisor_domicilio_ck CHECK (texto_fiscal_valido(emisor_domicilio_fiscal, 500)),
  emisor_inicio_actividades date NOT NULL CONSTRAINT comprobante_emisor_inicio_ck CHECK (emisor_inicio_actividades >= DATE '0001-01-01'),
  emisor_iibb_numero  text CONSTRAINT comprobante_emisor_iibb_numero_ck CHECK (
                        emisor_iibb_numero IS NULL OR texto_fiscal_valido(emisor_iibb_numero, 30)),
  emisor_iibb_condicion text CONSTRAINT comprobante_emisor_iibb_condicion_ck CHECK (
                        emisor_iibb_condicion IS NULL OR emisor_iibb_condicion IN ('LOCAL', 'CONVENIO_MULTILATERAL', 'EXENTO')),
  punto_de_venta_numero integer NOT NULL CONSTRAINT comprobante_pv_numero_ck CHECK (punto_de_venta_numero BETWEEN 1 AND 99999),
  punto_de_venta_domicilio text NOT NULL CONSTRAINT comprobante_pv_domicilio_ck CHECK (texto_fiscal_valido(punto_de_venta_domicilio, 500)),
  -- Receptor congelado (sin clave foránea a clientes: ADR-014). Las condiciones son las once de WSFE v4.8.
  receptor_parte_id   uuid,
  receptor_nombre     text CONSTRAINT comprobante_receptor_nombre_ck CHECK (
                        receptor_nombre IS NULL OR texto_fiscal_valido(receptor_nombre, 200)),
  receptor_documento_tipo text NOT NULL CONSTRAINT comprobante_receptor_doc_tipo_ck CHECK (
                        receptor_documento_tipo IN ('CUIT', 'CUIL', 'CDI', 'DNI', 'PASAPORTE', 'SIN_IDENTIFICAR')),
  receptor_documento_numero text,
  receptor_condicion_iva text NOT NULL CONSTRAINT comprobante_receptor_condicion_ck CHECK (receptor_condicion_iva IN (
                        'RESPONSABLE_INSCRIPTO', 'EXENTO', 'CONSUMIDOR_FINAL', 'MONOTRIBUTO', 'NO_CATEGORIZADO',
                        'PROVEEDOR_DEL_EXTERIOR', 'CLIENTE_DEL_EXTERIOR', 'IVA_LIBERADO_LEY_19640',
                        'MONOTRIBUTISTA_SOCIAL', 'IVA_NO_ALCANZADO', 'MONOTRIBUTO_TRABAJADOR_INDEPENDIENTE_PROMOVIDO')),
  receptor_domicilio  text CONSTRAINT comprobante_receptor_domicilio_ck CHECK (
                        receptor_domicilio IS NULL OR texto_fiscal_valido(receptor_domicilio, 300)),
  -- Sin identificar <=> sin número; el que se identifica tiene nombre. `DocNro` es un `Long (11)` en WSFE: solo
  -- dígitos, y el CUIT, CUIL y CDI con su dígito verificador.
  CONSTRAINT comprobante_receptor_ck CHECK (
    (receptor_documento_tipo = 'SIN_IDENTIFICAR') = (receptor_documento_numero IS NULL)
    AND (receptor_documento_tipo = 'SIN_IDENTIFICAR' OR receptor_nombre IS NOT NULL)),
  CONSTRAINT comprobante_receptor_documento_ck CHECK (
    receptor_documento_numero IS NULL
    OR (receptor_documento_numero ~ '^[0-9]{1,11}$'
        AND (receptor_documento_tipo NOT IN ('CUIT', 'CUIL', 'CDI') OR cuit_valido(receptor_documento_numero)))),
  -- Nota asociada (D9). Solo las notas tienen asociado y motivo.
  comprobante_asociado_id uuid,
  motivo              text,
  CONSTRAINT comprobante_asociado_ck CHECK ((clase = 'FACTURA') = (comprobante_asociado_id IS NULL)),
  CONSTRAINT comprobante_motivo_ck CHECK (motivo IS NULL OR (clase <> 'FACTURA' AND texto_fiscal_valido(motivo, 200))),
  -- Estado frente a ARCA (D1, D3)
  estado              text NOT NULL DEFAULT 'PENDIENTE' CONSTRAINT comprobante_estado_ck CHECK (estado IN
                        ('PENDIENTE', 'EN_VALIDACION', 'AUTORIZADO', 'RECHAZADO', 'INCIERTO', 'CONFLICTO', 'DESCARTADO')),
  envios              integer NOT NULL DEFAULT 0 CONSTRAINT comprobante_envios_ck CHECK (
                        envios >= 0 AND (estado IN ('PENDIENTE', 'DESCARTADO') OR envios >= 1)),
  numero_reservado    bigint,
  fecha_emision       date,
  numero              bigint,
  cae                 text,
  cae_vence           date,
  autorizado_en       timestamptz,
  resuelto_por        text,
  motivo_descarte     text,
  -- Tabla de §B.2.1: pendiente, sin número ni fecha; en vuelo, rechazado, autorizado y en conflicto, con los
  -- dos (el rechazado conserva el que se intentó, para diagnosticar); descartado, con los dos o con ninguno
  -- (un descartado desde CONFLICTO conserva el disputado).
  CONSTRAINT comprobante_reserva_ck CHECK (
    (estado = 'PENDIENTE' AND numero_reservado IS NULL AND fecha_emision IS NULL)
    OR (estado IN ('EN_VALIDACION', 'INCIERTO', 'AUTORIZADO', 'CONFLICTO', 'RECHAZADO')
        AND numero_reservado IS NOT NULL AND fecha_emision IS NOT NULL AND numero_reservado BETWEEN 1 AND 99999999)
    OR (estado = 'DESCARTADO' AND (numero_reservado IS NULL) = (fecha_emision IS NULL)
        AND (numero_reservado IS NULL OR numero_reservado BETWEEN 1 AND 99999999))),
  -- Autorizado <=> con número, CAE de 14 dígitos, vencimiento, instante y quién lo resolvió.
  CONSTRAINT comprobante_autorizado_ck CHECK (
    (estado = 'AUTORIZADO' AND numero IS NOT NULL AND numero_reservado IS NOT NULL AND numero = numero_reservado
      AND cae IS NOT NULL AND cae ~ '^[0-9]{14}$' AND cae_vence IS NOT NULL AND autorizado_en IS NOT NULL
      AND resuelto_por IS NOT NULL AND resuelto_por IN ('RESPUESTA', 'RECONCILIACION'))
    OR (estado <> 'AUTORIZADO' AND numero IS NULL AND cae IS NULL AND cae_vence IS NULL AND autorizado_en IS NULL
      AND resuelto_por IS NULL)),
  CONSTRAINT comprobante_cae_vence_ck CHECK (cae_vence IS NULL OR cae_vence >= fecha_emision),
  -- Descartado <=> con motivo.
  CONSTRAINT comprobante_descarte_ck CHECK (
    (estado = 'DESCARTADO' AND motivo_descarte IS NOT NULL AND texto_fiscal_valido(motivo_descarte, 500))
    OR (estado <> 'DESCARTADO' AND motivo_descarte IS NULL)),
  huella              text NOT NULL CONSTRAINT comprobante_huella_ck CHECK (huella ~ '^[0-9a-f]{64}$'),
  version_de_representacion smallint NOT NULL DEFAULT 1 CONSTRAINT comprobante_representacion_ck CHECK (version_de_representacion >= 1),
  creado_por          uuid NOT NULL REFERENCES persona (id),
  creado_en           timestamptz NOT NULL DEFAULT now(),
  actualizado_en      timestamptz NOT NULL DEFAULT now(),
  version             integer NOT NULL DEFAULT 1,
  CONSTRAINT comprobante_id_empresa_uk UNIQUE (id, empresa_id),
  CONSTRAINT comprobante_id_empresa_emisor_uk UNIQUE (id, empresa_id, emisor_id),
  CONSTRAINT comprobante_emisor_fkey FOREIGN KEY (emisor_id, empresa_id) REFERENCES emisor (id, empresa_id),
  CONSTRAINT comprobante_pv_fkey FOREIGN KEY (punto_de_venta_id, emisor_id, empresa_id)
    REFERENCES punto_de_venta (id, emisor_id, empresa_id),
  CONSTRAINT comprobante_datos_fiscales_fkey FOREIGN KEY (datos_fiscales_id, empresa_id, emisor_id)
    REFERENCES datos_fiscales (id, empresa_id, emisor_id),
  CONSTRAINT comprobante_asociado_fkey FOREIGN KEY (comprobante_asociado_id, empresa_id, emisor_id)
    REFERENCES comprobante (id, empresa_id, emisor_id)
);

-- Identidad (D2): a lo sumo UN comprobante vigente por origen, emisor y clase. Rechazado y descartado liberan el origen.
CREATE UNIQUE INDEX comprobante_identidad_uk ON comprobante (empresa_id, origen_tipo, origen_id, emisor_id, clase)
  WHERE estado NOT IN ('RECHAZADO', 'DESCARTADO');
-- Lo manual: una clave nunca da dos comprobantes, ni siquiera después de un rechazo (D2).
CREATE UNIQUE INDEX comprobante_manual_uk ON comprobante (empresa_id, origen_id) WHERE origen_tipo = 'MANUAL';
-- Un número autorizado por serie, nunca dos.
CREATE UNIQUE INDEX comprobante_numero_uk ON comprobante (empresa_id, punto_de_venta_id, tipo_comprobante, ambiente, numero)
  WHERE numero IS NOT NULL;
-- Un comprobante en vuelo por serie (D3); también es lo que recorre la reconciliación.
CREATE UNIQUE INDEX comprobante_en_vuelo_uk ON comprobante (empresa_id, punto_de_venta_id, tipo_comprobante, ambiente)
  WHERE estado IN ('EN_VALIDACION', 'INCIERTO');
CREATE INDEX comprobante_listado_ix ON comprobante (empresa_id, creado_en DESC, id);
CREATE INDEX comprobante_origen_ix ON comprobante (empresa_id, origen_tipo, origen_id);
CREATE INDEX comprobante_asociado_ix ON comprobante (empresa_id, comprobante_asociado_id)
  WHERE comprobante_asociado_id IS NOT NULL;

-- ---------------------------------------------------------------------------------------------
-- Renglones y desglose por alícuota: de solo inserción, nacen con el comprobante
-- ---------------------------------------------------------------------------------------------
CREATE TABLE comprobante_linea (
  empresa_id      uuid NOT NULL REFERENCES empresa (id),
  comprobante_id  uuid NOT NULL,
  posicion        smallint NOT NULL CONSTRAINT comprobante_linea_posicion_ck CHECK (posicion BETWEEN 1 AND 200),
  descripcion     text NOT NULL CONSTRAINT comprobante_linea_descripcion_ck CHECK (texto_fiscal_valido(descripcion, 200)),
  cantidad        numeric(18, 4) NOT NULL CONSTRAINT comprobante_linea_cantidad_ck CHECK (cantidad > 0 AND cantidad < 100000000000000),
  precio_unitario numeric(18, 6) NOT NULL CONSTRAINT comprobante_linea_precio_ck CHECK (precio_unitario >= 0 AND precio_unitario < 1000000000000),
  descuento       numeric(7, 4) CONSTRAINT comprobante_linea_descuento_ck CHECK (descuento IS NULL OR descuento BETWEEN 0 AND 100),
  -- Sin alícuota solo en la letra C (lo comprueba `comprobante_cuadra`).
  alicuota        text CONSTRAINT comprobante_linea_alicuota_ck CHECK (
                    alicuota IS NULL OR alicuota IN ('0', '2.5', '5', '10.5', '21', '27', 'EXENTO', 'NO_GRAVADO')),
  -- Importe final del renglón (con IVA), prorrateado: la suma de los renglones es el total.
  importe         numeric(18, 2) NOT NULL CONSTRAINT comprobante_linea_importe_ck CHECK (importe >= 0 AND importe <= 9999999999999.99),
  CONSTRAINT comprobante_linea_pkey PRIMARY KEY (empresa_id, comprobante_id, posicion),
  CONSTRAINT comprobante_linea_comprobante_fkey FOREIGN KEY (comprobante_id, empresa_id)
    REFERENCES comprobante (id, empresa_id)
);

-- El desglose por alícuota: lo que se calculó (y se informa) de cada alícuota del comprobante. Exento y no
-- gravado son filas sin IVA. La lista de `AlicIva` que se manda a ARCA se deriva de acá (importesParaArca).
CREATE TABLE comprobante_alicuota (
  empresa_id      uuid NOT NULL REFERENCES empresa (id),
  comprobante_id  uuid NOT NULL,
  alicuota        text NOT NULL CONSTRAINT comprobante_alicuota_codigo_ck CHECK (
                    alicuota IN ('0', '2.5', '5', '10.5', '21', '27', 'EXENTO', 'NO_GRAVADO')),
  total           numeric(18, 2) NOT NULL,
  neto            numeric(18, 2) NOT NULL,
  iva             numeric(18, 2) NOT NULL,
  CONSTRAINT comprobante_alicuota_ck CHECK (
    total >= 0 AND total <= 9999999999999.99 AND neto >= 0 AND neto <= total AND iva >= 0 AND iva <= total
    AND total = neto + iva
    AND (alicuota NOT IN ('EXENTO', 'NO_GRAVADO') OR (iva = 0 AND neto = total))),
  CONSTRAINT comprobante_alicuota_pkey PRIMARY KEY (empresa_id, comprobante_id, alicuota),
  CONSTRAINT comprobante_alicuota_comprobante_fkey FOREIGN KEY (comprobante_id, empresa_id)
    REFERENCES comprobante (id, empresa_id)
);

-- ---------------------------------------------------------------------------------------------
-- Certificados de ARCA, ticket de acceso e intentos (D10)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE certificado_arca (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL REFERENCES empresa (id),
  emisor_id       uuid NOT NULL,
  ambiente        text NOT NULL CONSTRAINT certificado_ambiente_ck CHECK (ambiente IN ('HOMOLOGACION', 'PRODUCCION')),
  alias           text NOT NULL CONSTRAINT certificado_alias_ck CHECK (alias ~ '^[A-Za-z0-9]{1,30}$'),  -- formato de ARCA: NO VERIFICADO
  cuit_titular    text NOT NULL CONSTRAINT certificado_cuit_titular_ck CHECK (cuit_valido(cuit_titular)),
  estado          text NOT NULL DEFAULT 'PEDIDO_GENERADO' CONSTRAINT certificado_estado_ck CHECK (estado IN
                    ('PEDIDO_GENERADO', 'VIGENTE', 'REEMPLAZADO', 'DESCARTADO')),
  pedido_pem      text NOT NULL CONSTRAINT certificado_pedido_ck CHECK (octet_length(pedido_pem) BETWEEN 1 AND 16384),  -- público
  certificado_pem text CONSTRAINT certificado_pem_ck CHECK (certificado_pem IS NULL OR octet_length(certificado_pem) BETWEEN 1 AND 16384),
  huella_sha256   text CONSTRAINT certificado_huella_ck CHECK (huella_sha256 IS NULL OR huella_sha256 ~ '^[0-9a-f]{64}$'),
  vence_en        timestamptz,
  autorizacion_verificada_en timestamptz,
  -- La clave privada, cifrada con AES-256-GCM ligada a esta fila (nonce de 12 bytes, etiqueta de 16).
  clave_cifrada   bytea NOT NULL CONSTRAINT certificado_clave_ck CHECK (octet_length(clave_cifrada) BETWEEN 1 AND 8192),
  clave_nonce     bytea NOT NULL,
  clave_etiqueta  bytea NOT NULL,
  clave_kid       text NOT NULL CONSTRAINT certificado_kid_ck CHECK (texto_fiscal_valido(clave_kid, 100)),
  creado_por      uuid NOT NULL REFERENCES persona (id),
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_en  timestamptz NOT NULL DEFAULT now(),
  version         integer NOT NULL DEFAULT 1,
  CONSTRAINT certificado_id_empresa_uk UNIQUE (id, empresa_id),
  CONSTRAINT certificado_emisor_fkey FOREIGN KEY (emisor_id, empresa_id) REFERENCES emisor (id, empresa_id),
  CONSTRAINT certificado_cifrado_ck CHECK (octet_length(clave_nonce) = 12 AND octet_length(clave_etiqueta) = 16),
  -- Cargado (VIGENTE o REEMPLAZADO) <=> con certificado, huella y vencimiento; la verificación solo existe en esos estados.
  CONSTRAINT certificado_cargado_ck CHECK (
    (estado IN ('VIGENTE', 'REEMPLAZADO') AND certificado_pem IS NOT NULL AND huella_sha256 IS NOT NULL
      AND vence_en IS NOT NULL)
    OR (estado IN ('PEDIDO_GENERADO', 'DESCARTADO') AND certificado_pem IS NULL AND huella_sha256 IS NULL
      AND vence_en IS NULL AND autorizacion_verificada_en IS NULL))
);
-- A lo sumo un certificado VIGENTE por emisor y ambiente.
CREATE UNIQUE INDEX certificado_vigente_uk ON certificado_arca (empresa_id, emisor_id, ambiente) WHERE estado = 'VIGENTE';
-- El mismo certificado no se carga dos veces.
CREATE UNIQUE INDEX certificado_huella_uk ON certificado_arca (empresa_id, huella_sha256) WHERE huella_sha256 IS NOT NULL;

-- Caché del ticket de acceso de WSAA (12 horas), cifrado como la clave.
CREATE TABLE acceso_arca (
  empresa_id          uuid NOT NULL REFERENCES empresa (id),
  certificado_id      uuid NOT NULL,
  servicio            text NOT NULL CONSTRAINT acceso_servicio_ck CHECK (servicio IN ('wsfe')),
  credencial_cifrada  bytea,
  credencial_nonce    bytea,
  credencial_etiqueta bytea,
  credencial_kid      text,
  generado_en         timestamptz,
  expira_en           timestamptz,
  renovando_hasta     timestamptz,
  creado_en           timestamptz NOT NULL DEFAULT now(),
  actualizado_en      timestamptz NOT NULL DEFAULT now(),
  version             integer NOT NULL DEFAULT 1,
  CONSTRAINT acceso_pkey PRIMARY KEY (empresa_id, certificado_id, servicio),
  CONSTRAINT acceso_certificado_fkey FOREIGN KEY (certificado_id, empresa_id)
    REFERENCES certificado_arca (id, empresa_id),
  -- Sin credencial no hay nada; con credencial, todas sus partes y un vencimiento posterior a la generación.
  CONSTRAINT acceso_completo_ck CHECK (
    (credencial_cifrada IS NULL AND credencial_nonce IS NULL AND credencial_etiqueta IS NULL
      AND credencial_kid IS NULL AND generado_en IS NULL AND expira_en IS NULL)
    OR (credencial_cifrada IS NOT NULL AND octet_length(credencial_cifrada) BETWEEN 1 AND 8192
      AND credencial_nonce IS NOT NULL AND octet_length(credencial_nonce) = 12
      AND credencial_etiqueta IS NOT NULL AND octet_length(credencial_etiqueta) = 16
      AND credencial_kid IS NOT NULL AND texto_fiscal_valido(credencial_kid, 100)
      AND generado_en IS NOT NULL AND expira_en IS NOT NULL AND expira_en > generado_en))
);

-- Cada llamada a ARCA por un comprobante, de solo inserción: la única evidencia de un CAE si el cierre falla.
CREATE TABLE intento_arca (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     uuid NOT NULL REFERENCES empresa (id),
  comprobante_id uuid NOT NULL,
  operacion      text NOT NULL CONSTRAINT intento_operacion_ck CHECK (operacion IN
                   ('AUTORIZAR', 'CONSULTAR', 'ULTIMO_AUTORIZADO')),
  numero         bigint CONSTRAINT intento_numero_ck CHECK (numero IS NULL OR numero >= 0),
  desenlace      text NOT NULL CONSTRAINT intento_desenlace_ck CHECK (desenlace IN
                   ('AUTORIZADO', 'RECHAZADO', 'INCIERTO', 'NO_ENVIADO', 'ENCONTRADO', 'NO_ENCONTRADO',
                    'CONSULTA_FALLIDA', 'RESPONDIDO')),
  -- Cada operación termina de una de sus maneras (autorizar no «encuentra»; consultar no «autoriza»).
  CONSTRAINT intento_operacion_desenlace_ck CHECK (
    (operacion = 'AUTORIZAR' AND desenlace IN ('AUTORIZADO', 'RECHAZADO', 'INCIERTO', 'NO_ENVIADO'))
    OR (operacion = 'CONSULTAR' AND desenlace IN ('ENCONTRADO', 'NO_ENCONTRADO', 'CONSULTA_FALLIDA'))
    OR (operacion = 'ULTIMO_AUTORIZADO' AND desenlace IN ('RESPONDIDO', 'CONSULTA_FALLIDA'))),
  mensajes       jsonb NOT NULL DEFAULT '[]' CONSTRAINT intento_mensajes_ck CHECK (jsonb_typeof(mensajes) = 'array'),
  respuesta      text CONSTRAINT intento_respuesta_ck CHECK (respuesta IS NULL OR octet_length(respuesta) <= 65536),
  huella_pedido  text CONSTRAINT intento_huella_ck CHECK (huella_pedido IS NULL OR huella_pedido ~ '^[0-9a-f]{64}$'),
  iniciado_en    timestamptz NOT NULL,
  duracion_ms    integer NOT NULL CONSTRAINT intento_duracion_ck CHECK (duracion_ms >= 0),
  CONSTRAINT intento_comprobante_fkey FOREIGN KEY (comprobante_id, empresa_id)
    REFERENCES comprobante (id, empresa_id)
);
CREATE INDEX intento_comprobante_ix ON intento_arca (empresa_id, comprobante_id, iniciado_en);

-- ---------------------------------------------------------------------------------------------
-- Funciones de disparador
-- ---------------------------------------------------------------------------------------------

-- Serie: la de 0006 más el ambiente en la identidad inmutable (D6) y la única salida de BLOQUEADA, hacia LIBRE
-- (D7): el último número puede saltar hacia adelante (nunca baja). El resto, igual que en 0006 (E6).
CREATE OR REPLACE FUNCTION serie_comprobante_validar_cambio() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF NEW.empresa_id IS DISTINCT FROM OLD.empresa_id
     OR NEW.punto_de_venta_id IS DISTINCT FROM OLD.punto_de_venta_id
     OR NEW.emisor_id IS DISTINCT FROM OLD.emisor_id
     OR NEW.tipo_comprobante IS DISTINCT FROM OLD.tipo_comprobante
     OR NEW.ambiente IS DISTINCT FROM OLD.ambiente
     OR NEW.creado_en IS DISTINCT FROM OLD.creado_en
  THEN
    RAISE EXCEPTION 'la identidad de una serie no se puede cambiar'
      USING ERRCODE = '23514', CONSTRAINT = 'serie_inmutable';
  END IF;

  -- El último número nunca baja; solo sube de a uno cerrando la EN_CURSO que lo reservó, o saltando al
  -- liberar una BLOQUEADA (los números del medio los emitió otro sistema).
  IF NEW.ultimo_numero < OLD.ultimo_numero THEN
    RAISE EXCEPTION 'el último número de una serie no baja'
      USING ERRCODE = '23514', CONSTRAINT = 'serie_numero_invalido';
  ELSIF NEW.ultimo_numero > OLD.ultimo_numero
        AND NOT (OLD.estado = 'EN_CURSO' AND NEW.estado = 'LIBRE' AND NEW.ultimo_numero = OLD.numero_en_curso)
        AND NOT (OLD.estado = 'BLOQUEADA' AND NEW.estado = 'LIBRE')
  THEN
    RAISE EXCEPTION 'el último número solo sube de a uno, al cerrar la reserva de ese número'
      USING ERRCODE = '23514', CONSTRAINT = 'serie_numero_invalido';
  END IF;

  IF NEW.estado <> OLD.estado THEN
    IF NOT (
      (OLD.estado = 'LIBRE' AND NEW.estado = 'EN_CURSO')
      OR (OLD.estado = 'EN_CURSO' AND NEW.estado IN ('LIBRE', 'BLOQUEADA'))
      OR (OLD.estado = 'BLOQUEADA' AND NEW.estado = 'LIBRE')
    ) THEN
      RAISE EXCEPTION 'transición de estado no permitida: % -> %', OLD.estado, NEW.estado
        USING ERRCODE = '23514', CONSTRAINT = 'serie_transicion_invalida';
    END IF;
    IF OLD.estado = 'LIBRE' THEN
      PERFORM pg_advisory_xact_lock_shared(hashtextextended('pedernal.fiscal.emisor:' || OLD.emisor_id::text, 0));
    END IF;
  ELSIF OLD.estado = 'EN_CURSO' THEN
    -- Una reserva incierta sigue EN_CURSO sin cambios.
    IF NEW.numero_en_curso IS DISTINCT FROM OLD.numero_en_curso
       OR NEW.solicitud_en_curso IS DISTINCT FROM OLD.solicitud_en_curso
       OR NEW.en_curso_hasta IS DISTINCT FROM OLD.en_curso_hasta
    THEN
      RAISE EXCEPTION 'una serie EN_CURSO no cambia su reserva'
        USING ERRCODE = '23514', CONSTRAINT = 'serie_transicion_invalida';
    END IF;
  ELSIF OLD.estado = 'BLOQUEADA' THEN
    IF NEW.motivo_bloqueo IS DISTINCT FROM OLD.motivo_bloqueo THEN
      RAISE EXCEPTION 'una serie BLOQUEADA no cambia su motivo: solo sale hacia LIBRE'
        USING ERRCODE = '23514', CONSTRAINT = 'serie_transicion_invalida';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

-- Una serie nace en el ambiente de su punto de venta (D6). El punto de venta se bloquea (FOR SHARE) antes de
-- mirarlo: un cambio de ambiente concurrente espera, o esta alta ve el nuevo.
CREATE FUNCTION serie_comprobante_validar_alta() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_ambiente text;
BEGIN
  SELECT p.ambiente INTO v_ambiente
    FROM public.punto_de_venta p
   WHERE p.id = NEW.punto_de_venta_id AND p.empresa_id = NEW.empresa_id
     FOR SHARE;
  -- Un punto de venta inexistente lo rechaza la clave foránea (serie_punto_de_venta_fkey).
  IF FOUND AND v_ambiente <> NEW.ambiente THEN
    RAISE EXCEPTION 'la serie tiene que ser del ambiente de su punto de venta (%)', v_ambiente
      USING ERRCODE = '23514', CONSTRAINT = 'serie_ambiente_invalido';
  END IF;
  RETURN NEW;
END
$$;

-- Cambiar el ambiente de un punto de venta (D6): no con una serie EN_CURSO (habría un número en vuelo en el
-- ambiente que se deja) y no de producción a homologación si su serie de producción ya se usó. Se bloquean con
-- FOR SHARE todas sus series ANTES de mirarlas, como el cambio de número de 0006 (E3).
CREATE FUNCTION punto_de_venta_validar_ambiente() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF NEW.ambiente IS NOT DISTINCT FROM OLD.ambiente THEN
    RETURN NEW;
  END IF;
  PERFORM 1 FROM public.serie_comprobante s
   WHERE s.empresa_id = OLD.empresa_id AND s.punto_de_venta_id = OLD.id
     FOR SHARE;
  IF EXISTS (
    SELECT 1 FROM public.serie_comprobante s
     WHERE s.empresa_id = OLD.empresa_id AND s.punto_de_venta_id = OLD.id AND s.estado = 'EN_CURSO'
  ) THEN
    RAISE EXCEPTION 'el punto de venta tiene un número en curso: su ambiente no cambia'
      USING ERRCODE = '23514', CONSTRAINT = 'punto_de_venta_ambiente_con_serie_en_curso';
  END IF;
  IF OLD.ambiente = 'PRODUCCION' AND EXISTS (
    SELECT 1 FROM public.serie_comprobante s
     WHERE s.empresa_id = OLD.empresa_id AND s.punto_de_venta_id = OLD.id AND s.ambiente = 'PRODUCCION'
       AND (s.ultimo_numero > 0 OR s.estado <> 'LIBRE')
  ) THEN
    RAISE EXCEPTION 'el punto de venta ya emitió en producción: no vuelve a homologación'
      USING ERRCODE = '23514', CONSTRAINT = 'punto_de_venta_ambiente_no_vuelve';
  END IF;
  RETURN NEW;
END
$$;

-- Alta de un comprobante: nace PENDIENTE y sin envíos, y su foto coincide con su fuente (D8); si es una nota,
-- su asociado cumple D9. El punto de venta se bloquea con FOR SHARE antes de leerlo, así su ambiente no
-- cambia entre esta lectura y la confirmación.
CREATE FUNCTION comprobante_validar_alta() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_pv record;
  v_df record;
  v_cuit text;
  v_aso record;
BEGIN
  IF NEW.estado <> 'PENDIENTE' OR NEW.envios <> 0 THEN
    RAISE EXCEPTION 'un comprobante nace PENDIENTE y sin envíos'
      USING ERRCODE = '23514', CONSTRAINT = 'comprobante_alta_invalida';
  END IF;

  -- Un punto de venta, unos datos fiscales o un emisor inexistentes (o de otra empresa) los rechazan las
  -- claves foráneas compuestas: acá solo se compara lo que existe.
  SELECT p.estado, p.numero, p.ambiente INTO v_pv
    FROM public.punto_de_venta p
   WHERE p.id = NEW.punto_de_venta_id AND p.empresa_id = NEW.empresa_id AND p.emisor_id = NEW.emisor_id
     FOR SHARE;
  IF FOUND AND (v_pv.estado <> 'ACTIVO' OR v_pv.numero <> NEW.punto_de_venta_numero
                OR v_pv.ambiente <> NEW.ambiente) THEN
    RAISE EXCEPTION 'el punto de venta no está activo, o su número o su ambiente no son los del comprobante'
      USING ERRCODE = '23514', CONSTRAINT = 'comprobante_alta_invalida';
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
    SELECT a.estado, a.ambiente, a.clase, a.tipo_comprobante, a.receptor_documento_tipo, a.receptor_documento_numero
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
  END IF;
  RETURN NEW;
END
$$;

-- Cambio de un comprobante: la tabla de transiciones de §B.2.2, exacta (D1). Solo se mueven las columnas de estado.
CREATE FUNCTION comprobante_validar_cambio() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  -- Lo único que el estado mueve; lo demás (renglones, importes, emisor, receptor, asociado...) no cambia nunca.
  v_de_estado constant text[] := ARRAY['estado', 'envios', 'numero_reservado', 'fecha_emision', 'numero', 'cae',
                                        'cae_vence', 'autorizado_en', 'resuelto_por', 'motivo_descarte',
                                        'actualizado_en', 'version'];
BEGIN
  IF (to_jsonb(NEW) - v_de_estado) IS DISTINCT FROM (to_jsonb(OLD) - v_de_estado) THEN
    RAISE EXCEPTION 'el contenido de un comprobante no se puede modificar: se corrige con un comprobante nuevo'
      USING ERRCODE = '23514', CONSTRAINT = 'comprobante_inmutable';
  END IF;

  IF NEW.estado = OLD.estado THEN
    -- Sin cambiar de estado no cambia nada (la versión y la fecha las fija otro disparador).
    IF (to_jsonb(NEW) - ARRAY['actualizado_en', 'version']) IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['actualizado_en', 'version']) THEN
      RAISE EXCEPTION 'un comprobante % no cambia sus datos de estado sin cambiar de estado', OLD.estado
        USING ERRCODE = '23514', CONSTRAINT = 'comprobante_transicion_invalida';
    END IF;
    RETURN NEW;
  END IF;

  IF NOT (
    (OLD.estado = 'PENDIENTE' AND NEW.estado IN ('EN_VALIDACION', 'DESCARTADO'))
    OR (OLD.estado = 'EN_VALIDACION' AND NEW.estado IN ('AUTORIZADO', 'RECHAZADO', 'INCIERTO', 'PENDIENTE', 'CONFLICTO'))
    OR (OLD.estado = 'INCIERTO' AND NEW.estado IN ('AUTORIZADO', 'PENDIENTE', 'CONFLICTO'))
    OR (OLD.estado = 'CONFLICTO' AND NEW.estado IN ('PENDIENTE', 'DESCARTADO'))
  ) THEN
    RAISE EXCEPTION 'transición de estado no permitida: % -> %', OLD.estado, NEW.estado
      USING ERRCODE = '23514', CONSTRAINT = 'comprobante_transicion_invalida';
  END IF;

  -- Los envíos suben de a uno, y solo al entrar a EN_VALIDACION.
  IF NEW.estado = 'EN_VALIDACION' THEN
    IF NEW.envios <> OLD.envios + 1 THEN
      RAISE EXCEPTION 'los envíos suben de a uno al entrar a EN_VALIDACION'
        USING ERRCODE = '23514', CONSTRAINT = 'comprobante_transicion_invalida';
    END IF;
  ELSIF NEW.envios <> OLD.envios THEN
    RAISE EXCEPTION 'los envíos solo cambian al entrar a EN_VALIDACION'
      USING ERRCODE = '23514', CONSTRAINT = 'comprobante_transicion_invalida';
  END IF;

  -- El número y la fecha se fijan al entrar a EN_VALIDACION y se vacían al volver a PENDIENTE (los exige el CHECK
  -- de la tabla); en cualquier otra transición no se tocan.
  IF NEW.estado NOT IN ('EN_VALIDACION', 'PENDIENTE')
     AND (NEW.numero_reservado IS DISTINCT FROM OLD.numero_reservado
          OR NEW.fecha_emision IS DISTINCT FROM OLD.fecha_emision) THEN
    RAISE EXCEPTION 'el número reservado y la fecha del comprobante solo cambian al reservar o al liberar'
      USING ERRCODE = '23514', CONSTRAINT = 'comprobante_transicion_invalida';
  END IF;

  -- Un INCIERTO solo se resuelve consultando a ARCA: nunca con una respuesta del pedido original.
  IF OLD.estado = 'INCIERTO' AND NEW.estado = 'AUTORIZADO' AND NEW.resuelto_por IS DISTINCT FROM 'RECONCILIACION' THEN
    RAISE EXCEPTION 'un comprobante incierto solo se autoriza por reconciliación'
      USING ERRCODE = '23514', CONSTRAINT = 'comprobante_transicion_invalida';
  END IF;
  RETURN NEW;
END
$$;

-- Coherencia con la serie (D3), al confirmar: lo que el comprobante dice de su número lo respalda la serie.
-- Mira la fila tal como queda, no la del evento (un comprobante que pasó por dos estados encola dos eventos).
CREATE FUNCTION comprobante_verificar_serie() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  c public.comprobante%ROWTYPE;
  s public.serie_comprobante%ROWTYPE;
BEGIN
  SELECT * INTO c FROM public.comprobante WHERE id = NEW.id AND empresa_id = NEW.empresa_id;
  IF NOT FOUND OR c.estado NOT IN ('EN_VALIDACION', 'INCIERTO', 'AUTORIZADO') THEN
    RETURN NULL;
  END IF;
  SELECT * INTO s FROM public.serie_comprobante
   WHERE empresa_id = c.empresa_id AND punto_de_venta_id = c.punto_de_venta_id
     AND tipo_comprobante = c.tipo_comprobante AND ambiente = c.ambiente;
  IF c.estado IN ('EN_VALIDACION', 'INCIERTO') THEN
    IF NOT FOUND OR s.estado <> 'EN_CURSO' OR s.solicitud_en_curso IS DISTINCT FROM c.id
       OR s.numero_en_curso IS DISTINCT FROM c.numero_reservado THEN
      RAISE EXCEPTION 'un comprobante en validación tiene que tener su número reservado en la serie'
        USING ERRCODE = '23514', CONSTRAINT = 'comprobante_sin_reserva';
    END IF;
  ELSIF NOT FOUND OR s.ultimo_numero < c.numero
        OR (s.estado = 'EN_CURSO' AND s.solicitud_en_curso IS NOT DISTINCT FROM c.id) THEN
    RAISE EXCEPTION 'un comprobante autorizado tiene que haber avanzado la serie y cerrado su reserva'
      USING ERRCODE = '23514', CONSTRAINT = 'comprobante_sin_reserva';
  END IF;
  RETURN NULL;
END
$$;

-- La otra mitad de D3, sobre la serie: no deja de tener su reserva mientras un comprobante en vuelo la usa.
CREATE FUNCTION comprobante_serie_con_reserva() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  s public.serie_comprobante%ROWTYPE;
BEGIN
  SELECT * INTO s FROM public.serie_comprobante
   WHERE empresa_id = NEW.empresa_id AND punto_de_venta_id = NEW.punto_de_venta_id
     AND tipo_comprobante = NEW.tipo_comprobante AND ambiente = NEW.ambiente;
  IF FOUND AND EXISTS (
    SELECT 1 FROM public.comprobante c
     WHERE c.empresa_id = s.empresa_id AND c.punto_de_venta_id = s.punto_de_venta_id
       AND c.tipo_comprobante = s.tipo_comprobante AND c.ambiente = s.ambiente
       AND c.estado IN ('EN_VALIDACION', 'INCIERTO')
       AND (s.estado <> 'EN_CURSO' OR s.solicitud_en_curso IS DISTINCT FROM c.id
            OR s.numero_en_curso IS DISTINCT FROM c.numero_reservado)
  ) THEN
    RAISE EXCEPTION 'la serie tiene un comprobante en validación: no puede soltar su reserva sin resolverlo'
      USING ERRCODE = '23514', CONSTRAINT = 'comprobante_serie_sin_reserva';
  END IF;
  RETURN NULL;
END
$$;

-- El comprobante cuadra (D4), al confirmar: renglones, desglose y columnas suman lo mismo. Mira el estado final.
CREATE FUNCTION comprobante_verificar_cuadre() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  c public.comprobante%ROWTYPE;
  v_renglones integer;
  v_ultima integer;
  v_suma numeric;
  v_con_alicuota integer;
  v_filas integer;
  v_total numeric;
  v_neto numeric;
  v_iva numeric;
  v_exento numeric;
  v_no_gravado numeric;
BEGIN
  SELECT * INTO c FROM public.comprobante WHERE id = NEW.id AND empresa_id = NEW.empresa_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT count(*), coalesce(max(l.posicion), 0), coalesce(sum(l.importe), 0), count(l.alicuota)
    INTO v_renglones, v_ultima, v_suma, v_con_alicuota
    FROM public.comprobante_linea l WHERE l.empresa_id = c.empresa_id AND l.comprobante_id = c.id;
  IF v_renglones < 1 OR v_ultima <> v_renglones OR v_suma <> c.total THEN
    RAISE EXCEPTION 'los renglones del comprobante (numerados desde 1) no suman su total'
      USING ERRCODE = '23514', CONSTRAINT = 'comprobante_descuadrado';
  END IF;

  SELECT count(*), coalesce(sum(a.total), 0),
         coalesce(sum(a.neto) FILTER (WHERE a.alicuota NOT IN ('EXENTO', 'NO_GRAVADO')), 0),
         coalesce(sum(a.iva), 0),
         coalesce(sum(a.total) FILTER (WHERE a.alicuota = 'EXENTO'), 0),
         coalesce(sum(a.total) FILTER (WHERE a.alicuota = 'NO_GRAVADO'), 0)
    INTO v_filas, v_total, v_neto, v_iva, v_exento, v_no_gravado
    FROM public.comprobante_alicuota a WHERE a.empresa_id = c.empresa_id AND a.comprobante_id = c.id;

  IF right(c.tipo_comprobante, 1) = 'C' THEN
    -- La letra C no discrimina IVA: ni renglones ni desglose llevan alícuota.
    IF v_con_alicuota <> 0 OR v_filas <> 0 THEN
      RAISE EXCEPTION 'un comprobante de letra C no lleva alícuotas'
        USING ERRCODE = '23514', CONSTRAINT = 'comprobante_descuadrado';
    END IF;
  ELSE
    IF v_con_alicuota <> v_renglones OR v_filas < 1 OR v_total <> c.total OR v_neto <> c.neto_gravado
       OR v_iva <> c.iva OR v_exento <> c.exento OR v_no_gravado <> c.no_gravado THEN
      RAISE EXCEPTION 'el desglose por alícuota no suma lo informado en el comprobante'
        USING ERRCODE = '23514', CONSTRAINT = 'comprobante_descuadrado';
    END IF;
    -- Cada alícuota del desglose es exactamente la suma de los renglones de esa alícuota, y viceversa.
    IF EXISTS (
      SELECT 1
        FROM (SELECT l.alicuota, sum(l.importe) AS suma
                FROM public.comprobante_linea l
               WHERE l.empresa_id = c.empresa_id AND l.comprobante_id = c.id
               GROUP BY l.alicuota) AS por_renglon
        FULL JOIN (SELECT a.alicuota, a.total
                     FROM public.comprobante_alicuota a
                    WHERE a.empresa_id = c.empresa_id AND a.comprobante_id = c.id) AS por_desglose
               ON por_desglose.alicuota = por_renglon.alicuota
       WHERE por_renglon.suma IS DISTINCT FROM por_desglose.total
    ) THEN
      RAISE EXCEPTION 'el desglose de una alícuota no es la suma de sus renglones'
        USING ERRCODE = '23514', CONSTRAINT = 'comprobante_descuadrado';
    END IF;
  END IF;
  RETURN NULL;
END
$$;

-- Renglones y desglose nacen con el comprobante: en su misma transacción (`creado_en = now()` es el inicio
-- de la transacción) y mientras está PENDIENTE y sin envíos. Un renglón tardío cambiaría lo que se va a enviar.
CREATE FUNCTION comprobante_hijo_validar_alta() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_nace boolean;
BEGIN
  SELECT (c.estado = 'PENDIENTE' AND c.envios = 0 AND c.creado_en = now()) INTO v_nace
    FROM public.comprobante c WHERE c.id = NEW.comprobante_id AND c.empresa_id = NEW.empresa_id;
  -- Un comprobante inexistente (o de otra empresa) lo rechaza la clave foránea.
  IF FOUND AND NOT v_nace THEN
    IF TG_TABLE_NAME = 'comprobante_linea' THEN
      RAISE EXCEPTION 'los renglones se cargan al crear el comprobante, no después'
        USING ERRCODE = '23514', CONSTRAINT = 'comprobante_linea_tardia';
    END IF;
    RAISE EXCEPTION 'el desglose se carga al crear el comprobante, no después'
      USING ERRCODE = '23514', CONSTRAINT = 'comprobante_alicuota_tardia';
  END IF;
  RETURN NEW;
END
$$;

-- Certificados: el contenido no cambia; PEDIDO_GENERADO -> VIGENTE -> REEMPLAZADO y PEDIDO_GENERADO -> DESCARTADO.
CREATE FUNCTION certificado_arca_validar_alta() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF NEW.estado <> 'PEDIDO_GENERADO' THEN
    RAISE EXCEPTION 'un certificado nace como pedido generado'
      USING ERRCODE = '23514', CONSTRAINT = 'certificado_transicion_invalida';
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION certificado_arca_validar_cambio() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_movibles constant text[] := ARRAY['estado', 'certificado_pem', 'huella_sha256', 'vence_en',
                                       'autorizacion_verificada_en', 'actualizado_en', 'version'];
BEGIN
  -- La clave, el pedido, el titular y el alias no cambian nunca.
  IF (to_jsonb(NEW) - v_movibles) IS DISTINCT FROM (to_jsonb(OLD) - v_movibles) THEN
    RAISE EXCEPTION 'el pedido, la clave y la identidad de un certificado no se pueden modificar'
      USING ERRCODE = '23514', CONSTRAINT = 'certificado_inmutable';
  END IF;
  IF NEW.estado <> OLD.estado THEN
    IF NOT (
      (OLD.estado = 'PEDIDO_GENERADO' AND NEW.estado IN ('VIGENTE', 'DESCARTADO'))
      OR (OLD.estado = 'VIGENTE' AND NEW.estado = 'REEMPLAZADO')
    ) THEN
      RAISE EXCEPTION 'transición de estado no permitida: % -> %', OLD.estado, NEW.estado
        USING ERRCODE = '23514', CONSTRAINT = 'certificado_transicion_invalida';
    END IF;
  END IF;
  -- Una vez cargado, el certificado y su huella no cambian (ni siquiera al reemplazarlo).
  IF OLD.estado <> 'PEDIDO_GENERADO'
     AND (NEW.certificado_pem IS DISTINCT FROM OLD.certificado_pem
          OR NEW.huella_sha256 IS DISTINCT FROM OLD.huella_sha256
          OR NEW.vence_en IS DISTINCT FROM OLD.vence_en) THEN
    RAISE EXCEPTION 'un certificado cargado no se modifica: se carga otro'
      USING ERRCODE = '23514', CONSTRAINT = 'certificado_inmutable';
  END IF;
  -- La primera llamada exitosa se anota una vez y no se pisa.
  IF OLD.autorizacion_verificada_en IS NOT NULL
     AND NEW.autorizacion_verificada_en IS DISTINCT FROM OLD.autorizacion_verificada_en THEN
    RAISE EXCEPTION 'la verificación de un certificado se anota una sola vez'
      USING ERRCODE = '23514', CONSTRAINT = 'certificado_inmutable';
  END IF;
  RETURN NEW;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- Disparadores. Los nombres ordenan: `_cambio` valida con OLD/NEW antes de que `_version` los toque.
-- ---------------------------------------------------------------------------------------------
CREATE TRIGGER serie_comprobante_alta BEFORE INSERT ON serie_comprobante
  FOR EACH ROW EXECUTE FUNCTION serie_comprobante_validar_alta();
-- La mitad de D3 sobre la serie: solo importa cuando se suelta o se cambia una reserva.
CREATE CONSTRAINT TRIGGER serie_comprobante_con_reserva AFTER UPDATE ON serie_comprobante
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (OLD.estado = 'EN_CURSO') EXECUTE FUNCTION comprobante_serie_con_reserva();
CREATE TRIGGER punto_de_venta_ambiente BEFORE UPDATE OF ambiente ON punto_de_venta
  FOR EACH ROW EXECUTE FUNCTION punto_de_venta_validar_ambiente();

CREATE TRIGGER comprobante_alta BEFORE INSERT ON comprobante
  FOR EACH ROW EXECUTE FUNCTION comprobante_validar_alta();
CREATE TRIGGER comprobante_cambio BEFORE UPDATE ON comprobante
  FOR EACH ROW EXECUTE FUNCTION comprobante_validar_cambio();
CREATE TRIGGER comprobante_version BEFORE UPDATE ON comprobante
  FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();
CREATE TRIGGER comprobante_sin_borrado BEFORE DELETE ON comprobante
  FOR EACH ROW EXECUTE FUNCTION sin_borrado();
CREATE TRIGGER comprobante_sin_truncate BEFORE TRUNCATE ON comprobante
  FOR EACH STATEMENT EXECUTE FUNCTION sin_borrado();
CREATE CONSTRAINT TRIGGER comprobante_coherente_con_serie AFTER INSERT OR UPDATE ON comprobante
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION comprobante_verificar_serie();
CREATE CONSTRAINT TRIGGER comprobante_cuadra AFTER INSERT ON comprobante
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION comprobante_verificar_cuadre();

CREATE TRIGGER comprobante_linea_alta BEFORE INSERT ON comprobante_linea
  FOR EACH ROW EXECUTE FUNCTION comprobante_hijo_validar_alta();
CREATE TRIGGER comprobante_linea_solo_insercion BEFORE UPDATE OR DELETE ON comprobante_linea
  FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER comprobante_linea_sin_truncate BEFORE TRUNCATE ON comprobante_linea
  FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();

CREATE TRIGGER comprobante_alicuota_alta BEFORE INSERT ON comprobante_alicuota
  FOR EACH ROW EXECUTE FUNCTION comprobante_hijo_validar_alta();
CREATE TRIGGER comprobante_alicuota_solo_insercion BEFORE UPDATE OR DELETE ON comprobante_alicuota
  FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER comprobante_alicuota_sin_truncate BEFORE TRUNCATE ON comprobante_alicuota
  FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();

CREATE TRIGGER intento_arca_solo_insercion BEFORE UPDATE OR DELETE ON intento_arca
  FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER intento_arca_sin_truncate BEFORE TRUNCATE ON intento_arca
  FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();

CREATE TRIGGER certificado_arca_alta BEFORE INSERT ON certificado_arca
  FOR EACH ROW EXECUTE FUNCTION certificado_arca_validar_alta();
CREATE TRIGGER certificado_arca_cambio BEFORE UPDATE ON certificado_arca
  FOR EACH ROW EXECUTE FUNCTION certificado_arca_validar_cambio();
CREATE TRIGGER certificado_arca_version BEFORE UPDATE ON certificado_arca
  FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();
CREATE TRIGGER certificado_arca_sin_borrado BEFORE DELETE ON certificado_arca
  FOR EACH ROW EXECUTE FUNCTION sin_borrado();
CREATE TRIGGER certificado_arca_sin_truncate BEFORE TRUNCATE ON certificado_arca
  FOR EACH STATEMENT EXECUTE FUNCTION sin_borrado();

CREATE TRIGGER acceso_arca_version BEFORE UPDATE ON acceso_arca
  FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();
CREATE TRIGGER acceso_arca_sin_borrado BEFORE DELETE ON acceso_arca
  FOR EACH ROW EXECUTE FUNCTION sin_borrado();
CREATE TRIGGER acceso_arca_sin_truncate BEFORE TRUNCATE ON acceso_arca
  FOR EACH STATEMENT EXECUTE FUNCTION sin_borrado();

-- ---------------------------------------------------------------------------------------------
-- Privilegios: por columna, y nadie recibe DELETE ni TRUNCATE
-- ---------------------------------------------------------------------------------------------
REVOKE ALL ON comprobante, comprobante_linea, comprobante_alicuota, certificado_arca, acceso_arca, intento_arca
  FROM PUBLIC;

-- La función de validación la ejecuta quien escribe las columnas que valida (la aplicación).
GRANT EXECUTE ON FUNCTION texto_fiscal_valido(text, integer) TO pedernal_app;

-- app: opera dentro de su empresa. Los demás roles no reciben nada (fallan cerrados).
GRANT SELECT ON comprobante, comprobante_linea, comprobante_alicuota, certificado_arca, acceso_arca, intento_arca
  TO pedernal_app;
GRANT UPDATE (ambiente) ON punto_de_venta TO pedernal_app;
GRANT INSERT (ambiente) ON serie_comprobante TO pedernal_app;
-- El contenido nace de una vez; el estado, los envíos, el número y el CAE no se eligen al crear.
GRANT INSERT (id, empresa_id, emisor_id, punto_de_venta_id, ambiente, origen_tipo, origen_id, clase, tipo_comprobante,
              concepto, servicio_desde, servicio_hasta, vencimiento_pago, moneda, modo_de_precio,
              total, neto_gravado, iva, exento, no_gravado, datos_fiscales_id, emisor_cuit, emisor_razon_social,
              emisor_condicion_iva, emisor_domicilio_fiscal, emisor_inicio_actividades, emisor_iibb_numero,
              emisor_iibb_condicion, punto_de_venta_numero, punto_de_venta_domicilio, receptor_parte_id,
              receptor_nombre, receptor_documento_tipo, receptor_documento_numero, receptor_condicion_iva,
              receptor_domicilio, comprobante_asociado_id, motivo, huella, version_de_representacion, creado_por)
  ON comprobante TO pedernal_app;
GRANT UPDATE (estado, envios, numero_reservado, fecha_emision, numero, cae, cae_vence, autorizado_en, resuelto_por,
              motivo_descarte)
  ON comprobante TO pedernal_app;
GRANT INSERT (empresa_id, comprobante_id, posicion, descripcion, cantidad, precio_unitario, descuento, alicuota, importe)
  ON comprobante_linea TO pedernal_app;
GRANT INSERT (empresa_id, comprobante_id, alicuota, total, neto, iva) ON comprobante_alicuota TO pedernal_app;
GRANT INSERT (id, empresa_id, comprobante_id, operacion, numero, desenlace, mensajes, respuesta, huella_pedido,
              iniciado_en, duracion_ms)
  ON intento_arca TO pedernal_app;
GRANT INSERT (id, empresa_id, emisor_id, ambiente, alias, cuit_titular, pedido_pem, clave_cifrada, clave_nonce,
              clave_etiqueta, clave_kid, creado_por)
  ON certificado_arca TO pedernal_app;
GRANT UPDATE (estado, certificado_pem, huella_sha256, vence_en, autorizacion_verificada_en)
  ON certificado_arca TO pedernal_app;
GRANT INSERT (empresa_id, certificado_id, servicio) ON acceso_arca TO pedernal_app;
GRANT UPDATE (credencial_cifrada, credencial_nonce, credencial_etiqueta, credencial_kid, generado_en, expira_en,
              renovando_hasta)
  ON acceso_arca TO pedernal_app;

-- ---------------------------------------------------------------------------------------------
-- RLS: activa y forzada en toda tabla nueva; sin política no hay acceso
-- ---------------------------------------------------------------------------------------------
ALTER TABLE comprobante ENABLE ROW LEVEL SECURITY;
ALTER TABLE comprobante FORCE ROW LEVEL SECURITY;
ALTER TABLE comprobante_linea ENABLE ROW LEVEL SECURITY;
ALTER TABLE comprobante_linea FORCE ROW LEVEL SECURITY;
ALTER TABLE comprobante_alicuota ENABLE ROW LEVEL SECURITY;
ALTER TABLE comprobante_alicuota FORCE ROW LEVEL SECURITY;
ALTER TABLE certificado_arca ENABLE ROW LEVEL SECURITY;
ALTER TABLE certificado_arca FORCE ROW LEVEL SECURITY;
ALTER TABLE acceso_arca ENABLE ROW LEVEL SECURITY;
ALTER TABLE acceso_arca FORCE ROW LEVEL SECURITY;
ALTER TABLE intento_arca ENABLE ROW LEVEL SECURITY;
ALTER TABLE intento_arca FORCE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------------------------
-- Políticas. La aplicación siempre con `empresa_id = (SELECT app_empresa_id())` y, en altas y cambios,
-- `empresa_operable(empresa_id)`; los autores con `IS NOT DISTINCT FROM` la persona del contexto (el trabajo
-- de sistema escribe estados e intentos, no autores). Sin `FOR ALL`: cada comando tiene su política.
-- ---------------------------------------------------------------------------------------------
CREATE POLICY comprobante_app_leer ON comprobante FOR SELECT TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY comprobante_app_alta ON comprobante FOR INSERT TO pedernal_app
  WITH CHECK (
    empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id)
    AND creado_por IS NOT DISTINCT FROM (SELECT app_persona_id())
  );
CREATE POLICY comprobante_app_cambiar ON comprobante FOR UPDATE TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id))
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));

CREATE POLICY comprobante_linea_app_leer ON comprobante_linea FOR SELECT TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY comprobante_linea_app_alta ON comprobante_linea FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));

CREATE POLICY comprobante_alicuota_app_leer ON comprobante_alicuota FOR SELECT TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY comprobante_alicuota_app_alta ON comprobante_alicuota FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));

CREATE POLICY intento_arca_app_leer ON intento_arca FOR SELECT TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY intento_arca_app_alta ON intento_arca FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));

CREATE POLICY certificado_arca_app_leer ON certificado_arca FOR SELECT TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY certificado_arca_app_alta ON certificado_arca FOR INSERT TO pedernal_app
  WITH CHECK (
    empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id)
    AND creado_por IS NOT DISTINCT FROM (SELECT app_persona_id())
  );
CREATE POLICY certificado_arca_app_cambiar ON certificado_arca FOR UPDATE TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id))
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));

CREATE POLICY acceso_arca_app_leer ON acceso_arca FOR SELECT TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY acceso_arca_app_alta ON acceso_arca FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));
CREATE POLICY acceso_arca_app_cambiar ON acceso_arca FOR UPDATE TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id))
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));
