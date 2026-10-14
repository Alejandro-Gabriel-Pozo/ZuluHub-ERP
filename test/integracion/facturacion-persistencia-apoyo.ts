import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import {
  crearAuditoriaDePostgres,
  type AuditoriaDb,
} from "../../src/adaptadores/postgres/auditoria";
import {
  crearTransacciones,
  type SinTablas,
  type TransaccionesDePostgres,
} from "../../src/adaptadores/postgres/transacciones";
import {
  cerrarSerie,
  certificadoId,
  comprobanteId,
  crearRepositorioDeAccesos,
  crearRepositorioDeCertificados,
  crearRepositorioDeComprobantes,
  crearRepositorioDeIntentos,
  crearRepositorioDePuntosDeVenta,
  crearRepositorioDeSeries,
  emisorId,
  iniciarSerie,
  intentoId,
  origenId,
  puntoDeVentaId,
  reservarNumero,
  solicitudId,
  versionId,
  type AltaDeComprobante,
  type Ambiente,
  type CargaDeCertificado,
  type ComprobanteGuardado,
  type ComprobanteId,
  type FiscalDb,
  type IntentoDeArca,
  type PedidoDeCertificado,
  type RepositorioDeAccesos,
  type RepositorioDeCertificados,
  type RepositorioDeComprobantes,
  type RepositorioDeIntentos,
  type RepositorioDePuntosDeVenta,
  type RepositorioDeSeries,
} from "../../src/modulos/fiscal/publico";
import type { OrigenDeComprobante } from "../../src/modulos/fiscal/dominio/comprobante-emitido";
import type {
  ComprobanteNuevo,
  EntradaDeComprobante,
  RenglonAFacturar,
} from "../../src/modulos/fiscal/dominio/comprobante-nuevo";
import { armarNotaAsociada } from "../../src/modulos/fiscal/dominio/nota-asociada";
import type { Receptor } from "../../src/modulos/fiscal/dominio/receptor";
import { VERSION_DE_REPRESENTACION_ACTUAL } from "../../src/modulos/fiscal/dominio/modelo-de-impresion";
import type { Auditoria } from "../../src/puertos/auditoria";
import type { Cuit } from "../../src/primitivas/identificacion-fiscal/cuit";
import { empresaId, personaId } from "../../src/primitivas/identificadores/marca";
import { fechaCivilDesdeTexto, type FechaCivil } from "../../src/primitivas/tiempo/fecha-civil";
import {
  consumidorFinal,
  contextoDeEmision,
  emisorInstantaneo,
  facturaArmada,
  renglon,
} from "../utilidades/facturacion";
import { comoEmpresa } from "./entorno";
import type { Escenario } from "./facturacion-apoyo";
import type { BaseDePruebas } from "./global";

/**
 * Apoyo de las pruebas de la persistencia de la facturación (F3). Lo que recibe un trabajo de prueba es lo
 * que armaría la composición real: los repositorios sobre `db.withTables<FiscalDb>()`, la auditoría (que
 * escribe en la MISMA transacción) y el `db` crudo para consultas de verificación y fallas forzadas.
 */
export type TxFacturacionDePrueba = Readonly<{
  db: Kysely<SinTablas>;
  comprobantes: RepositorioDeComprobantes;
  intentos: RepositorioDeIntentos;
  certificados: RepositorioDeCertificados;
  accesos: RepositorioDeAccesos;
  series: RepositorioDeSeries;
  puntosDeVenta: RepositorioDePuntosDeVenta;
  auditoria: Auditoria;
}>;

export function crearEntornoFacturacion(
  base: BaseDePruebas,
  maximoDeConexiones = 5,
  ajustar: (tx: TxFacturacionDePrueba) => TxFacturacionDePrueba = (tx) => tx,
): TransaccionesDePostgres<TxFacturacionDePrueba> {
  return crearTransacciones<TxFacturacionDePrueba>({
    urls: { OPERATIVO: base.app, PLATAFORMA: base.plataforma },
    armar: (db) => {
      const fiscal = db.withTables<FiscalDb>();
      return ajustar({
        db,
        comprobantes: crearRepositorioDeComprobantes(fiscal),
        intentos: crearRepositorioDeIntentos(fiscal),
        certificados: crearRepositorioDeCertificados(fiscal),
        accesos: crearRepositorioDeAccesos(fiscal),
        series: crearRepositorioDeSeries(fiscal),
        puntosDeVenta: crearRepositorioDePuntosDeVenta(fiscal),
        auditoria: crearAuditoriaDePostgres(db.withTables<AuditoriaDb>()),
      });
    },
    maximoDeConexiones,
    clave: base.clave,
  });
}

