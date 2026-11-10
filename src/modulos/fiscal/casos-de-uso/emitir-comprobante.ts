import type { ClaveAccion } from "../../../capacidades/modulos/catalogo";
import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { EmpresaNoOpera } from "../../../contexto/estados";
import { importeATexto, importesIguales } from "../../../primitivas/dinero/importe";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { fechaCivilDesdeTexto } from "../../../primitivas/tiempo/fecha-civil";
import type { OrigenDeComprobante } from "../dominio/comprobante-emitido";
import {
  armarComprobanteNuevo,
  type ContextoDeEmision,
  type ComprobanteNuevo,
  type ErrorDeComprobanteNuevo,
} from "../dominio/comprobante-nuevo";
import { comprobanteId, origenId } from "../dominio/identificadores";
import { VERSION_DE_REPRESENTACION_ACTUAL } from "../dominio/modelo-de-impresion";
import {
  armarNotaAsociada,
  type ComprobanteAAsociar,
  type ErrorDeNota,
} from "../dominio/nota-asociada";
import type { CondicionIva } from "../dominio/emisor";
import { letraParaFactura } from "../dominio/letra-de-comprobante";
import { ingresosBrutosDeclarados } from "../dominio/datos-fiscales";
import { versionVigente } from "../dominio/vigencia";
import type { ComprobanteGuardado } from "../persistencia/repositorio-de-comprobantes";
import { traducirErroresDeFiscal } from "../persistencia/traducir";
import { empresaOpera } from "./comun";
import {
  encolarValidacion,
  type DependenciasDeFacturacion,
  type TxDeFacturacion,
} from "./contrato-de-facturacion";
import {
  huellaDelPedido,
  type DeOrigen,
  type EntradaDeComprobanteManual,
  type EntradaDeNotaManual,
  type ErrorAlEmitir,
  type ErrorDeOrigen,
  type ErrorPropioAlEmitir,
  type Pedido,
  type SalidaDeEmitir,
} from "./entradas-de-emision";
import { DECLARACIONES_DE_FACTURACION } from "./declaraciones-de-facturacion";
import {
  puntoDeVentaYSucursalesDelPedido,
  sucursalDelPuntoDeVentaAbierta,
} from "./sucursales-al-emitir";

/**
 * Emitir a mano (spec H7 facturación §B.4.1 y §B.4.3): una factura (`emitirComprobanteManual`), una nota de crédito
 * (`emitirNotaDeCredito`) o una de débito (`emitirNotaDeDebito`). Cada uno exige SU acción al guard (§C: la NC es
 * `notas_de_credito.emitir`; la factura y la ND, `comprobantes.emitir_manual`), y comparten el cuerpo, en UNA transacción SERIALIZABLE:
 *
 *  1. Guard. 2. La empresa opera. 3. Repetición: un comprobante con origen `(MANUAL, clave)` en CUALQUIER estado con la misma
 *     huella del pedido devuelve ese (`yaExistia`, sin escribir ni auditar); con otra huella, `CLAVE_REUTILIZADA`. 4. El punto de
 *     venta (activo, emisor activo), los datos fiscales VIGENTES del emisor, sus domicilios y un certificado `VIGENTE` y no vencido
 *     para (emisor, ambiente del punto de venta). 5. El dominio arma el contenido (letra, receptor, cálculo). 6. Alta `PENDIENTE`
 *     con renglones y alícuotas. 7. Auditoría `COMPROBANTE_CREADO` (sin nombre ni documento del receptor). 8. Encola
 *     `fiscal.validar_comprobante` (`fiscal.validar:<id>:1`).
 *
 * Las sucursales (D-41, D-50 y D-51): el alcance de la persona se mira ANTES de la repetición y que la del punto de venta esté
 * abierta DESPUÉS, junto al punto de venta activo (repetir da lo mismo aunque se cierre); la base lo impone con bloqueo (0017).
 * Los datos fiscales vigentes tienen que declarar Ingresos Brutos, el número o «No contribuyente» (D-115): si no, no se emite.
 * El `id` del comprobante ES la clave de la pantalla (un uuid): una clave nunca da dos comprobantes, ni después de un rechazo
 * (corregir es otro pedido con otra clave). Dos emisiones simultáneas con la misma clave: SERIALIZABLE y las únicas de la base
 * dejan pasar una; la otra repite, la encuentra y devuelve `yaExistia`.
 *
 * Nada se pide a ARCA acá (ADR-007): lo hace el trabajo de validación después de confirmar. */

/** La forma de un uuid: la clave es el id del comprobante (columna `uuid`). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const salidaDe = (c: ComprobanteGuardado, yaExistia: boolean): SalidaDeEmitir => ({
  comprobanteId: c.id,
  estado: c.estado,
  tipo: c.tipo,
  total: importeATexto(c.importes.total),
  yaExistia,
});

/** Lo que la base puede rechazar al dar de alta y que es parte del contrato de emitir. */
export const ADMITIDOS_AL_EMITIR = [
  "COMPROBANTE_ALTA_INVALIDA",
  "COMPROBANTE_ASOCIADO_INVALIDO",
  "COMPROBANTE_ASOCIADO_NO_ENCONTRADO",
  "PUNTO_DE_VENTA_NO_ENCONTRADO",
  "SUCURSAL_CERRADA",
] as const;

type Contexto = ContextoOperativo &
  Readonly<{ personaId: NonNullable<ContextoOperativo["personaId"]> }>;

