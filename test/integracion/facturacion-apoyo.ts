import { createHash, randomUUID } from "node:crypto";
import type pg from "pg";
import { crearDomicilio, crearMundo, crearPuntoDeVenta, intentoDelDueno, type Mundo } from "./fiscal-apoyo";
import type { Intento, SesionDePrueba } from "./sesiones";

/**
 * Apoyo de las pruebas de la migración 0009 (facturación). Todo el armado del escenario se hace con el
 * cliente del DUEÑO de la base (evade RLS); lo que se prueba después se hace con los roles limitados o,
 * para lo que la base impone aun al dueño, con el mismo cliente.
 *
 * Las funciones de «trabajo» (`reservar`, `autorizar`...) hacen en SQL lo que harán los casos de uso de F4 y
 * F5: son la prueba de que la base deja hacer el camino feliz y los de falla que el spec describe.
 */

/** Cómo se manda una sentencia: dentro de un savepoint (el dueño o una sesión), devolviendo el resultado. */
export type Ejecutor = (texto: string, parametros?: unknown[]) => Promise<Intento>;

export const viaDueno =
  (c: pg.Client): Ejecutor =>
  (texto, parametros = []) =>
    intentoDelDueno(c, texto, parametros);
export const viaSesion =
  (s: SesionDePrueba): Ejecutor =>
  (texto, parametros = []) =>
    s.intentar(texto, parametros);

/** Una sentencia del dueño FUERA de una transacción (confirma sola): sin savepoint, que no existe afuera. */
export const viaDuenoDirecto =
  (c: pg.Client): Ejecutor =>
  async (texto, parametros = []) => {
    try {
      const r = await c.query(texto, parametros);
      return { ok: true, filas: r.rowCount ?? 0, rows: r.rows as Record<string, unknown>[] };
    } catch (error) {
      const e = error as { code?: string; constraint?: string; message?: string };
      return { ok: false, codigo: e.code ?? "?", restriccion: e.constraint, mensaje: e.message ?? "" };
    }
  };

/** Confirma la transacción del dueño: el resultado trae el error de una restricción diferida. */
export async function confirmarDueno(c: pg.Client): Promise<Intento> {
  try {
    await c.query("commit");
    return { ok: true, filas: 0, rows: [] };
  } catch (error) {
    await c.query("rollback").catch(() => undefined);
    const e = error as { code?: string; constraint?: string; message?: string };
    return { ok: false, codigo: e.code ?? "?", restriccion: e.constraint, mensaje: e.message ?? "" };
  }
}

export type CondicionDelEmisor = "RESPONSABLE_INSCRIPTO" | "MONOTRIBUTO" | "EXENTO";

/** Una empresa con su emisor principal, datos fiscales CONFIRMADOS y un punto de venta ACTIVO. */
export type Escenario = Mundo &
  Readonly<{
    domicilio: string;
    datosFiscales: string;
    pv: string;
    pvNumero: number;
    razonSocial: string;
    condicionIva: CondicionDelEmisor;
  }>;

export async function crearEscenario(
  c: pg.Client,
  opciones: {
    mundo?: Mundo;
    condicionIva?: CondicionDelEmisor;
    pvNumero?: number;
    razonSocial?: string;
  } = {},
): Promise<Escenario> {
  const m = opciones.mundo ?? (await crearMundo(c));
  const razonSocial = opciones.razonSocial ?? "Panadería Zulú SA";
  const condicionIva = opciones.condicionIva ?? "RESPONSABLE_INSCRIPTO";
  const domicilio = await crearDomicilio(c, m.empresa);
  const datosFiscales = randomUUID();
  await c.query(
    `insert into datos_fiscales (id, empresa_id, emisor_id, razon_social, condicion_iva, domicilio_fiscal_id,
                                 inicio_actividades, iibb_numero, iibb_condicion, creado_por)
     values ($1, $2, $3, $4, $5, $6, '2020-01-01', '901-123456-7', 'LOCAL', $7)`,
    [datosFiscales, m.empresa, m.emisor, razonSocial, condicionIva, domicilio, m.persona],
  );
  await c.query(
    `update datos_fiscales set estado = 'CONFIRMADA', numero = 1, vigente_desde = now(), confirmada_en = now(),
            confirmada_por = $2, motivo = 'alta' where id = $1`,
    [datosFiscales, m.persona],
  );
  const pvNumero = opciones.pvNumero ?? 1;
  const pv = await crearPuntoDeVenta(c, m, { numero: pvNumero, domicilio, activo: true });
  return { ...m, domicilio, datosFiscales, pv, pvNumero, razonSocial, condicionIva };
}

