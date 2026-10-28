import type { ClaveDeTexto } from "../../../../../src/capacidades/vocabulario/catalogo";
import {
  texto,
  type DiccionarioResuelto,
} from "../../../../../src/capacidades/vocabulario/vocabulario";
import type { PropsDeInsignia, TonoDeEstado } from "../../componentes/Insignia";
import {
  formatearAlicuota,
  formatearCantidad,
  formatearFecha,
  formatearImporte,
  formatearNumeroDeDocumento,
  formatearPuntoDeVenta,
} from "./formato-fiscal";

/**
 * El modelo de vista del detalle de un comprobante (contrato de la pantalla 2): de lo que entrega la consulta, TODO lo que
 * se ve y NADA más. Puro: sin React ni servidor. Es una lista blanca a propósito: el origen, el ambiente, los códigos
 * crudos y la reserva y folio no están en el modelo, así que no pueden aparecer. Previene: mostrar un dato que el dueño no
 * aprobó, o mostrarlo en el estado equivocado (el CAE de un comprobante que no está autorizado). Chequeo:
 * `test/web/detalle-de-comprobante.test.ts`.
 */

type TipoVisible =
  | "FACTURA_A"
  | "FACTURA_B"
  | "FACTURA_C"
  | "NOTA_DEBITO_A"
  | "NOTA_DEBITO_B"
  | "NOTA_DEBITO_C"
  | "NOTA_CREDITO_A"
  | "NOTA_CREDITO_B"
  | "NOTA_CREDITO_C";

type EstadoVisible =
  | "PENDIENTE"
  | "EN_VALIDACION"
  | "AUTORIZADO"
  | "RECHAZADO"
  | "INCIERTO"
  | "CONFLICTO"
  | "DESCARTADO";

type TipoDeDocumentoVisible = "CUIT" | "CUIL" | "CDI" | "DNI" | "PASAPORTE";

/** Lo que el detalle necesita de `DetalleParaLaPantalla`: un subconjunto estructural (la UI no importa la composición). */
export type DetalleParaMostrar = Readonly<{
  tipo: TipoVisible;
  estado: EstadoVisible;
  numero: string | null;
  fechaEmision: string | null;
  cae: string | null;
  caeVence: string | null;
  importes: Readonly<{ total: string }>;
  renglones: readonly Readonly<{
    descripcion: string;
    cantidad: string;
    precioUnitario: string;
    alicuota: string | null;
    importe: string;
  }>[];
  emisor: Readonly<{ puntoDeVentaNumero: number }>;
  receptor: Readonly<{
    nombre: string | null;
    documento:
      | Readonly<{ tipo: TipoDeDocumentoVisible; numero: string }>
      | Readonly<{ tipo: "SIN_IDENTIFICAR" }>;
  }>;
  asociado: Readonly<{ tipo: TipoVisible; numero: string; fecha: string }> | null;
  motivoDeDescarte: string | null;
  notasQueLoCitan: readonly Readonly<{
    id: string;
    tipo: TipoVisible;
    numero: string | null;
    total: string;
    estado: EstadoVisible;
  }>[];
  acreditado: string | null;
  acreditacion: "NINGUNA" | "PARCIAL" | "TOTAL" | null;
  ultimoIntento: Readonly<{
    mensajes: readonly Readonly<{
      clave: ClaveDeTexto;
      marcadores?: Readonly<{ codigo: string }>;
    }>[];
  }> | null;
}>;

type Tono = PropsDeInsignia["tono"];
type EstadoArmado = Readonly<{ texto: string; tono: Tono }>;

export type DetalleArmado = Readonly<{
  titulo: string;
  estado: EstadoArmado;
  /** «Anulación parcial» o «Anulación total»; `null` si no hay (solo una factura autorizada la tiene). */
  anulacion: string | null;
  corresponde: string | null;
  aviso: Readonly<{ tono: TonoDeEstado; titulo: string | null; lineas: readonly string[] }> | null;
  datos: readonly Readonly<{ rotulo: string; valor: string; secundario: string | null }>[];
  rotuloDeRenglones: string;
  renglones: readonly Readonly<{
    descripcion: string;
    cuenta: string;
    iva: string | null;
    importe: string;
  }>[];
  rotuloDelTotal: string;
  total: string;
  anulado: Readonly<{
    titulo: string;
    cifra: string | null;
    notas: readonly Readonly<{ id: string; nombre: string; total: string; estado: EstadoArmado }>[];
    sinNotas: string | null;
  }> | null;
}>;