/** Lo que firma una persona de esa empresa (la que crea comprobantes y certificados). */
export const comoPersonaDe = (e: Pick<Escenario, "empresa" | "persona">) =>
  comoEmpresa(empresaId(e.empresa), personaId(e.persona));
/** El trabajo de sistema de esa empresa: operativo, SIN persona (ADR-007). */
export const comoSistemaDe = (e: Pick<Escenario, "empresa">) =>
  comoEmpresa(empresaId(e.empresa), null);

export const fechaCivil = (texto: string): FechaCivil => {
  const r = fechaCivilDesdeTexto(texto);
  if (!r.ok) throw new Error(`fecha de prueba inválida: ${texto}`);
  return r.valor;
};

/** El día civil (UTC) de un instante: las pruebas fijan `ahora` y de ahí sale la fecha del comprobante. */
export const diaDe = (instante: Date): FechaCivil =>
  fechaCivil(instante.toISOString().slice(0, 10));

const sha256 = (texto: string): string => createHash("sha256").update(texto).digest("hex");
export const huellaNueva = (): string => sha256(randomUUID());

// ---- comprobantes ---------------------------------------------------------------------------------------

export type OpcionesDeAlta = Readonly<{
  id?: ComprobanteId;
  origen?: OrigenDeComprobante;
  receptor?: Receptor;
  renglones?: readonly RenglonAFacturar[];
  entrada?: Partial<EntradaDeComprobante>;
  huella?: string;
  ambiente?: Ambiente;
}>;

/** El contexto de emisión que corresponde a un escenario real (su emisor, su punto de venta, sus datos). */
function contextoDelEscenario(e: Escenario, o: Pick<OpcionesDeAlta, "origen" | "ambiente"> = {}) {
  return contextoDeEmision({
    empresaId: empresaId(e.empresa),
    emisorId: emisorId(e.emisor),
    puntoDeVentaId: puntoDeVentaId(e.pv),
    ambiente: o.ambiente ?? "HOMOLOGACION",
    origen: o.origen ?? { tipo: "MANUAL", id: origenId(randomUUID()) },
    emisor: emisorInstantaneo({
      cuit: e.cuit as Cuit,
      razonSocial: e.razonSocial,
      condicionIva: e.condicionIva,
      puntoDeVentaNumero: e.pvNumero,
    }),
  });
}

/** Los datos fiscales confirmados del escenario, tal como los crea `crearEscenario`. */
const datosFiscalesDelEscenario = (e: Escenario) => ({
  id: versionId(e.datosFiscales),
  inicioDeActividades: fechaCivil("2020-01-01"),
  iibbNumero: "901-123456-7",
  iibbCondicion: "LOCAL" as const,
});

function contenidoDe(e: Escenario, o: OpcionesDeAlta = {}): ComprobanteNuevo {
  return facturaArmada(
    o.receptor ?? consumidorFinal,
    o.renglones ?? [renglon("121.00", "1", e.condicionIva === "MONOTRIBUTO" ? null : "21")],
    o.entrada ?? {},
    contextoDelEscenario(e, o),
  );
}

/** El alta de una factura de prueba con todo lo que pide el repositorio. */
export function altaDe(e: Escenario, o: OpcionesDeAlta = {}): AltaDeComprobante {
  return {
    id: o.id ?? comprobanteId(randomUUID()),
    contenido: contenidoDe(e, o),
    datosFiscales: datosFiscalesDelEscenario(e),
    asociadoId: null,
    huella: o.huella ?? huellaNueva(),
    versionDeRepresentacion: VERSION_DE_REPRESENTACION_ACTUAL,
    creadoPor: personaId(e.persona),
  };
}