export type TipoDeComprobante =
  | "FACTURA_A"
  | "FACTURA_B"
  | "FACTURA_C"
  | "NOTA_DEBITO_A"
  | "NOTA_DEBITO_B"
  | "NOTA_DEBITO_C"
  | "NOTA_CREDITO_A"
  | "NOTA_CREDITO_B"
  | "NOTA_CREDITO_C";

/** Las columnas que la aplicación puede mandar al crear un comprobante (las del GRANT INSERT). */
export type Contenido = Record<string, unknown>;

export type Renglon = Readonly<{
  posicion: number;
  descripcion: string;
  cantidad: string;
  precio_unitario: string;
  descuento: string | null;
  alicuota: string | null;
  importe: string;
}>;
export type Desglose = Readonly<{ alicuota: string; total: string; neto: string; iva: string }>;

const CLASE_DEL_TIPO = (tipo: string): string => tipo.replace(/_[ABC]$/, "");

/** Los 64 hexadecimales de una huella cualquiera. */
export const huellaAlAzar = (): string =>
  createHash("sha256").update(randomUUID()).digest("hex");

/**
 * Un comprobante completo y coherente (letra B por defecto: una factura de $121,00 con IVA del 21 %
 * incluido, a un consumidor final sin identificar). `cambios` pisa columnas; no valida nada: la base sí.
 */
export function datosDeComprobante(e: Escenario, cambios: Contenido = {}): Contenido {
  const tipo = (cambios["tipo_comprobante"] as string | undefined) ?? "FACTURA_B";
  return {
    id: randomUUID(),
    empresa_id: e.empresa,
    emisor_id: e.emisor,
    punto_de_venta_id: e.pv,
    ambiente: "HOMOLOGACION",
    origen_tipo: "MANUAL",
    origen_id: randomUUID(),
    clase: CLASE_DEL_TIPO(tipo),
    tipo_comprobante: tipo,
    concepto: "PRODUCTOS",
    servicio_desde: null,
    servicio_hasta: null,
    vencimiento_pago: null,
    moneda: "ARS",
    modo_de_precio: "IVA_INCLUIDO",
    total: "121.00",
    neto_gravado: "100.00",
    iva: "21.00",
    exento: "0.00",
    no_gravado: "0.00",
    datos_fiscales_id: e.datosFiscales,
    emisor_cuit: e.cuit,
    emisor_razon_social: e.razonSocial,
    emisor_condicion_iva: e.condicionIva,
    emisor_domicilio_fiscal: "Av. Corrientes 1234, Rosario, Santa Fe",
    emisor_inicio_actividades: "2020-01-01",
    emisor_iibb_numero: "901-123456-7",
    emisor_iibb_condicion: "LOCAL",
    punto_de_venta_numero: e.pvNumero,
    punto_de_venta_domicilio: "Av. Corrientes 1234, Rosario, Santa Fe",
    receptor_parte_id: null,
    receptor_nombre: null,
    receptor_documento_tipo: "SIN_IDENTIFICAR",
    receptor_documento_numero: null,
    receptor_condicion_iva: "CONSUMIDOR_FINAL",
    receptor_domicilio: null,
    comprobante_asociado_id: null,
    motivo: null,
    huella: huellaAlAzar(),
    version_de_representacion: 1,
    creado_por: e.persona,
    ...cambios,
  };
}

/** Un renglón con alícuota y su desglose, coherentes con `datosDeComprobante` (121,00 con 21 %). */
export const RENGLON_DE_121: Renglon = {
  posicion: 1,
  descripcion: "Medialunas x12",
  cantidad: "1.0000",
  precio_unitario: "121.000000",
  descuento: null,
  alicuota: "21",
  importe: "121.00",
};
export const DESGLOSE_DE_121: Desglose = { alicuota: "21", total: "121.00", neto: "100.00", iva: "21.00" };

