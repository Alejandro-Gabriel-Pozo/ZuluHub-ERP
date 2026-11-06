import type { ClaveDeTexto } from "../../../../../../src/capacidades/vocabulario/catalogo";
import {
  texto,
  type DiccionarioResuelto,
} from "../../../../../../src/capacidades/vocabulario/vocabulario";
import { esCondicionIva } from "../../../../../../src/primitivas/identificacion-fiscal/condicion-iva";
import {
  formatearAlicuota,
  formatearCantidad,
  formatearFecha,
  formatearImporte,
} from "../formato-fiscal";
import { CLAVE_DE_CONDICION } from "../modelo-de-emision";
import { documentoDe, type TipoDeDocumentoVisible } from "../modelo-del-detalle";
import { filaDeLeyenda } from "./fila-de-leyenda";

/**
 * El modelo de vista de la hoja imprimible: de lo que trae el modelo de impresión (`ModeloImpreso` de fiscal, ya armado por el servidor),
 * TODO lo que la hoja dibuja y NADA más. La UI no importa `src/modulos/**`: el tipo es propio y estructural (importes y fechas son texto).
 * Lista blanca a propósito: `referencias`, `descuento`, la marca de logo y color y la versión no están, así que no se dibujan (D-109).
 * Previene: imprimir un dato que el dueño no aprobó, o un importe que pasó por `number` (ADR-006). Chequeo: `test/web/impresion-modelo.test.ts`.
 */

export type FormatoDeImpresion = "A4" | "TICKET";

type TipoDeLetra = "A" | "B" | "C";

export type ComprobanteParaLaHoja = Readonly<{
  marca: Readonly<{ nombreDeFantasia: string | null }>;
  fiscal: Readonly<{
    /** «FACTURA», «NOTA DE CRÉDITO» o «NOTA DE DÉBITO»: sale del modelo y no se edita. */
    rotulo: string;
    letra: TipoDeLetra;
    /** Tres dígitos: «006». */
    codigoDelTipo: string;
    /** `PPPPP-NNNNNNNN`. */
    numero: string;
    fecha: string;
    cae: string;
    caeVence: string;
    emisor: Readonly<{
      cuit: string;
      razonSocial: string;
      condicionIva: string;
      domicilioFiscal: string;
      domicilioDelPuntoDeVenta: string;
      iibbNumero: string | null;
      inicioDeActividades: string;
    }>;
  }>;
  receptor: Readonly<{
    nombre: string | null;
    documento:
      | Readonly<{ tipo: TipoDeDocumentoVisible; numero: string }>
      | Readonly<{ tipo: "SIN_IDENTIFICAR" }>;
    /** El nombre de la condición (`RESPONSABLE_INSCRIPTO`), como lo trae el modelo de impresión. */
    condicionIva: string;
    domicilio: string | null;
    /** «A CONSUMIDOR FINAL», del modelo (versión 2 en adelante). */
    leyenda?: string;
    leyendaDeCondicion?: string; // versión 3: RG 1415 Anexo II A.II
  }>;
  renglones: readonly Readonly<{
    descripcion: string;
    cantidad: string;
    precioUnitario: string;
    alicuota: string | null;
    importe: string;
  }>[];
  totales:
    | Readonly<{
        letra: "A";
        netoPorAlicuota: readonly { alicuota: string; neto: string; iva: string }[];
        exento: string;
        noGravado: string;
        total: string;
      }>
    | Readonly<{ letra: "B"; total: string }>
    | Readonly<{ letra: "C"; total: string }>;
  transparenciaFiscal?: Readonly<{
    titulo: Readonly<{ a4: string; rollo80mm: string }>;
    ivaContenido: Readonly<{
      rotulo: string;
      porAlicuota: readonly { alicuota: string; iva: string }[];
    }>;
    otrosImpuestosNacionalesIndirectos: Readonly<{ rotulo: string; valor: string }>;
  }>;
  contacto?: Readonly<{
    telefono: string | null;
    correo: string | null;
    web: Readonly<{ texto: string; enlace: string }> | null;
  }>;
  asociado: Readonly<{ rotulo: string; letra: string; numero: string; fecha: string }> | null;
  /**
   * Cómo se cargaron los precios unitarios (`ModeloImpreso.modoDePrecio`; la vista solo imprime la versión 2 en adelante, ver `verElModeloDeImpresion`). Solo decide el
   * encabezado de la columna de precio de la factura A: «Precio con IVA» si `IVA_INCLUIDO`, «Precio» si `IVA_DISCRIMINADO`.
   * Previene: rotular con IVA un precio que va sin IVA (o al revés). Chequeo: `test/web/impresion-modelo.test.ts`.
   */
  modoDePrecio?: "IVA_INCLUIDO" | "IVA_DISCRIMINADO";
  /**
   * Las leyendas del modelo (`ModeloImpreso.leyendas`), con su texto tal cual: la fuente única es fiscal (`LEYENDA_DE_HOMOLOGACION`);
   * la vista no tiene clave propia. Previene: que el texto de la leyenda diverja entre el modelo y la hoja.
   */
  leyendas: readonly string[];
  /**
   * Los textos legales de la norma (`ModeloImpreso.leyendasLegales`, versión 2 en adelante; ausente si no aplica), tal cual: se dibujan
   * como texto normal del comprobante, sin recuadro de aviso. La fuente única es fiscal; la vista no tiene clave de catálogo.
   * Previene: que un texto legal se dibuje como aviso de pruebas, o que su texto diverja entre el modelo y la hoja.
   */
  leyendasLegales?: readonly string[];
  /** La sucursal congelada al emitir (`ModeloImpreso.sucursal`; ausente si no la congeló): tal cual, sin rótulo, arriba de la razón social (D-114). */
  sucursal?: Readonly<{ nombre: string }>;
}>;