/**
 * La letra C no discrimina IVA: ningún renglón lleva alícuota (`ALICUOTA_EN_LETRA_C`). Quien factura un documento ya armado (que trae la
 * alícuota de cada renglón) no sabe qué letra va a salir; la descarta fiscal, que sí lo sabe (SUPUESTO S-2 de E1).
 */
function sinAlicuotaEnLetraC(
  entrada: EntradaDeComprobanteManual,
  emisor: CondicionIva,
): EntradaDeComprobanteManual {
  if (letraParaFactura(emisor, entrada.receptor.condicionIva) !== "C") return entrada;
  return { ...entrada, renglones: entrada.renglones.map((r) => ({ ...r, alicuota: null })) };
}

/** El cuerpo común, dentro de la transacción y DESPUÉS del guard. */
export async function emitirEnTx(
  tx: TxDeFacturacion,
  contexto: Contexto,
  pedido: Pedido,
): Promise<Resultado<SalidaDeEmitir, ErrorPropioAlEmitir | EmpresaNoOpera>>;
export async function emitirEnTx(
  tx: TxDeFacturacion,
  contexto: Contexto,
  pedido: Pedido,
  deOrigen: DeOrigen,
): Promise<Resultado<SalidaDeEmitir, ErrorPropioAlEmitir | ErrorDeOrigen | EmpresaNoOpera>>;
export async function emitirEnTx(
  tx: TxDeFacturacion,
  contexto: Contexto,
  pedido: Pedido,
  deOrigen: DeOrigen | null = null,
): Promise<Resultado<SalidaDeEmitir, ErrorPropioAlEmitir | ErrorDeOrigen | EmpresaNoOpera>> {
  const { empresaId, ahora } = contexto;
  const { entrada } = pedido;
  const opera = await empresaOpera(tx, empresaId);
  if (!opera.ok) return opera;

  // El asociado (solo las notas), el punto de venta y sus sucursales, antes de la repetición (`sucursales-al-emitir.ts`).
  const sucursales = await puntoDeVentaYSucursalesDelPedido(tx, contexto, entrada);
  if (!sucursales.ok) return sucursales;
  const { pv, asociado } = sucursales.valor;
  // 3. Repetición: la clave de la pantalla (o el origen del documento), en cualquier estado y de cualquier clase.
  const origen: OrigenDeComprobante =
    deOrigen === null ? { tipo: "MANUAL", id: origenId(entrada.clave) } : deOrigen.origen;
  const huella = deOrigen === null ? huellaDelPedido(pedido) : deOrigen.huella;
  const previos = await tx.comprobantes.delOrigen(empresaId, origen.tipo, origen.id);
  const previo = previos[0];
  if (previo !== undefined) {
    return previo.huella === huella ? ok(salidaDe(previo, true)) : err("CLAVE_REUTILIZADA");
  }

  // 4. El punto de venta (activo, de una sucursal abierta), el emisor, sus datos y su certificado.
  if (pv.estado !== "ACTIVO") return err("PUNTO_DE_VENTA_INACTIVO");
  // PP-E1-1 (decisión 175): el punto de venta de un documento de origen es de la sucursal de ese documento, nunca la que pida el navegador.
  if (deOrigen !== null && pv.sucursalId !== deOrigen.sucursalEsperadaId) {
    return err("PUNTO_DE_VENTA_DE_OTRA_SUCURSAL");
  }
  // D-50 (la base lo vuelve a imponer, con bloqueo, al dar de alta).
  const abierta = await sucursalDelPuntoDeVentaAbierta(tx, empresaId, pv);
  if (!abierta.ok) return abierta;
  const emisor = await tx.emisores.obtener(empresaId, pv.emisorId);
  // La clave foránea compuesta garantiza que el emisor del punto de venta existe y es de la empresa.
  if (emisor === null) throw new Error(`el emisor ${pv.emisorId} del punto de venta no existe`);
  if (!emisor.activo) return err("EMISOR_INACTIVO");
  const datos = versionVigente(await tx.datosFiscales.confirmadas(empresaId, emisor.id), ahora);
  if (datos === null) return err("SIN_DATOS_FISCALES_VIGENTES");
  if (!ingresosBrutosDeclarados(datos)) return err("INGRESOS_BRUTOS_SIN_DECLARAR");
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
    contenido = armarComprobanteNuevo(
      deOrigen === null
        ? pedido.entrada
        : sinAlicuotaEnLetraC(pedido.entrada, contextoDeEmision.emisor.condicionIva),
      contextoDeEmision,
    );
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
  // Guarda de integridad: se cobró X, no se factura Y. Dos implementaciones de la misma regla (la de quien cobra y esta) no pueden diferir
  // ni un centavo; si difieren, no se escribe nada.
  if (deOrigen !== null && !importesIguales(contenido.valor.total, deOrigen.totalEsperado)) {
    return err("TOTAL_NO_COINCIDE");
  }

  // 6. Alta.
  const alta = await tx.comprobantes.crear({
    id: deOrigen === null ? comprobanteId(entrada.clave) : deOrigen.comprobanteId,
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

export {
  huellaDeLaFacturaDeOrigen,
  huellaDelPedido,
  type DeOrigen,
  type EntradaDeComprobanteManual,
  type EntradaDeNotaManual,
  type ErrorAlEmitir,
  type ErrorDeOrigen,
  type ErrorPropioAlEmitir,
  type SalidaDeEmitir,
} from "./entradas-de-emision";