/** El alta de una nota (crédito o débito) sobre un comprobante `AUTORIZADO` leído del repositorio. */
export function altaDeNota(
  e: Escenario,
  asociado: ComprobanteGuardado,
  o: {
    clase?: "NOTA_CREDITO" | "NOTA_DEBITO";
    renglones?: readonly RenglonAFacturar[];
    motivo?: string | null;
    origen?: OrigenDeComprobante;
    id?: ComprobanteId;
    huella?: string;
  } = {},
): AltaDeComprobante {
  if (
    asociado.estado !== "AUTORIZADO" ||
    asociado.numero === null ||
    asociado.fechaEmision === null
  ) {
    throw new Error("la nota de prueba necesita un asociado AUTORIZADO");
  }
  const contexto = contextoDelEscenario(e, {
    ambiente: asociado.ambiente,
    ...(o.origen === undefined ? {} : { origen: o.origen }),
  });
  const r = armarNotaAsociada(
    {
      empresaId: asociado.empresaId,
      emisorId: asociado.emisorId,
      ambiente: asociado.ambiente,
      tipo: asociado.tipo,
      emisor: contexto.emisor,
      receptor: asociado.receptor,
      estado: "AUTORIZADO",
      numero: asociado.numero,
      fechaEmision: asociado.fechaEmision,
    },
    {
      clase: o.clase ?? "NOTA_CREDITO",
      motivo: o.motivo === undefined ? "Devolución" : o.motivo,
      modoDePrecio: "IVA_INCLUIDO",
      concepto: "PRODUCTOS",
      servicio: null,
      renglones: o.renglones ?? [
        renglon("121.00", "1", asociado.tipo.endsWith("_C") ? null : "21"),
      ],
    },
    contexto,
  );
  if (!r.ok) throw new Error(`nota de prueba inválida: ${JSON.stringify(r.error)}`);
  return {
    id: o.id ?? comprobanteId(randomUUID()),
    contenido: r.valor,
    datosFiscales: datosFiscalesDelEscenario(e),
    asociadoId: asociado.id,
    huella: o.huella ?? huellaNueva(),
    versionDeRepresentacion: VERSION_DE_REPRESENTACION_ACTUAL,
    creadoPor: personaId(e.persona),
  };
}

export const CAE_DE_PRUEBA = "74123456789012";

/**
 * Lo que hará el trabajo de validación, en un solo paso y en la transacción de quien llama: crea la serie si
 * hace falta, reserva el número (la solicitud es el comprobante) y mueve el comprobante a `EN_VALIDACION`.
 * Devuelve el comprobante `EN_VALIDACION` y el número reservado.
 */
export async function entrarEnValidacion(
  tx: TxFacturacionDePrueba,
  id: ComprobanteId,
  empresa: string,
  ahora: Date,
  ultimoDeArca = 0n,
): Promise<ComprobanteGuardado> {
  const c = await tx.comprobantes.obtener(empresaId(empresa), id);
  if (c === null) throw new Error("el comprobante de prueba no existe");
  let serie = await tx.series.obtener(c.empresaId, c.puntoDeVentaId, c.tipo, c.ambiente);
  if (serie === null) {
    const nueva = iniciarSerie(
      {
        empresaId: c.empresaId,
        puntoDeVentaId: c.puntoDeVentaId,
        emisorId: c.emisorId,
        tipo: c.tipo,
        ambiente: c.ambiente,
      },
      ultimoDeArca,
    );
    if (!nueva.ok) throw new Error("serie de prueba inválida");
    serie = (await tx.series.crear(nueva.valor)).valor;
  }
  const reserva = reservarNumero(serie, solicitudId(c.id), ahora);
  if (!reserva.ok || reserva.valor.tipo !== "RESERVADA") throw new Error("no se pudo reservar");
  const enCurso = await tx.series.guardar(reserva.valor.serie);
  if (enCurso === null) throw new Error("la serie cambió");
  const movido = await tx.comprobantes.transicionar(c.empresaId, c.id, c.version, {
    a: "EN_VALIDACION",
    numeroReservado: reserva.valor.numero,
    fechaEmision: diaDe(ahora),
  });
  if (movido === null) throw new Error("el comprobante cambió");
  return movido;
}

