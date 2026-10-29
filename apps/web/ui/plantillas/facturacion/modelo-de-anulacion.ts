import type { CodigoFiscal } from "../../../../../src/capacidades/experiencia/respuesta-fiscal";
import {
  texto,
  type DiccionarioResuelto,
} from "../../../../../src/capacidades/vocabulario/vocabulario";
import {
  calcularLaAnulacion,
  filasDeLaFactura,
  type EleccionDeAnulacion,
  type FacturaParaAnular,
} from "./eleccion-de-anulacion";
import { direccionDeAnular, direccionDelDetalle } from "./filtros-del-listado";
import { formatearAlicuota, formatearImporte } from "./formato-fiscal";
import {
  anuladoDe,
  nombreDe,
  type DetalleArmado,
  type DetalleParaMostrar,
} from "./modelo-del-detalle";

/**
 * Lo que se ve de la pantalla de anular por importe (opción 12A, aprobada por el dueño el 2026-10-29): los textos, los importes y
 * qué se ofrece a quién. Puro: sin React ni servidor. Previene: mostrar una cifra distinta de la que se emite y ofrecer anular lo
 * que el servidor va a rechazar. Chequeo: `test/web/anular-modelo.test.ts` (los textos aprobados) y
 * `test/web/anular-calculo.test.ts` (las cifras).
 */

// ---------------------------------------------------------------------------------------------------------------------
// Qué se puede anular y quién ve la acción
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Por qué NO se anula este comprobante, o `null` si se puede: una factura o una nota de débito Autorizada (D-10, D-70); nunca una
 * nota de crédito. Es el mismo código que devuelve el servidor, para que el texto sea el del catálogo. El servidor lo impone igual:
 * acá solo se evita ofrecer lo que va a rechazar.
 */
export function porQueNoSeAnula(
  c: Pick<DetalleParaMostrar, "tipo" | "estado">,
): Extract<CodigoFiscal, "FISCAL_ASOCIADO_NO_AUTORIZADO" | "FISCAL_ASOCIADO_NO_ASOCIABLE"> | null {
  // Una nota de crédito no se anula en ningún estado: se mira primero.
  if (c.tipo.startsWith("NOTA_CREDITO")) return "FISCAL_ASOCIADO_NO_ASOCIABLE";
  return c.estado === "AUTORIZADO" ? null : "FISCAL_ASOCIADO_NO_AUTORIZADO";
}

/** La acción del Detalle: un enlace a la pantalla de anular, o (con `motivo`) el botón apagado y su motivo, sin enlace. */
export type AccionDeAnularDelDetalle = Readonly<{
  etiqueta: string;
  href: string | null;
  motivo: string | null;
}>;

/**
 * La acción «Anular con nota de crédito» del detalle, o `null`. Nunca en una nota de crédito. Para el resto se ofrece si la persona
 * tiene hoy la acción de emitir notas de crédito (`puedeAnular`, que decide el servidor): habilitada si el comprobante está
 * Autorizado, y apagada con su motivo en cualquier otro estado (contrato, pantalla 2; D-10, D-70). Ocultar no es autorizar: la
 * acción vuelve a pasar por el guard.
 */
export function accionDeAnularDelDetalle(
  d: DiccionarioResuelto,
  comprobante: Readonly<{ id: string }> & Pick<DetalleParaMostrar, "tipo" | "estado">,
  puedeAnular: boolean,
): AccionDeAnularDelDetalle | null {
  const noSeAnula = porQueNoSeAnula(comprobante);
  if (!puedeAnular || noSeAnula === "FISCAL_ASOCIADO_NO_ASOCIABLE") return null;
  const etiqueta = texto(d, "fiscal.pantalla.detalle_anular");
  return noSeAnula === null
    ? { etiqueta, href: direccionDeAnular(comprobante.id), motivo: null }
    : { etiqueta, href: null, motivo: texto(d, "fiscal.pantalla.detalle_anular_motivo") };
}

// ---------------------------------------------------------------------------------------------------------------------
// Lo que se ve
// ---------------------------------------------------------------------------------------------------------------------

type Fila = Readonly<{ rotulo: string; importe: string }>;

type FilaParaEscribir = Readonly<{
  clave: string;
  /** «IVA 21 %», «Exento» o «No gravado»; `null` en la letra C (un solo importe, sin alícuota). */
  nombre: string | null;
  facturado: Fila;
  /** La etiqueta del campo: «Importe a anular (con IVA incluido)», o «Importe a anular» en la letra C. */
  etiquetaDelCampo: string;
  /** Lo escrito: texto decimal canónico o `""`. */
  valor: string;
  /** D-72: «El importe supera lo facturado con IVA 10,5 %.» (no bloquea), o `null`. */
  aviso: string | null;
}>;

export type VistaDeLaAnulacion = Readonly<{
  titulo: string;
  subtitulo: string;
  pasos: readonly Readonly<{ nombre: string }>[];
  /** Paso 1. */
  queAnular: Readonly<{
    titulo: string;
    parcial: boolean;
    /** Solo en «Anular solo una parte»: una por alícuota (en la letra C, una sola). */
    filas: readonly FilaParaEscribir[];
    /** La fila del total de la factura (anulación total) o de la suma (parcial). */
    fila: Fila;
    /** El botón que cambia de modo: «Anular solo una parte» o «Anular el total». */
    cambiarDeModo: string;
    sePuedeSeguir: boolean;
  }>;
  /** Paso 2. */
  revision: Readonly<{
    motivo: Readonly<{ etiqueta: string; ayuda: string }>;
    titulo: string;
    aAnularAhora: Fila;
    totalDeLaFactura: Fila;
    anulado: NonNullable<DetalleArmado["anulado"]> | null;
  }>;
  botones: Readonly<{
    cancelar: string;
    siguiente: string;
    volver: string;
    confirmar: string;
    enviando: string;
  }>;
  hrefDeCancelar: string;
}>;

