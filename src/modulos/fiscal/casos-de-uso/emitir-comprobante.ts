import type { ClaveAccion } from "../../../capacidades/modulos/catalogo";
import type { ErrorDeAlcance } from "../../../capacidades/permisos/alcance";
import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { EmpresaNoOpera } from "../../../contexto/estados";
import { cantidadATexto } from "../../../primitivas/cantidad/cantidad";
import { porcentajeATexto } from "../../../primitivas/cantidad/porcentaje";
import { importeATexto } from "../../../primitivas/dinero/importe";
import { precioUnitarioATexto } from "../../../primitivas/dinero/precio-unitario";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { fechaCivilDesdeTexto } from "../../../primitivas/tiempo/fecha-civil";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import type { ModoDePrecio } from "../dominio/calculo-de-renglones";
import type { TipoDeComprobante } from "../dominio/comprobante-emitido";
import {
  armarComprobanteNuevo,
  type Concepto,
  type ContextoDeEmision,
  type ComprobanteNuevo,
  type ErrorDeComprobanteNuevo,
  type PeriodoDeServicio,
  type RenglonAFacturar,
} from "../dominio/comprobante-nuevo";
import type { EstadoDeComprobanteArca } from "../dominio/estados-de-comprobante";
import {
  comprobanteId,
  origenId,
  type ComprobanteId,
  type PuntoDeVentaId,
} from "../dominio/identificadores";
import { VERSION_DE_REPRESENTACION_ACTUAL } from "../dominio/modelo-de-impresion";
import {
  armarNotaAsociada,
  type ComprobanteAAsociar,
  type ErrorDeNota,
} from "../dominio/nota-asociada";
import type { Receptor } from "../dominio/receptor";
import type { ErrorDeSucursalCerrada } from "../dominio/sucursales-de-la-emision";
import { versionVigente } from "../dominio/vigencia";
import type { ComprobanteGuardado } from "../persistencia/repositorio-de-comprobantes";
import { traducirErroresDeFiscal } from "../persistencia/traducir";
import { empresaOpera } from "./comun";
import {
  encolarValidacion,
  type DependenciasDeFacturacion,
  type TxDeFacturacion,
} from "./contrato-de-facturacion";
import { DECLARACIONES_DE_FACTURACION } from "./declaraciones-de-facturacion";
import { huellaDe } from "./llamadas-a-arca";
import {
  puntoDeVentaYSucursalesDelPedido,
  sucursalDelPuntoDeVentaAbierta,
} from "./sucursales-al-emitir";

/**
 * Emitir a mano (spec H7 facturación §B.4.1 y §B.4.3): una factura (`emitirComprobanteManual`), una nota de
 * crédito (`emitirNotaDeCredito`) o una de débito (`emitirNotaDeDebito`). Cada uno exige SU acción al guard
 * (§C: la NC es `notas_de_credito.emitir`; la factura y la ND, `comprobantes.emitir_manual`), y comparten el
 * cuerpo, en UNA transacción SERIALIZABLE:
 *
 *  1. Guard. 2. La empresa opera. 3. Repetición: un comprobante con origen `(MANUAL, clave)` en CUALQUIER estado
 *     con la misma huella del pedido devuelve ese (`yaExistia`, sin escribir ni auditar); con otra huella,
 *     `CLAVE_REUTILIZADA`. 4. El punto de venta (activo, emisor activo), los datos fiscales VIGENTES del emisor,
 *     sus domicilios y un certificado `VIGENTE` y no vencido para (emisor, ambiente del punto de venta).
 *     5. El dominio arma el contenido (letra, receptor, cálculo). 6. Alta `PENDIENTE` con renglones y alícuotas.
 *     7. Auditoría `COMPROBANTE_CREADO` (sin nombre ni documento del receptor). 8. Encola
 *     `fiscal.validar_comprobante` (`fiscal.validar:<id>:1`).
 *
 * Las sucursales (D-41, D-50 y D-51): el alcance de la persona se mira ANTES de la repetición y que la del punto de venta esté
 * abierta DESPUÉS, junto al punto de venta activo (repetir da lo mismo aunque se cierre); la base lo impone con bloqueo (0017).
 *
 * El `id` del comprobante ES la clave de la pantalla (un uuid): una clave nunca da dos comprobantes, ni siquiera
 * después de un rechazo (corregir es otro pedido con otra clave). Dos emisiones simultáneas con la misma clave:
 * SERIALIZABLE y las únicas de la base dejan pasar una; la otra repite, la encuentra y devuelve `yaExistia`.
 *
 * Nada se pide a ARCA acá (ADR-007): lo hace el trabajo de validación después de confirmar.
 */