/** Un comprobante de letra C de $100,00: sin alícuota en los renglones ni desglose. */
export function datosDeLetraC(e: Escenario, cambios: Contenido = {}): Contenido {
  return datosDeComprobante(e, {
    tipo_comprobante: "FACTURA_C",
    total: "100.00",
    neto_gravado: "100.00",
    iva: "0.00",
    ...cambios,
  });
}
export const RENGLON_DE_100_SIN_ALICUOTA: Renglon = {
  posicion: 1,
  descripcion: "Café y tostado",
  cantidad: "2.0000",
  precio_unitario: "50.000000",
  descuento: null,
  alicuota: null,
  importe: "100.00",
};

async function insertar(ej: Ejecutor, tabla: string, fila: Record<string, unknown>): Promise<Intento> {
  const columnas = Object.keys(fila);
  return ej(
    `insert into ${tabla} (${columnas.join(", ")}) values (${columnas.map((_, i) => `$${i + 1}`).join(", ")})`,
    columnas.map((c) => fila[c]),
  );
}

/**
 * Inserta el comprobante, sus renglones y su desglose (en ese orden, en la transacción de quien llama).
 * Devuelve el primer intento que falle, o el del comprobante si todo salió bien. Las restricciones
 * diferidas (`comprobante_cuadra`, `comprobante_coherente_con_serie`) saltan al confirmar, no acá.
 */
export async function insertarComprobante(
  ej: Ejecutor,
  datos: Contenido,
  renglones: readonly Renglon[] = [RENGLON_DE_121],
  desglose: readonly Desglose[] = [DESGLOSE_DE_121],
): Promise<Intento> {
  const comprobante = await insertar(ej, "comprobante", datos);
  if (!comprobante.ok) return comprobante;
  for (const r of renglones) {
    const linea = await insertar(ej, "comprobante_linea", {
      empresa_id: datos["empresa_id"],
      comprobante_id: datos["id"],
      ...r,
    });
    if (!linea.ok) return linea;
  }
  for (const d of desglose) {
    const alicuota = await insertar(ej, "comprobante_alicuota", {
      empresa_id: datos["empresa_id"],
      comprobante_id: datos["id"],
      ...d,
    });
    if (!alicuota.ok) return alicuota;
  }
  return comprobante;
}

/** Un comprobante PENDIENTE completo, creado por el dueño (que evade RLS): lo deja listo y confirmado en su transacción. */
export async function crearComprobante(
  c: pg.Client,
  e: Escenario,
  cambios: Contenido = {},
  renglones?: readonly Renglon[],
  desglose?: readonly Desglose[],
): Promise<string> {
  const datos = datosDeComprobante(e, cambios);
  await c.query("begin");
  const r = await insertarComprobante(viaDueno(c), datos, renglones, desglose);
  if (!r.ok) {
    await c.query("rollback");
    throw new Error(`no se pudo crear el comprobante de prueba: ${r.codigo} ${r.restriccion ?? ""} ${r.mensaje}`);
  }
  const confirmado = await confirmarDueno(c);
  if (!confirmado.ok) {
    throw new Error(`no se pudo confirmar el comprobante: ${confirmado.restriccion ?? ""} ${confirmado.mensaje}`);
  }
  return datos["id"] as string;
}

// ---- el camino del trabajo de validación, en SQL ------------------------------------------------

export type DatosDeSerie = Readonly<{
  empresa: string;
  pv: string;
  emisor: string;
  tipo: string;
  ambiente: "HOMOLOGACION" | "PRODUCCION";
}>;

export const serieDe = (
  e: Escenario,
  tipo = "FACTURA_B",
  ambiente: "HOMOLOGACION" | "PRODUCCION" = "HOMOLOGACION",
): DatosDeSerie => ({ empresa: e.empresa, pv: e.pv, emisor: e.emisor, tipo, ambiente });

/** Crea la serie si no existe (con el último número de ARCA que se le dé). */
export function asegurarSerie(ej: Ejecutor, s: DatosDeSerie, ultimo = 0): Promise<Intento> {
  return ej(
    `insert into serie_comprobante (empresa_id, punto_de_venta_id, emisor_id, tipo_comprobante, ultimo_numero, ambiente)
     values ($1, $2, $3, $4, $5, $6) on conflict do nothing`,
    [s.empresa, s.pv, s.emisor, s.tipo, ultimo, s.ambiente],
  );
}

