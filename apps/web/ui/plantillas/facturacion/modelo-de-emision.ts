import type { ClaveDeTexto } from "../../../../../src/capacidades/vocabulario/catalogo";
import {
  texto,
  type DiccionarioResuelto,
} from "../../../../../src/capacidades/vocabulario/vocabulario";
import {
  CONDICIONES_DE_IVA,
  type CondicionIva,
} from "../../../../../src/primitivas/identificacion-fiscal/condicion-iva";
import { numeroDeDocumentoDesdeTexto } from "../../../../../src/primitivas/identificacion-fiscal/documento";
import {
  cantidadCanonica,
  DOCUMENTOS_PARA_ELEGIR,
  type CalculoDeLaEmision,
  type ClienteEscrito,
  type DocumentoElegido,
  type RenglonEscrito,
} from "./eleccion-de-emision";
import {
  formatearAlicuota,
  formatearCantidad,
  formatearImporte,
  formatearPuntoDeVenta,
} from "./formato-fiscal";
import { nombreDeLaFila } from "./modelo-de-anulacion";
import { documentoDe, type TipoDeDocumentoVisible } from "./modelo-del-detalle";

/**
 * Lo que se ve de «Emitir una factura» (8B, por pasos): los textos, las listas para elegir y lo que muestra «Revisar». Puro: sin React
 * ni servidor. Es una lista blanca a propósito: la letra (D-26), el ambiente en producción, el concepto, las fechas de un servicio
 * (D-84), el modo de precio y el descuento (D-85), la forma de pago (D-23) y los datos fiscales de la empresa no están en el modelo, así
 * que no pueden aparecer. Previene: mostrar un dato que el dueño no aprobó o sacó de la pantalla. Chequeo: `test/web/emitir-modelo.test.ts`.
 */

type OpcionDeLista = Readonly<{ valor: string; etiqueta: string }>;

/** Las alícuotas que se ofrecen, las más usadas primero (EMITIR-HTML, línea 34): las del dominio (`CODIGOS_DE_ALICUOTA`), comprobado igual. */
export const ALICUOTAS_PARA_ELEGIR: readonly string[] = [
  "21",
  "10.5",
  "27",
  "5",
  "2.5",
  "0",
  "EXENTO",
  "NO_GRAVADO",
];

const CLAVE_DE_DOCUMENTO = {
  CUIT: "fiscal.pantalla.documento_cuit",
  CUIL: "fiscal.pantalla.documento_cuil",
  CDI: "fiscal.pantalla.documento_cdi",
  DNI: "fiscal.pantalla.documento_dni",
  PASAPORTE: "fiscal.pantalla.documento_pasaporte",
} as const satisfies Record<TipoDeDocumentoVisible, ClaveDeTexto>;

/** Una por valor de `CONDICIONES_DE_IVA`: sumar una condición al dominio no compila hasta que tenga su texto. */
export const CLAVE_DE_CONDICION = {
  RESPONSABLE_INSCRIPTO: "fiscal.pantalla.emitir_condicion_responsable_inscripto",
  EXENTO: "fiscal.pantalla.emitir_condicion_exento",
  CONSUMIDOR_FINAL: "fiscal.pantalla.emitir_condicion_consumidor_final",
  MONOTRIBUTO: "fiscal.pantalla.emitir_condicion_monotributo",
  NO_CATEGORIZADO: "fiscal.pantalla.emitir_condicion_no_categorizado",
  PROVEEDOR_DEL_EXTERIOR: "fiscal.pantalla.emitir_condicion_proveedor_del_exterior",
  CLIENTE_DEL_EXTERIOR: "fiscal.pantalla.emitir_condicion_cliente_del_exterior",
  IVA_LIBERADO_LEY_19640: "fiscal.pantalla.emitir_condicion_iva_liberado",
  MONOTRIBUTISTA_SOCIAL: "fiscal.pantalla.emitir_condicion_monotributista_social",
  IVA_NO_ALCANZADO: "fiscal.pantalla.emitir_condicion_iva_no_alcanzado",
  MONOTRIBUTO_TRABAJADOR_INDEPENDIENTE_PROMOVIDO:
    "fiscal.pantalla.emitir_condicion_monotributo_promovido",
} as const satisfies Record<CondicionIva, ClaveDeTexto>;