const CLAVE_DE_ESTADO = {
  PENDIENTE: "fiscal.pantalla.estado_pendiente",
  EN_VALIDACION: "fiscal.pantalla.estado_en_validacion",
  AUTORIZADO: "fiscal.pantalla.estado_autorizado",
  RECHAZADO: "fiscal.pantalla.estado_rechazado",
  INCIERTO: "fiscal.pantalla.estado_incierto",
  CONFLICTO: "fiscal.pantalla.estado_conflicto",
  DESCARTADO: "fiscal.pantalla.estado_descartado",
} as const satisfies Record<EstadoVisible, ClaveDeTexto>;

/** Nunca solo color: cada tono va con su texto y su ícono (insignia y aviso). */
const TONO_DE_ESTADO = {
  PENDIENTE: "neutro",
  EN_VALIDACION: "info",
  AUTORIZADO: "exito",
  RECHAZADO: "peligro",
  INCIERTO: "aviso",
  CONFLICTO: "peligro",
  DESCARTADO: "neutro",
} as const satisfies Record<EstadoVisible, Tono>;

const CLAVE_DE_DOCUMENTO = {
  CUIT: "fiscal.pantalla.documento_cuit",
  CUIL: "fiscal.pantalla.documento_cuil",
  CDI: "fiscal.pantalla.documento_cdi",
  DNI: "fiscal.pantalla.documento_dni",
  PASAPORTE: "fiscal.pantalla.documento_pasaporte",
} as const satisfies Record<TipoDeDocumentoVisible, ClaveDeTexto>;

const esNotaDeCredito = (tipo: TipoVisible): boolean => tipo.startsWith("NOTA_CREDITO");
const esFactura = (tipo: TipoVisible): boolean => tipo.startsWith("FACTURA");

function claveDeClase(tipo: TipoVisible): ClaveDeTexto {
  if (esFactura(tipo)) return "fiscal.pantalla.tipo_factura";
  return esNotaDeCredito(tipo)
    ? "fiscal.pantalla.tipo_nota_de_credito"
    : "fiscal.pantalla.tipo_nota_de_debito";
}

/** «Factura B 0001-00001234»; sin número («Factura B») mientras no está autorizada. */
function nombreDe(d: DiccionarioResuelto, tipo: TipoVisible, numero: string | null): string {
  const base = { tipo: texto(d, claveDeClase(tipo)), letra: tipo.slice(-1) };
  return numero === null
    ? texto(d, "fiscal.pantalla.comprobante_sin_numero", base)
    : texto(d, "fiscal.pantalla.comprobante_con_numero", { ...base, numero });
}

function estadoDe(d: DiccionarioResuelto, estado: EstadoVisible): EstadoArmado {
  return { texto: texto(d, CLAVE_DE_ESTADO[estado]), tono: TONO_DE_ESTADO[estado] };
}

function clienteDe(d: DiccionarioResuelto, receptor: DetalleParaMostrar["receptor"]) {
  const consumidor = texto(d, "fiscal.pantalla.consumidor_final");
  const documento = receptor.documento;
  if (documento.tipo === "SIN_IDENTIFICAR") {
    return receptor.nombre === null
      ? { valor: consumidor, secundario: null }
      : { valor: receptor.nombre, secundario: consumidor };
  }
  const identificacion = texto(d, "fiscal.pantalla.documento", {
    tipo: texto(d, CLAVE_DE_DOCUMENTO[documento.tipo]),
    numero: formatearNumeroDeDocumento(documento.tipo, documento.numero),
  });
  return receptor.nombre === null
    ? { valor: identificacion, secundario: null }
    : { valor: receptor.nombre, secundario: identificacion };
}

function avisoDe(d: DiccionarioResuelto, detalle: DetalleParaMostrar): DetalleArmado["aviso"] {
  switch (detalle.estado) {
    case "EN_VALIDACION":
      return {
        tono: "info",
        titulo: texto(d, "fiscal.pantalla.aviso_validando_titulo"),
        lineas: [texto(d, "fiscal.pantalla.aviso_validando_detalle")],
      };
    case "INCIERTO":
      return {
        tono: "aviso",
        titulo: texto(d, "fiscal.pantalla.aviso_incierto_titulo"),
        lineas: [texto(d, "fiscal.pantalla.aviso_incierto_detalle")],
      };
    case "RECHAZADO":
      return {
        tono: "peligro",
        titulo: texto(d, "fiscal.pantalla.aviso_rechazado_titulo"),
        lineas: (detalle.ultimoIntento?.mensajes ?? []).map((m) => texto(d, m.clave, m.marcadores)),
      };
    case "CONFLICTO":
      return {
        tono: "peligro",
        titulo: texto(d, "fiscal.pantalla.aviso_conflicto_titulo"),
        lineas: [texto(d, "fiscal.pantalla.aviso_conflicto_detalle")],
      };
    case "DESCARTADO":
      return detalle.motivoDeDescarte === null
        ? null
        : { tono: "info", titulo: null, lineas: [detalle.motivoDeDescarte] };
    default:
      return null;
  }
}