export type FilaArmada = Readonly<{ rotulo: string | null; valor: string }>;

type ColumnaArmada = Readonly<{
  clave: "descripcion" | "cantidad" | "precio" | "iva" | "importe";
  titulo: string;
  numerica: boolean;
}>;

export type RenglonArmado = Readonly<{
  descripcion: string;
  cantidad: string;
  precio: string;
  /** «IVA 21 %»; `null` si no lleva IVA (letra C, exento, no gravado). */
  iva: string | null;
  importe: string;
  /** «2 × $ 4.500,00 · IVA 21 %»: lo que el ticket pone debajo de la descripción. */
  cuenta: string;
}>;

type TotalArmado = Readonly<{ rotulo: string; valor: string; fuerte: boolean }>;

export type HojaArmada = Readonly<{
  formato: FormatoDeImpresion;
  leyendas: readonly string[];
  /** Los textos legales del modelo, tal cual; vacío si no hay. */
  leyendasLegales: readonly string[];
  nombreDeFantasia: string | null;
  /** El nombre de la sucursal, tal cual (sin trim ni reformateo); `null` si el comprobante no lo trae o la regla de abajo dice que no se imprime. */
  nombreDeLaSucursal: string | null;
  emisor: readonly FilaArmada[];
  /** Teléfono, correo y web sueltos, sin rótulos, separados por « · »; `null` si no hay ninguno. */
  contacto: string | null;
  letra: string;
  codigo: string;
  rotulo: string;
  numero: string;
  datos: readonly FilaArmada[];
  corresponde: string | null;
  receptor: readonly FilaArmada[];
  columnas: readonly ColumnaArmada[];
  renglones: readonly RenglonArmado[];
  rotuloDeTransporte: string;
  rotuloDeATransportar: string;
  totales: readonly TotalArmado[];
  transparencia: Readonly<{ titulo: string; filas: readonly FilaArmada[] }> | null;
  cae: FilaArmada;
}>;

const SEPARADOR = " · ";

/** La alícuota («10.5») lista para «IVA {alicuota} %»; si no es un número, tal cual. */
const alicuotaVisible = (codigo: string): string => formatearAlicuota(codigo) ?? codigo;

/** El texto de la condición frente al IVA; un nombre que el catálogo no conoce se muestra tal cual (nunca se inventa ni se oculta). */
const condicionVisible = (d: DiccionarioResuelto, condicion: string): string =>
  esCondicionIva(condicion) ? texto(d, CLAVE_DE_CONDICION[condicion]) : condicion;

const esCero = (importe: string): boolean => /^-?0+(\.0+)?$/.test(importe);

function contactoDe(contacto: ComprobanteParaLaHoja["contacto"]): string | null {
  if (contacto === undefined) return null;
  const partes = [contacto.telefono, contacto.correo, contacto.web?.texto ?? null].filter(
    (parte): parte is string => parte !== null && parte !== "",
  );
  return partes.length === 0 ? null : partes.join(SEPARADOR);
}