export type EntradaDeComprobanteManual = Readonly<{
  /** La clave de idempotencia que generó la pantalla (uuid); es también el id del comprobante. */
  clave: string;
  puntoDeVentaId: PuntoDeVentaId;
  concepto: Concepto;
  servicio: PeriodoDeServicio | null;
  modoDePrecio: ModoDePrecio;
  receptor: Receptor;
  renglones: readonly RenglonAFacturar[];
}>;

export type EntradaDeNotaManual = Readonly<{
  clave: string;
  /** El comprobante `AUTORIZADO` que la nota corrige (crédito) o aumenta (débito). */
  comprobanteAsociadoId: ComprobanteId;
  /** Por defecto (`null`), el punto de venta del asociado. */
  puntoDeVentaId: PuntoDeVentaId | null;
  concepto: Concepto;
  servicio: PeriodoDeServicio | null;
  modoDePrecio: ModoDePrecio;
  renglones: readonly RenglonAFacturar[];
  motivo: string | null;
}>;

export type SalidaDeEmitir = Readonly<{
  comprobanteId: ComprobanteId;
  estado: EstadoDeComprobanteArca;
  tipo: TipoDeComprobante;
  /** Texto decimal (ADR-006). */
  total: string;
  /** `true`: la misma clave con el mismo pedido ya lo había creado; no se escribió nada. */
  yaExistia: boolean;
}>;

export type ErrorPropioAlEmitir =
  | "CLAVE_INVALIDA"
  | "CLAVE_REUTILIZADA"
  | "PUNTO_DE_VENTA_NO_ENCONTRADO"
  | "PUNTO_DE_VENTA_INACTIVO"
  | ErrorDeSucursalCerrada
  | ErrorDeAlcance
  | "EMISOR_INACTIVO"
  | "SIN_DATOS_FISCALES_VIGENTES"
  | "SIN_CERTIFICADO_VIGENTE"
  | "COMPROBANTE_ASOCIADO_NO_ENCONTRADO"
  | "COMPROBANTE_ALTA_INVALIDA"
  | "COMPROBANTE_ASOCIADO_INVALIDO"
  | ErrorDeComprobanteNuevo
  | ErrorDeNota;

export type ErrorAlEmitir =
  ErrorPropioAlEmitir | MotivoDeRechazo | EmpresaNoOpera | ErrorDePersistencia;

/** La forma de un uuid: la clave es el id del comprobante (columna `uuid`). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Lo que se emite: una factura, o una nota sobre un asociado. */
type Pedido =
  | Readonly<{ clase: "FACTURA"; entrada: EntradaDeComprobanteManual }>
  | Readonly<{ clase: "NOTA_CREDITO" | "NOTA_DEBITO"; entrada: EntradaDeNotaManual }>;

const renglonCanonico = (r: RenglonAFacturar) => ({
  descripcion: r.descripcion,
  cantidad: cantidadATexto(r.cantidad),
  precioUnitario: precioUnitarioATexto(r.precioUnitario),
  descuento: r.descuento === null ? null : porcentajeATexto(r.descuento),
  alicuota: r.alicuota,
});

/**
 * La huella del pedido canónico (§B.4.1): SHA-256 de lo que la persona pidió (clase, punto de venta, concepto y
 * fechas, modo, receptor o asociado, renglones y motivo), con cantidades y precios como texto exacto.
 */
export function huellaDelPedido(pedido: Pedido): string {
  const { entrada } = pedido;
  const comun = {
    clase: pedido.clase,
    puntoDeVentaId: entrada.puntoDeVentaId,
    concepto: entrada.concepto,
    servicio: entrada.servicio,
    modoDePrecio: entrada.modoDePrecio,
    renglones: entrada.renglones.map(renglonCanonico),
  };
  return pedido.clase === "FACTURA"
    ? huellaDe({ ...comun, receptor: pedido.entrada.receptor })
    : huellaDe({
        ...comun,
        asociado: pedido.entrada.comprobanteAsociadoId,
        motivo: pedido.entrada.motivo,
      });
}

const salidaDe = (c: ComprobanteGuardado, yaExistia: boolean): SalidaDeEmitir => ({
  comprobanteId: c.id,
  estado: c.estado,
  tipo: c.tipo,
  total: importeATexto(c.importes.total),
  yaExistia,
});

/** Lo que la base puede rechazar al dar de alta y que es parte del contrato de emitir. */
const ADMITIDOS_AL_EMITIR = [
  "COMPROBANTE_ALTA_INVALIDA",
  "COMPROBANTE_ASOCIADO_INVALIDO",
  "COMPROBANTE_ASOCIADO_NO_ENCONTRADO",
  "PUNTO_DE_VENTA_NO_ENCONTRADO",
  "SUCURSAL_CERRADA",
] as const;