// ---------------------------------------------------------------------------------------------------------------------
// Los puntos de venta
// ---------------------------------------------------------------------------------------------------------------------

/** Un punto de venta activo de la sucursal, para elegir con cuál emitir (D-6, D-86). `HOMOLOGACION` es el de pruebas (D-87). */
export type PuntoParaEmitir = Readonly<{
  id: string;
  numero: number;
  ambiente: "HOMOLOGACION" | "PRODUCCION";
}>;

/** Copia SOLO lo que la pantalla usa: lo que se agregue a la lectura del servidor no llega al navegador sin decidirlo acá. */
export function aPuntosParaEmitir(puntos: readonly PuntoParaEmitir[]): readonly PuntoParaEmitir[] {
  return puntos.map((p) => ({ id: p.id, numero: p.numero, ambiente: p.ambiente }));
}

/**
 * El punto de venta con el que se emite: el único si hay uno solo (D-6); si hay varios, el que la persona eligió (nunca el primero
 * por su cuenta: FP-8); `null` si no hay ninguno o todavía no eligió.
 */
export function puntoDeVentaElegido(
  puntos: readonly PuntoParaEmitir[],
  elegido: string,
): PuntoParaEmitir | null {
  if (puntos.length === 1) return puntos[0] ?? null;
  return puntos.find((p) => p.id === elegido) ?? null;
}

export const modoDelPunto = (puntos: readonly PuntoParaEmitir[]): "ninguno" | "uno" | "varios" => {
  if (puntos.length === 0) return "ninguno";
  return puntos.length === 1 ? "uno" : "varios";
};

export const esDePruebas = (p: PuntoParaEmitir): boolean => p.ambiente === "HOMOLOGACION";

/** «00002», o «00002 · Pruebas» si es de pruebas (D-87). */
export function etiquetaDelPunto(d: DiccionarioResuelto, p: PuntoParaEmitir): string {
  const numero = formatearPuntoDeVenta(p.numero);
  return esDePruebas(p)
    ? texto(d, "fiscal.pantalla.emitir_punto_de_venta_con_marca", {
        numero,
        marca: texto(d, "fiscal.pantalla.config_pv_pruebas"),
      })
    : numero;
}

// ---------------------------------------------------------------------------------------------------------------------
// Lo que se ve
// ---------------------------------------------------------------------------------------------------------------------

export type VistaDeLosPasos = Readonly<{
  pasos: readonly Readonly<{ nombre: string }>[];
  botones: Readonly<{ siguiente: string; volver: string; emitir: string; enviando: string }>;
}>;

export type VistaDelCliente = Readonly<{
  documento: Readonly<{ etiqueta: string; opciones: readonly OpcionDeLista[] }>;
  /** Solo si no es el consumidor final: el número (rotulado con el nombre del tipo de documento), el nombre y la condición. */
  identificacion: Readonly<{
    numero: string;
    nombre: string;
    domicilio: string;
    condicion: Readonly<{ etiqueta: string; opciones: readonly OpcionDeLista[] }>;
  }> | null;
  /** El aviso que se ve debajo del campo con error: uno solo, genérico, para todos los campos del cliente. */
  campoInvalido: string;
}>;

export type VistaDeLosRenglones = Readonly<{
  etiquetas: Readonly<{
    descripcion: string;
    cantidad: string;
    precio: string;
    /** `null` si la empresa no discrimina IVA: no se pide la alícuota. */
    iva: string | null;
    agregar: string;
  }>;
  alicuotas: readonly OpcionDeLista[];
  grupo: (numero: number) => string;
  quitar: (numero: number) => string;
}>;