function clienteDe(d: DiccionarioResuelto, receptor: FacturaParaAnular["receptor"]): string {
  return receptor.nombre ?? texto(d, "fiscal.pantalla.consumidor_final");
}

function nombreDeLaFila(d: DiccionarioResuelto, alicuota: string | null, tasa: string | null) {
  if (tasa !== null) return texto(d, "fiscal.pantalla.renglon_iva", { alicuota: tasa });
  if (alicuota === "EXENTO") return texto(d, "fiscal.pantalla.anular_alicuota_exento");
  return alicuota === "NO_GRAVADO" ? texto(d, "fiscal.pantalla.anular_alicuota_no_gravado") : null;
}

function filasParaEscribir(
  d: DiccionarioResuelto,
  f: FacturaParaAnular,
  e: EleccionDeAnulacion,
  supera: ReadonlySet<string>,
): readonly FilaParaEscribir[] {
  return filasDeLaFactura(f).map((fila) => {
    const tasa = fila.alicuota === null ? null : formatearAlicuota(fila.alicuota);
    return {
      clave: fila.clave,
      nombre: nombreDeLaFila(d, fila.alicuota, tasa),
      facturado: {
        rotulo: texto(d, "fiscal.pantalla.anular_facturado"),
        importe: formatearImporte(fila.facturado),
      },
      // D-75 (decisión del ingeniero, no aprobada por el dueño): «con IVA incluido» solo donde hay IVA; en la letra C, Exento y
      // No gravado el campo dice «Importe a anular».
      etiquetaDelCampo: texto(
        d,
        tasa === null ? "fiscal.pantalla.anular_importe" : "fiscal.pantalla.anular_importe_con_iva",
      ),
      valor: e.importes[fila.clave] ?? "",
      aviso: supera.has(fila.clave)
        ? tasa === null
          ? texto(d, "fiscal.pantalla.anular_aviso_supera_c")
          : texto(d, "fiscal.pantalla.anular_aviso_supera", { alicuota: tasa })
        : null,
    };
  });
}

export function armarLaVista(
  d: DiccionarioResuelto,
  f: FacturaParaAnular,
  e: EleccionDeAnulacion,
): VistaDeLaAnulacion {
  const calculo = calcularLaAnulacion(f, e);
  const aAnular = formatearImporte(calculo.aAnular);
  const totalDeLaFactura = formatearImporte(f.importes.total);
  const rotuloTotal = texto(
    d,
    f.tipo.startsWith("NOTA_DEBITO")
      ? "fiscal.pantalla.anular_total_de_la_nota_de_debito"
      : "fiscal.pantalla.anular_total_de_la_factura",
  );
  const supera = new Set(
    calculo.partes.filter((p) => p.superaLoFacturado).map((p) => p.fila.clave),
  );
  return {
    titulo: texto(d, "fiscal.pantalla.anular_titulo"),
    subtitulo: texto(d, "fiscal.pantalla.anular_subtitulo", {
      comprobante: nombreDe(d, f.tipo, f.numero),
      cliente: clienteDe(d, f.receptor),
    }),
    pasos: [
      { nombre: texto(d, "fiscal.pantalla.anular_paso_que") },
      { nombre: texto(d, "fiscal.pantalla.anular_paso_motivo") },
    ],
    queAnular: e.parcial
      ? {
          titulo: texto(d, "fiscal.pantalla.anular_elegi"),
          parcial: true,
          filas: filasParaEscribir(d, f, e, supera),
          fila: { rotulo: texto(d, "fiscal.pantalla.anular_a_anular"), importe: aAnular },
          cambiarDeModo: texto(d, "fiscal.pantalla.anular_el_total"),
          sePuedeSeguir: calculo.sePuedeSeguir,
        }
      : {
          titulo: texto(d, "fiscal.pantalla.anular_se_anula_el_total"),
          parcial: false,
          filas: [],
          fila: { rotulo: rotuloTotal, importe: totalDeLaFactura },
          cambiarDeModo: texto(d, "fiscal.pantalla.anular_solo_una_parte"),
          sePuedeSeguir: calculo.sePuedeSeguir,
        },
    revision: {
      motivo: {
        etiqueta: texto(d, "fiscal.pantalla.anular_motivo"),
        ayuda: texto(d, "fiscal.pantalla.anular_motivo_guardado"),
      },
      titulo: texto(d, "fiscal.pantalla.anular_se_va_a_emitir", { letra: f.tipo.slice(-1) }),
      aAnularAhora: { rotulo: texto(d, "fiscal.pantalla.anular_a_anular_ahora"), importe: aAnular },
      totalDeLaFactura: { rotulo: rotuloTotal, importe: totalDeLaFactura },
      anulado: anuladoDe(d, f),
    },
    botones: {
      cancelar: texto(d, "fiscal.pantalla.anular_cancelar"),
      siguiente: texto(d, "fiscal.pantalla.anular_siguiente"),
      volver: texto(d, "fiscal.pantalla.anular_volver"),
      confirmar: texto(d, "fiscal.pantalla.anular_boton_final"),
      enviando: texto(d, "fiscal.pantalla.anular_enviando"),
    },
    hrefDeCancelar: direccionDelDetalle(f.id),
  };
}

/** El contador del motivo: «0 / 200». Cuenta lo escrito, espacios incluidos (lo que ocupa el campo). */
export function contadorDelMotivo(d: DiccionarioResuelto, motivo: string, limite: number): string {
  return texto(d, "fiscal.pantalla.anular_contador", {
    cantidad: String(motivo.length),
    limite: String(limite),
  });
}