function datosDe(d: DiccionarioResuelto, detalle: DetalleParaMostrar): DetalleArmado["datos"] {
  const cliente = clienteDe(d, detalle.receptor);
  const autorizado = detalle.estado === "AUTORIZADO";
  const filas: { rotulo: string; valor: string; secundario: string | null }[] = [];
  if (detalle.numero !== null) {
    filas.push({
      rotulo: texto(d, "fiscal.pantalla.rotulo_numero"),
      valor: detalle.numero,
      secundario: null,
    });
  }
  if (detalle.fechaEmision !== null) {
    filas.push({
      rotulo: texto(d, "fiscal.pantalla.rotulo_fecha"),
      valor: formatearFecha(detalle.fechaEmision),
      secundario: null,
    });
  }
  // El CAE y su vencimiento, solo si ARCA autorizó el comprobante.
  if (autorizado && detalle.cae !== null) {
    filas.push({
      rotulo: texto(d, "fiscal.pantalla.rotulo_cae"),
      valor:
        detalle.caeVence === null
          ? detalle.cae
          : texto(d, "fiscal.pantalla.cae_con_vencimiento", {
              cae: detalle.cae,
              vencimiento: formatearFecha(detalle.caeVence),
            }),
      secundario: null,
    });
  }
  filas.push({ rotulo: texto(d, "fiscal.pantalla.rotulo_cliente"), ...cliente });
  filas.push({
    rotulo: texto(d, "fiscal.pantalla.rotulo_punto_de_venta"),
    valor: formatearPuntoDeVenta(detalle.emisor.puntoDeVentaNumero),
    secundario: null,
  });
  return filas;
}

function anuladoDe(d: DiccionarioResuelto, detalle: DetalleParaMostrar): DetalleArmado["anulado"] {
  // Solo una factura autorizada; una nota (de crédito o de débito) muestra a qué corresponde, no lo anulado.
  if (detalle.estado !== "AUTORIZADO" || !esFactura(detalle.tipo)) return null;
  const notas = detalle.notasQueLoCitan
    .filter((n) => esNotaDeCredito(n.tipo))
    .map((n) => ({
      id: n.id,
      nombre: nombreDe(d, n.tipo, n.numero),
      total: formatearImporte(n.total),
      estado: estadoDe(d, n.estado),
    }));
  return {
    titulo: texto(d, "fiscal.pantalla.ya_anulado"),
    cifra: detalle.acreditado === null ? null : formatearImporte(detalle.acreditado),
    notas,
    sinNotas: notas.length === 0 ? texto(d, "fiscal.pantalla.sin_notas") : null,
  };
}

function anulacionDe(d: DiccionarioResuelto, detalle: DetalleParaMostrar): string | null {
  if (detalle.estado !== "AUTORIZADO") return null;
  if (detalle.acreditacion === "PARCIAL") return texto(d, "fiscal.pantalla.anulacion_parcial");
  return detalle.acreditacion === "TOTAL" ? texto(d, "fiscal.pantalla.anulacion_total") : null;
}

export function armarElDetalle(
  detalle: DetalleParaMostrar,
  d: DiccionarioResuelto = {},
): DetalleArmado {
  return {
    titulo: nombreDe(d, detalle.tipo, detalle.numero),
    estado: estadoDe(d, detalle.estado),
    anulacion: anulacionDe(d, detalle),
    corresponde:
      detalle.asociado === null
        ? null
        : texto(d, "fiscal.pantalla.corresponde_a", {
            comprobante: nombreDe(d, detalle.asociado.tipo, detalle.asociado.numero),
            fecha: formatearFecha(detalle.asociado.fecha),
          }),
    aviso: avisoDe(d, detalle),
    datos: datosDe(d, detalle),
    rotuloDeRenglones: texto(d, "fiscal.pantalla.rotulo_renglones"),
    renglones: detalle.renglones.map((r) => {
      const alicuota = r.alicuota === null ? null : formatearAlicuota(r.alicuota);
      return {
        descripcion: r.descripcion,
        cuenta: texto(d, "fiscal.pantalla.renglon_cuenta", {
          cantidad: formatearCantidad(r.cantidad),
          precio: formatearImporte(r.precioUnitario),
        }),
        iva: alicuota === null ? null : texto(d, "fiscal.pantalla.renglon_iva", { alicuota }),
        importe: formatearImporte(r.importe),
      };
    }),
    rotuloDelTotal: texto(d, "fiscal.pantalla.rotulo_total"),
    total: formatearImporte(detalle.importes.total),
    anulado: anuladoDe(d, detalle),
  };
}