export type VistaDeLaRevision = Readonly<{
  titulo: string;
  cliente: Readonly<{ rotulo: string; principal: string; secundario: string | null }>;
  renglones: Readonly<{
    rotulo: string;
    filas: readonly Readonly<{
      id: number;
      descripcion: string;
      cuenta: string;
      iva: string | null;
      importe: string;
    }>[];
    rotuloDelTotal: string;
    total: string;
  }>;
  puntoDeVenta: Readonly<{
    rotulo: string;
    /** Ninguno activo: sin dónde emitir. Uno: se usa solo (D-6). Varios: se elige. */
    modo: "ninguno" | "uno" | "varios";
    /** El valor del punto único o el cartel de «ninguno». */
    texto: string;
    opciones: readonly OpcionDeLista[];
    /** El aviso de pruebas, solo si el punto de venta elegido es de pruebas (D-87). */
    avisoDePruebas: string | null;
  }>;
}>;

export const vistaDeLosPasos = (d: DiccionarioResuelto): VistaDeLosPasos => ({
  pasos: [
    { nombre: texto(d, "fiscal.pantalla.rotulo_cliente") },
    { nombre: texto(d, "fiscal.pantalla.rotulo_renglones") },
    { nombre: texto(d, "fiscal.pantalla.emitir_paso_revisar") },
  ],
  botones: {
    siguiente: texto(d, "fiscal.pantalla.anular_siguiente"),
    volver: texto(d, "fiscal.pantalla.anular_volver"),
    emitir: texto(d, "fiscal.pantalla.emitir_titulo"),
    enviando: texto(d, "conexion.enviando"),
  },
});

export function vistaDelCliente(d: DiccionarioResuelto, c: ClienteEscrito): VistaDelCliente {
  const documentos: readonly DocumentoElegido[] = ["SIN_IDENTIFICAR", ...DOCUMENTOS_PARA_ELEGIR];
  const etiquetaDeCondicion = texto(d, "fiscal.pantalla.config_df_condicion_iva");
  return {
    documento: {
      etiqueta: texto(d, "fiscal.pantalla.listado_rotulo_documento"),
      opciones: documentos.map((valor) => ({
        valor,
        etiqueta: texto(
          d,
          valor === "SIN_IDENTIFICAR"
            ? "fiscal.pantalla.consumidor_final"
            : CLAVE_DE_DOCUMENTO[valor],
        ),
      })),
    },
    identificacion:
      c.documento === "SIN_IDENTIFICAR"
        ? null
        : {
            numero: texto(d, CLAVE_DE_DOCUMENTO[c.documento]),
            nombre: texto(d, "fiscal.pantalla.emitir_nombre"),
            // «Domicilio»: el rótulo ya aprobado de Datos fiscales (D-82, dueño, 2026-11-03; `Pedernal-docs/11-especificaciones/facturador-contratos-de-pantalla.md`, fila D-82), sin texto nuevo.
            domicilio: texto(d, "fiscal.pantalla.config_df_domicilio_fiscal"),
            condicion: {
              etiqueta: etiquetaDeCondicion,
              opciones: CONDICIONES_DE_IVA.map((valor) => ({
                valor,
                etiqueta: texto(d, CLAVE_DE_CONDICION[valor]),
              })),
            },
          },
    // El texto ya aprobado de los errores marcados en su campo (D-67, «Revisá los datos marcados.»; clave de Datos fiscales). El dueño eligió
    // usarlo y NO agregar «Revisá este dato.» (2026-11-06, mensaje directo al orquestador tras ver las capturas de #204: «Apruebo B. Seguir usando el texto que ya está»).
    campoInvalido: texto(d, "error.fiscal_configuracion_datos_invalidos"),
  };
}

export function vistaDeLosRenglones(
  d: DiccionarioResuelto,
  discriminaIva: boolean,
): VistaDeLosRenglones {
  return {
    etiquetas: {
      descripcion: texto(d, "fiscal.pantalla.emitir_descripcion"),
      cantidad: texto(d, "fiscal.pantalla.emitir_cantidad"),
      precio: texto(
        d,
        discriminaIva ? "fiscal.pantalla.emitir_precio_con_iva" : "fiscal.pantalla.emitir_precio",
      ),
      iva: discriminaIva ? texto(d, "fiscal.pantalla.emitir_iva") : null,
      agregar: texto(d, "fiscal.pantalla.emitir_agregar_renglon"),
    },
    alicuotas: ALICUOTAS_PARA_ELEGIR.map((valor) => ({
      valor,
      etiqueta: nombreDeLaFila(d, valor, formatearAlicuota(valor)) ?? valor,
    })),
    grupo: (numero) =>
      texto(d, "fiscal.pantalla.emitir_renglon_numero", { numero: String(numero) }),
    quitar: (numero) =>
      texto(d, "fiscal.pantalla.emitir_quitar_renglon", { numero: String(numero) }),
  };
}