function totalesDe(d: DiccionarioResuelto, c: ComprobanteParaLaHoja): readonly TotalArmado[] {
  const total: TotalArmado = {
    rotulo: texto(d, "fiscal.pantalla.rotulo_total"),
    valor: formatearImporte(c.totales.total),
    fuerte: true,
  };
  if (c.totales.letra !== "A") return [total];
  const filas = c.totales.netoPorAlicuota.flatMap((fila): TotalArmado[] => [
    {
      rotulo: texto(d, "fiscal.pantalla.imprimir_neto_gravado", {
        alicuota: alicuotaVisible(fila.alicuota),
      }),
      valor: formatearImporte(fila.neto),
      fuerte: false,
    },
    {
      rotulo: texto(d, "fiscal.pantalla.renglon_iva", { alicuota: alicuotaVisible(fila.alicuota) }),
      valor: formatearImporte(fila.iva),
      fuerte: false,
    },
  ]);
  // El exento y el no gravado no tienen IVA: sin ellos la suma de las filas no daría el total. Solo si hay.
  const sinIva: [ClaveDeTexto, string][] = [
    ["fiscal.pantalla.anular_alicuota_exento", c.totales.exento],
    ["fiscal.pantalla.anular_alicuota_no_gravado", c.totales.noGravado],
  ];
  for (const [clave, importe] of sinIva) {
    if (!esCero(importe)) {
      filas.push({ rotulo: texto(d, clave), valor: formatearImporte(importe), fuerte: false });
    }
  }
  return [...filas, total];
}

function transparenciaDe(
  c: ComprobanteParaLaHoja,
  formato: FormatoDeImpresion,
): HojaArmada["transparencia"] {
  const t = c.transparenciaFiscal;
  if (t === undefined) return null;
  const porAlicuota = t.ivaContenido.porAlicuota.map((fila) => ({
    rotulo: `${t.ivaContenido.rotulo} ${alicuotaVisible(fila.alicuota)} %`,
    valor: formatearImporte(fila.iva),
  }));
  return {
    titulo: formato === "A4" ? t.titulo.a4 : t.titulo.rollo80mm,
    filas: [
      ...porAlicuota,
      {
        rotulo: t.otrosImpuestosNacionalesIndirectos.rotulo,
        valor: formatearImporte(t.otrosImpuestosNacionalesIndirectos.valor),
      },
    ],
  };
}

function receptorDe(d: DiccionarioResuelto, c: ComprobanteParaLaHoja): readonly FilaArmada[] {
  const { receptor } = c;
  const documento = documentoDe(d, receptor.documento);
  const nombre =
    receptor.nombre ?? receptor.leyenda ?? texto(d, "fiscal.pantalla.consumidor_final");
  return [
    { rotulo: texto(d, "fiscal.pantalla.rotulo_cliente"), valor: nombre },
    ...(documento === null ? [] : [{ rotulo: null, valor: documento }]),
    {
      rotulo: texto(d, "fiscal.pantalla.config_df_condicion_iva"),
      valor: condicionVisible(d, receptor.condicionIva),
    },
    ...filaDeLeyenda(receptor.leyendaDeCondicion),
    ...(receptor.domicilio === null || receptor.domicilio === ""
      ? []
      : [
          {
            rotulo: texto(d, "fiscal.pantalla.config_df_domicilio_fiscal"),
            valor: receptor.domicilio,
          },
        ]),
  ];
}

function columnasDe(d: DiccionarioResuelto, c: ComprobanteParaLaHoja): readonly ColumnaArmada[] {
  const conIva = c.fiscal.letra !== "C";
  const importe: ColumnaArmada = {
    clave: "importe",
    titulo: texto(d, "fiscal.pantalla.imprimir_rotulo_importe"),
    numerica: true,
  };
  const descripcion: ColumnaArmada = {
    clave: "descripcion",
    titulo: texto(d, "fiscal.pantalla.emitir_descripcion"),
    numerica: false,
  };
  const cantidad: ColumnaArmada = {
    clave: "cantidad",
    titulo: texto(d, "fiscal.pantalla.emitir_cantidad"),
    numerica: true,
  };
  if (!conIva) {
    return [
      descripcion,
      cantidad,
      { clave: "precio", titulo: texto(d, "fiscal.pantalla.emitir_precio"), numerica: true },
      importe,
    ];
  }
  // Solo la A puede cargarse sin IVA (la B y la C llevan el IVA incluido).
  const claveDelPrecio =
    c.fiscal.letra === "A" && c.modoDePrecio === "IVA_DISCRIMINADO"
      ? "fiscal.pantalla.emitir_precio"
      : "fiscal.pantalla.emitir_precio_con_iva";
  return [
    descripcion,
    cantidad,
    { clave: "precio", titulo: texto(d, claveDelPrecio), numerica: true },
    { clave: "iva", titulo: texto(d, "fiscal.pantalla.emitir_iva"), numerica: true },
    importe,
  ];
}