/** El cuerpo común, dentro de la transacción y DESPUÉS del guard. */
async function emitirEnTx(
  tx: TxDeFacturacion,
  contexto: ContextoOperativo &
    Readonly<{ personaId: NonNullable<ContextoOperativo["personaId"]> }>,
  pedido: Pedido,
): Promise<Resultado<SalidaDeEmitir, ErrorPropioAlEmitir | EmpresaNoOpera>> {
  const { empresaId, ahora } = contexto;
  const { entrada } = pedido;
  const opera = await empresaOpera(tx, empresaId);
  if (!opera.ok) return opera;

  // El asociado (solo las notas), el punto de venta y sus sucursales, antes de la repetición (`sucursales-al-emitir.ts`).
  const sucursales = await puntoDeVentaYSucursalesDelPedido(tx, contexto, entrada);
  if (!sucursales.ok) return sucursales;
  const { pv, asociado } = sucursales.valor;
  // 3. Repetición: la clave de la pantalla, en cualquier estado y de cualquier clase.
  const origen = { tipo: "MANUAL" as const, id: origenId(entrada.clave) };
  const huella = huellaDelPedido(pedido);
  const previos = await tx.comprobantes.delOrigen(empresaId, origen.tipo, origen.id);
  const previo = previos[0];
  if (previo !== undefined) {
    return previo.huella === huella ? ok(salidaDe(previo, true)) : err("CLAVE_REUTILIZADA");
  }

  // 4. El punto de venta (activo, de una sucursal abierta), el emisor, sus datos y su certificado.
  if (pv.estado !== "ACTIVO") return err("PUNTO_DE_VENTA_INACTIVO");
  // D-50 (la base lo vuelve a imponer, con bloqueo, al dar de alta).
  const abierta = await sucursalDelPuntoDeVentaAbierta(tx, empresaId, pv);
  if (!abierta.ok) return abierta;
  const emisor = await tx.emisores.obtener(empresaId, pv.emisorId);
  // La clave foránea compuesta garantiza que el emisor del punto de venta existe y es de la empresa.
  if (emisor === null) throw new Error(`el emisor ${pv.emisorId} del punto de venta no existe`);
  if (!emisor.activo) return err("EMISOR_INACTIVO");
  const datos = versionVigente(await tx.datosFiscales.confirmadas(empresaId, emisor.id), ahora);
  if (datos === null) return err("SIN_DATOS_FISCALES_VIGENTES");
  const domicilioFiscal = await tx.domicilios.obtener(empresaId, datos.domicilioFiscalId);
  if (domicilioFiscal === null) throw new Error("el domicilio fiscal confirmado no es visible");
  // Un punto de venta sin domicilio propio emite con el fiscal (ASUMIDO; la base pide un texto siempre).
  const domicilioDelPv =
    pv.domicilioId === null
      ? domicilioFiscal
      : await tx.domicilios.obtener(empresaId, pv.domicilioId);
  if (domicilioDelPv === null) throw new Error("el domicilio del punto de venta no es visible");
  const certificado = await tx.certificados.vigente(empresaId, emisor.id, pv.ambiente);
  if (
    certificado === null ||
    certificado.venceEn === null ||
    certificado.venceEn.getTime() <= ahora.getTime()
  ) {
    return err("SIN_CERTIFICADO_VIGENTE");
  }
  const inicio = fechaCivilDesdeTexto(datos.inicioActividades);
  if (!inicio.ok) throw new RangeError("inicio de actividades confirmado inválido");

  // 5. El dominio arma el contenido.
  const contextoDeEmision: ContextoDeEmision = {
    empresaId,
    emisorId: emisor.id,
    puntoDeVentaId: pv.id,
    ambiente: pv.ambiente,
    origen,
    emisor: {
      cuit: emisor.cuit,
      razonSocial: datos.razonSocial,
      condicionIva: datos.condicionIva,
      domicilioFiscal: domicilioFiscal.domicilio,
      puntoDeVentaNumero: pv.numero,
      domicilioDelPuntoDeVenta: domicilioDelPv.domicilio,
    },
  };
  let contenido: Resultado<ComprobanteNuevo, ErrorDeComprobanteNuevo | ErrorDeNota>;
  if (pedido.clase === "FACTURA") {
    contenido = armarComprobanteNuevo(pedido.entrada, contextoDeEmision);
  } else {
    if (asociado === null) return err("COMPROBANTE_ASOCIADO_NO_ENCONTRADO");
    const base = {
      empresaId: asociado.empresaId,
      emisorId: asociado.emisorId,
      ambiente: asociado.ambiente,
      tipo: asociado.tipo,
      emisor: {
        cuit: asociado.emisor.cuit,
        puntoDeVentaNumero: asociado.emisor.puntoDeVentaNumero,
      },
      receptor: asociado.receptor,
    };
    let aAsociar: ComprobanteAAsociar;
    if (asociado.estado === "AUTORIZADO") {
      // `comprobante_autorizado_ck`: un autorizado siempre tiene número y fecha.
      if (asociado.numero === null || asociado.fechaEmision === null) {
        throw new Error("un comprobante autorizado sin número o sin fecha");
      }
      aAsociar = {
        ...base,
        estado: "AUTORIZADO",
        numero: asociado.numero,
        fechaEmision: asociado.fechaEmision,
      };
    } else {
      aAsociar = { ...base, estado: asociado.estado };
    }
    contenido = armarNotaAsociada(
      aAsociar,
      {
        clase: pedido.clase,
        motivo: pedido.entrada.motivo,
        modoDePrecio: pedido.entrada.modoDePrecio,
        concepto: pedido.entrada.concepto,
        servicio: pedido.entrada.servicio,
        renglones: pedido.entrada.renglones,
      },
      contextoDeEmision,
    );
  }
  if (!contenido.ok) return contenido;

  // 6. Alta.
  const alta = await tx.comprobantes.crear({
    id: comprobanteId(entrada.clave),
    contenido: contenido.valor,
    datosFiscales: {
      id: datos.id,
      inicioDeActividades: inicio.valor,
      iibbNumero: datos.iibbNumero,
      iibbCondicion: datos.iibbCondicion,
    },
    asociadoId: asociado?.id ?? null,
    huella,
    versionDeRepresentacion: VERSION_DE_REPRESENTACION_ACTUAL,
    creadoPor: contexto.personaId,
  });
  // El id es la clave y no había comprobante con esa clave: otro id en uso es otro comprobante con ese uuid.
  if (!alta.ok) return err("CLAVE_REUTILIZADA");
  const creado = alta.valor.valor;
  if (!alta.valor.creado) {
    return creado.huella === huella ? ok(salidaDe(creado, true)) : err("CLAVE_REUTILIZADA");
  }

  // 7. Auditoría, sin datos de la persona receptora. 8. El trabajo de validación.
  await tx.auditoria.registrar({
    empresaId,
    actorPersonaId: contexto.personaId,
    accion: "COMPROBANTE_CREADO",
    entidad: "comprobante",
    entidadId: creado.id,
    despues: {
      clase: creado.clase,
      tipo: creado.tipo,
      total: importeATexto(creado.importes.total),
      puntoDeVenta: creado.emisor.puntoDeVentaNumero,
      ambiente: creado.ambiente,
      origen: creado.origen.tipo,
      asociado: creado.asociado?.id ?? null,
    },
  });
  await encolarValidacion(tx, empresaId, creado.id);
  return ok(salidaDe(creado, false));
}