export function clienteDeLaRevision(
  d: DiccionarioResuelto,
  c: ClienteEscrito,
): VistaDeLaRevision["cliente"] {
  const rotulo = texto(d, "fiscal.pantalla.rotulo_cliente");
  if (c.documento === "SIN_IDENTIFICAR") {
    return { rotulo, principal: texto(d, "fiscal.pantalla.consumidor_final"), secundario: null };
  }
  // El número como lo va a guardar el servidor (la misma primitiva); si no vale, se muestra lo escrito y el servidor lo rechaza marcando el campo.
  const canonico = numeroDeDocumentoDesdeTexto(c.documento, c.numero.trim());
  const documento = documentoDe(d, {
    tipo: c.documento,
    numero: canonico.ok ? canonico.valor : c.numero.trim(),
  });
  return { rotulo, principal: c.nombre.trim(), secundario: documento };
}

/**
 * «Revisar»: el cliente, los renglones con su cuenta y su importe, el total y el punto de venta. `calculo` es `null` solo si algún
 * renglón no se puede calcular (la pantalla no deja llegar acá en ese caso).
 */
export function vistaDeLaRevision(
  d: DiccionarioResuelto,
  datos: Readonly<{
    cliente: ClienteEscrito;
    renglones: readonly RenglonEscrito[];
    calculo: CalculoDeLaEmision | null;
    discriminaIva: boolean;
    puntos: readonly PuntoParaEmitir[];
    puntoElegido: string;
  }>,
): VistaDeLaRevision {
  const { renglones, calculo, discriminaIva, puntos } = datos;
  const elegido = puntoDeVentaElegido(puntos, datos.puntoElegido);
  const unico = puntos.length === 1 && elegido !== null ? etiquetaDelPunto(d, elegido) : "";
  return {
    titulo: texto(d, "fiscal.pantalla.emitir_revisa_y_emiti"),
    cliente: clienteDeLaRevision(d, datos.cliente),
    renglones: {
      rotulo: texto(d, "fiscal.pantalla.rotulo_renglones"),
      filas: renglones.map((r, i) => {
        const tasa = r.alicuota === "" ? null : formatearAlicuota(r.alicuota);
        return {
          id: r.id,
          descripcion: r.descripcion.trim(),
          cuenta: texto(d, "fiscal.pantalla.renglon_cuenta", {
            cantidad: formatearCantidad(cantidadCanonica(r.cantidad)),
            precio: formatearImporte(r.precio),
          }),
          iva: discriminaIva && r.alicuota !== "" ? nombreDeLaFila(d, r.alicuota, tasa) : null,
          importe: formatearImporte(calculo?.importes[i] ?? ""),
        };
      }),
      rotuloDelTotal: texto(d, "fiscal.pantalla.rotulo_total"),
      total: formatearImporte(calculo?.total ?? ""),
    },
    puntoDeVenta: {
      rotulo: texto(d, "fiscal.pantalla.rotulo_punto_de_venta"),
      modo: modoDelPunto(puntos),
      // Sin punto de venta activo, el cartel ya aprobado «Ninguno activo» (D-64); sin texto nuevo. Dueño, 2026-11-03, cuestionario “Emitir”, «Sin puntos».
      texto: puntos.length === 0 ? texto(d, "fiscal.pantalla.config_cartel_ninguno_activo") : unico,
      opciones: puntos.map((p) => ({ valor: p.id, etiqueta: etiquetaDelPunto(d, p) })),
      avisoDePruebas:
        elegido !== null && esDePruebas(elegido)
          ? texto(d, "fiscal.pantalla.config_pv_aviso_pruebas")
          : null,
    },
  };
}