/** Cierra la serie de un comprobante `EN_VALIDACION` con ese desenlace (la serie vuelve a `LIBRE`). */
export async function cerrarLaSerie(
  tx: TxFacturacionDePrueba,
  c: ComprobanteGuardado,
  desenlace: "AUTORIZADO" | "RECHAZADO",
): Promise<void> {
  const serie = await tx.series.obtener(c.empresaId, c.puntoDeVentaId, c.tipo, c.ambiente);
  if (serie === null) throw new Error("falta la serie");
  const cierre = cerrarSerie(serie, solicitudId(c.id), desenlace);
  if (!cierre.ok) throw new Error(`no se pudo cerrar la serie: ${cierre.error}`);
  const guardada = await tx.series.guardar({ ...cierre.valor.serie, ambiente: c.ambiente });
  if (guardada === null) throw new Error("la serie cambió");
}

/** Lleva un comprobante `PENDIENTE` hasta `AUTORIZADO`, por el camino legal, en la transacción de quien llama. */
export async function autorizar(
  tx: TxFacturacionDePrueba,
  id: ComprobanteId,
  empresa: string,
  ahora: Date,
  ultimoDeArca = 0n,
): Promise<ComprobanteGuardado> {
  const enValidacion = await entrarEnValidacion(tx, id, empresa, ahora, ultimoDeArca);
  await cerrarLaSerie(tx, enValidacion, "AUTORIZADO");
  const autorizado = await tx.comprobantes.transicionar(
    enValidacion.empresaId,
    enValidacion.id,
    enValidacion.version,
    {
      a: "AUTORIZADO",
      cae: CAE_DE_PRUEBA,
      caeVence: diaDe(new Date(ahora.getTime() + 10 * 86_400_000)),
      autorizadoEn: ahora,
      resueltoPor: "RESPUESTA",
    },
  );
  if (autorizado === null) throw new Error("el comprobante cambió");
  return autorizado;
}

// ---- intentos y certificados ------------------------------------------------------------------------------------

export function intentoDe(
  e: Pick<Escenario, "empresa">,
  comprobante: ComprobanteId,
  cambios: Partial<IntentoDeArca> = {},
): IntentoDeArca {
  return {
    id: intentoId(randomUUID()),
    empresaId: empresaId(e.empresa),
    comprobanteId: comprobante,
    operacion: "AUTORIZAR",
    numero: 1n,
    desenlace: "AUTORIZADO",
    mensajes: [
      { clase: "OBSERVACION", codigo: 10237, texto: "Importe de la nota mayor al de la factura" },
    ],
    respuesta: "<FECAESolicitarResponse><Resultado>A</Resultado></FECAESolicitarResponse>",
    huellaDelPedido: huellaNueva(),
    iniciadoEn: new Date("2026-10-12T12:00:00.000Z"),
    duracionEnMs: 412,
    ...cambios,
  };
}

const PEDIDO_PEM =
  "-----BEGIN CERTIFICATE REQUEST-----\nMIIBVjCBwAIBADAeMRwwGgYDVQQDDBN6dWx1aHViLXRlc3Q=\n-----END CERTIFICATE REQUEST-----\n";

/** Una clave «cifrada» cualquiera con la forma que pide la base (nonce de 12, etiqueta de 16). */
const claveCifradaAlAzar = () => ({
  cifrado: randomBytes(64),
  nonce: randomBytes(12),
  etiqueta: randomBytes(16),
  kid: "k1",
});

export function pedidoDe(
  e: Escenario,
  cambios: Partial<PedidoDeCertificado> = {},
): PedidoDeCertificado {
  return {
    id: certificadoId(randomUUID()),
    empresaId: empresaId(e.empresa),
    emisorId: emisorId(e.emisor),
    ambiente: "HOMOLOGACION",
    alias: `zuluhub${randomBytes(4).toString("hex")}`,
    cuitTitular: e.cuit as Cuit,
    pedidoPem: PEDIDO_PEM,
    clave: claveCifradaAlAzar(),
    creadoPor: personaId(e.persona),
    ...cambios,
  };
}

export function cargaDe(cambios: Partial<CargaDeCertificado> = {}): CargaDeCertificado {
  return {
    certificadoPem: `-----BEGIN CERTIFICATE-----\n${randomBytes(24).toString("base64")}\n-----END CERTIFICATE-----\n`,
    huellaSha256: huellaNueva(),
    venceEn: new Date("2027-10-12T12:00:00.000Z"),
    ...cambios,
  };
}