/** LIBRE -> EN_CURSO con la solicitud del comprobante. 0 filas: la serie está ocupada. */
export function reservarSerie(ej: Ejecutor, s: DatosDeSerie, solicitud: string): Promise<Intento> {
  return ej(
    `update serie_comprobante set estado = 'EN_CURSO', numero_en_curso = ultimo_numero + 1,
            solicitud_en_curso = $5, en_curso_hasta = now() + interval '5 minutes'
      where empresa_id = $1 and punto_de_venta_id = $2 and tipo_comprobante = $3 and ambiente = $4 and estado = 'LIBRE'
      returning numero_en_curso::text as numero`,
    [s.empresa, s.pv, s.tipo, s.ambiente, solicitud],
  );
}

/** PENDIENTE -> EN_VALIDACION con el número que reservó la serie. */
export function entrarEnValidacion(ej: Ejecutor, id: string, numero: string): Promise<Intento> {
  return ej(
    `update comprobante set estado = 'EN_VALIDACION', envios = envios + 1, numero_reservado = $2,
            fecha_emision = current_date where id = $1`,
    [id, numero],
  );
}

/** La serie vuelve a LIBRE; con `avanza`, el último número pasa a ser el reservado. */
export function cerrarSerie(ej: Ejecutor, s: DatosDeSerie, avanza: boolean): Promise<Intento> {
  return ej(
    `update serie_comprobante set estado = 'LIBRE',
            ultimo_numero = case when $5 then numero_en_curso else ultimo_numero end,
            numero_en_curso = null, solicitud_en_curso = null, en_curso_hasta = null
      where empresa_id = $1 and punto_de_venta_id = $2 and tipo_comprobante = $3 and ambiente = $4`,
    [s.empresa, s.pv, s.tipo, s.ambiente, avanza],
  );
}

/** EN_VALIDACION o INCIERTO -> AUTORIZADO. */
export function marcarAutorizado(
  ej: Ejecutor,
  id: string,
  por: "RESPUESTA" | "RECONCILIACION" = "RESPUESTA",
): Promise<Intento> {
  return ej(
    `update comprobante set estado = 'AUTORIZADO', numero = numero_reservado,
            cae = lpad((floor(random() * 99999999999999) + 1)::bigint::text, 14, '1'),
            cae_vence = fecha_emision + 10, autorizado_en = now(), resuelto_por = $2
      where id = $1`,
    [id, por],
  );
}

/** Una transición que no mueve otra cosa que el estado (RECHAZADO, INCIERTO, CONFLICTO). */
export function marcarEstado(ej: Ejecutor, id: string, estado: string): Promise<Intento> {
  return ej("update comprobante set estado = $2 where id = $1", [id, estado]);
}

/** EN_VALIDACION, INCIERTO o CONFLICTO -> PENDIENTE: se vacían el número y la fecha. */
export function volverAPendiente(ej: Ejecutor, id: string): Promise<Intento> {
  return ej(
    `update comprobante set estado = 'PENDIENTE', numero_reservado = null, fecha_emision = null where id = $1`,
    [id],
  );
}

export async function leerComprobante(
  c: pg.Client,
  id: string,
): Promise<Record<string, unknown> | undefined> {
  return (await c.query("select * from comprobante where id = $1", [id])).rows[0] as
    | Record<string, unknown>
    | undefined;
}

export async function leerSerie(
  c: pg.Client,
  s: DatosDeSerie,
): Promise<{ estado: string; ultimo: string; en_curso: string | null; solicitud: string | null } | undefined> {
  return (
    await c.query(
      `select estado, ultimo_numero::text as ultimo, numero_en_curso::text as en_curso, solicitud_en_curso as solicitud
         from serie_comprobante
        where empresa_id = $1 and punto_de_venta_id = $2 and tipo_comprobante = $3 and ambiente = $4`,
      [s.empresa, s.pv, s.tipo, s.ambiente],
    )
  ).rows[0];
}

export { CLASE_DEL_TIPO };