function armarEmision<E extends EntradaDeComprobanteManual | EntradaDeNotaManual>(
  { transacciones, reglas }: DependenciasDeFacturacion,
  accion: ClaveAccion,
  pedidoDe: (entrada: E) => Pedido,
) {
  return async function emitir(
    contexto: ContextoOperativo,
    entrada: E,
  ): Promise<Resultado<SalidaDeEmitir, ErrorAlEmitir>> {
    const { personaId } = contexto;
    if (personaId === null) {
      throw new RangeError("emitir a mano exige una persona: un trabajo de sistema no emite");
    }
    const resultado = await transacciones.ejecutar(
      { contexto },
      async (
        tx,
      ): Promise<
        Resultado<SalidaDeEmitir, ErrorPropioAlEmitir | MotivoDeRechazo | EmpresaNoOpera>
      > => {
        const permiso = await exigirAccion(reglas, accion, () =>
          tx.autorizacion.delActor(contexto),
        );
        if (!permiso.ok) return permiso;
        if (!UUID.test(entrada.clave)) return err("CLAVE_INVALIDA");
        return emitirEnTx(tx, { ...contexto, personaId }, pedidoDe(entrada));
      },
    );
    return traducirErroresDeFiscal(resultado, ADMITIDOS_AL_EMITIR);
  };
}

export const armarEmitirComprobanteManual = (dependencias: DependenciasDeFacturacion) =>
  armarEmision<EntradaDeComprobanteManual>(
    dependencias,
    DECLARACIONES_DE_FACTURACION.emitirComprobanteManual.accion,
    (entrada) => ({ clase: "FACTURA", entrada }),
  );

export const armarEmitirNotaDeCredito = (dependencias: DependenciasDeFacturacion) =>
  armarEmision<EntradaDeNotaManual>(
    dependencias,
    DECLARACIONES_DE_FACTURACION.emitirNotaDeCredito.accion,
    (entrada) => ({ clase: "NOTA_CREDITO", entrada }),
  );

export const armarEmitirNotaDeDebito = (dependencias: DependenciasDeFacturacion) =>
  armarEmision<EntradaDeNotaManual>(
    dependencias,
    DECLARACIONES_DE_FACTURACION.emitirNotaDeDebito.accion,
    (entrada) => ({ clase: "NOTA_DEBITO", entrada }),
  );