function renglonDe(d: DiccionarioResuelto, r: ComprobanteParaLaHoja["renglones"][number]) {
  const alicuota = r.alicuota === null ? null : formatearAlicuota(r.alicuota);
  const iva = alicuota === null ? null : texto(d, "fiscal.pantalla.renglon_iva", { alicuota });
  const precio = formatearImporte(r.precioUnitario);
  const cuenta = texto(d, "fiscal.pantalla.renglon_cuenta", {
    cantidad: formatearCantidad(r.cantidad),
    precio,
  });
  return {
    descripcion: r.descripcion,
    cantidad: formatearCantidad(r.cantidad),
    precio,
    iva,
    importe: formatearImporte(r.importe),
    cuenta: iva === null ? cuenta : `${cuenta}${SEPARADOR}${iva}`,
  } satisfies RenglonArmado;
}

/** «Hoja 2 de 3»: aparte porque `n` se conoce recién cuando el paginador terminó. */
export function textoDeLaHoja(d: DiccionarioResuelto, k: number, n: number): string {
  return texto(d, "fiscal.pantalla.imprimir_hoja", { k: String(k), n: String(n) });
}

/**
 * Se imprime SIEMPRE que el modelo traiga `sucursal` (D-114, opción B del dueño, 2026-11-05): la «regla de una sola sucursal» la aplica
 * el backend al congelar (solo congela el nombre con más de una sucursal abierta al emitir); acá no se repite. Una regla, un lugar.
 * Chequeo: `hoja-a4-sucursal.test.tsx`.
 */
function nombreDeLaSucursalAImprimir(sucursal: ComprobanteParaLaHoja["sucursal"]): string | null {
  return sucursal === undefined ? null : sucursal.nombre;
}

export function armarLaHoja(
  d: DiccionarioResuelto,
  c: ComprobanteParaLaHoja,
  formato: FormatoDeImpresion,
): HojaArmada {
  const e = c.fiscal.emisor;
  const asociado = c.asociado;
  return {
    formato,
    leyendas: c.leyendas,
    leyendasLegales: c.leyendasLegales ?? [],
    nombreDeFantasia: c.marca.nombreDeFantasia,
    nombreDeLaSucursal: nombreDeLaSucursalAImprimir(c.sucursal),
    emisor: [
      { rotulo: texto(d, "fiscal.pantalla.config_df_razon_social"), valor: e.razonSocial },
      { rotulo: texto(d, "fiscal.pantalla.config_df_domicilio_fiscal"), valor: e.domicilioFiscal },
      {
        rotulo: texto(d, "fiscal.pantalla.config_pv_domicilio"),
        valor: e.domicilioDelPuntoDeVenta,
      },
      {
        rotulo: texto(d, "fiscal.pantalla.config_df_condicion_iva"),
        valor: condicionVisible(d, e.condicionIva),
      },
    ],
    contacto: contactoDe(c.contacto),
    letra: c.fiscal.letra,
    codigo: `${texto(d, "fiscal.pantalla.imprimir_codigo")} ${c.fiscal.codigoDelTipo}`,
    rotulo: c.fiscal.rotulo,
    numero: c.fiscal.numero,
    datos: [
      { rotulo: texto(d, "fiscal.pantalla.rotulo_fecha"), valor: formatearFecha(c.fiscal.fecha) },
      { rotulo: texto(d, "fiscal.pantalla.documento_cuit"), valor: e.cuit },
      ...(e.iibbNumero === null || e.iibbNumero === ""
        ? []
        : [{ rotulo: texto(d, "fiscal.pantalla.imprimir_ingresos_brutos"), valor: e.iibbNumero }]),
      {
        rotulo: texto(d, "fiscal.pantalla.config_df_inicio_actividades"),
        valor: formatearFecha(e.inicioDeActividades),
      },
    ],
    corresponde:
      asociado === null
        ? null
        : texto(d, "fiscal.pantalla.corresponde_a", {
            comprobante: texto(d, "fiscal.pantalla.comprobante_con_numero", {
              tipo: asociado.rotulo,
              letra: asociado.letra,
              numero: asociado.numero,
            }),
            fecha: formatearFecha(asociado.fecha),
          }),
    receptor: receptorDe(d, c),
    columnas: columnasDe(d, c),
    renglones: c.renglones.map((r) => renglonDe(d, r)),
    rotuloDeTransporte: texto(d, "fiscal.pantalla.imprimir_transporte"),
    rotuloDeATransportar: texto(d, "fiscal.pantalla.imprimir_a_transportar"),
    totales: totalesDe(d, c),
    transparencia: transparenciaDe(c, formato),
    cae: {
      rotulo: texto(d, "fiscal.pantalla.rotulo_cae"),
      valor: texto(d, "fiscal.pantalla.cae_con_vencimiento", {
        cae: c.fiscal.cae,
        vencimiento: formatearFecha(c.fiscal.caeVence),
      }),
    },
  };
}
