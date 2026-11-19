import type { ClaveDeTexto } from "../../../../../src/capacidades/vocabulario/catalogo";
import { texto } from "../../../../../src/capacidades/vocabulario/vocabulario";
import { MAXIMO_DE_CUOTAS, cuotasDesdeTexto } from "../../../../../src/primitivas/cantidad/cuotas";
import { FORMA_DEL_IMPORTE } from "../../../../../src/primitivas/dinero/forma-del-importe";
import {
  TIPO_DE_MEDIO_CON_VUELTO,
  calcularVuelto,
  type Vuelto,
} from "../../../../../src/primitivas/dinero/vuelto";
import { FORMATO_DE_DNI } from "../../../../../src/primitivas/identificacion-fiscal/documento";
import { motivoDelCupon } from "../../../../../src/primitivas/texto/cupon-de-pago";
import { ultimosCuatroDigitosDesdeTexto } from "../../../../../src/primitivas/texto/ultimos-cuatro-digitos";
import { nombreDelTipo } from "../caja/modelo-de-medios-de-pago";
import type { LineaDeLaVenta } from "../venta/modelo-de-la-cuenta";
import { deDiezmilesimos } from "../venta/modelo-de-venta-rapida";

/**
 * El modelo de vista de la hoja de COBRAR (maqueta `venta-rapida-v4.html`, zona cobro): qué filas de pago hay, qué datos admite cada medio, si cada dato está bien escrito, cuánto falta o
 * sobra, cuál es el vuelto y qué pedido sale para el servidor. Puro: sin React ni servidor. Los textos salen del catálogo (`ventas.cobro.*`, cada uno con su fuente en `catalogo-ventas.ts`).
 *
 * El vuelto es PRESENTACIÓN (decisión 173): lo calcula `calcularVuelto` (una sola cuenta, en `primitivas/dinero`) y al servidor viaja lo que queda en caja, el neto en efectivo; el servidor
 * sigue exigiendo que los cobros sumen el total al centavo y rechaza cualquier sobrante. Ningún importe se suma acá con `number`: todo es texto decimal y enteros exactos por dentro. Lo que
 * esta pantalla rechaza (un dato mal escrito) es una ayuda: el servidor vuelve a validar todo y su respuesta es la que manda.
 */

// ─── Lo que entrega el servidor (la misma forma, sin importar de dónde venga) ────────────────────────────

export type DatosQuePideElMedio = Readonly<{
  cupon: boolean;
  ultimos4: boolean;
  marca: boolean;
  cuotas: boolean;
  dni: boolean;
}>;

export type MedioParaCobrar = Readonly<{
  id: string;
  tipo: string;
  nombre: string | null;
  cuentas: readonly Readonly<{ id: string; tipo: string; nombre: string }>[];
  datosQuePide: DatosQuePideElMedio;
  datosQueSePiden: DatosQuePideElMedio; // De los que pide, cuáles «se piden»: se pueden dejar vacíos (PR-7).
}>;

export type OpcionesParaCobrar = Readonly<{
  medios: readonly MedioParaCobrar[];
  marcasDeTarjeta: readonly Readonly<{ id: string; nombre: string }>[];
}>;

/**
 * Lo que la página resuelve ANTES de abrir la hoja (el servidor decide, la pantalla solo lo muestra): `LISTO` con la caja y sus opciones; `ABRIR_LA_CAJA` si la sucursal tiene caja pero ninguna
 * sesión abierta; `NO_PERMITIDO` en cualquier otro caso (el día en cierre o cerrado, la caja en cierre, sin caja, más de una abierta, una lectura que falló): nunca se asume nada.
 */
export type CobroPreparado =
  | Readonly<{ estado: "LISTO"; cajaId: string; opciones: OpcionesParaCobrar }>
  | Readonly<{ estado: "ABRIR_LA_CAJA" }>
  | Readonly<{ estado: "NO_PERMITIDO"; jornadaAbierta: boolean }>;

// ─── Los datos opcionales de un cobro ──────────────────────────────────────────────────────────────────

export type DatoDelMedio = keyof DatosQuePideElMedio;

/** El orden en que se ofrecen los datos: el del servidor (`datos-del-cobro.ts`, `CAMPOS`). */
export const DATOS_EN_ORDEN: readonly DatoDelMedio[] = [
  "cupon",
  "ultimos4",
  "marca",
  "cuotas",
  "dni",
];

/** Lo que se escribió en cada dato; `""` es «no se escribió» (ausente, válido). */
export type DatosEscritos = Readonly<Record<DatoDelMedio, string>>;

export const SIN_DATOS: DatosEscritos = { cupon: "", ultimos4: "", marca: "", cuotas: "", dni: "" };

/** Los textos de error de un dato mal escrito (aprobados, `datos-cobro.html`): una clave por motivo. */
const ERRORES_DE_DATO = {
  CUPON_ES_TARJETA: "ventas.cobro.error.cupon_es_tarjeta",
  CUPON_INVALIDO: "ventas.cobro.error.cupon_invalido",
  ULTIMOS4: "ventas.cobro.error.ultimos4",
  CUOTAS: "ventas.cobro.error.cuotas",
  DNI: "ventas.cobro.error.dni",
} as const satisfies Readonly<Record<string, ClaveDeTexto>>;

export type ErrorDeDato = keyof typeof ERRORES_DE_DATO;

/**
 * Por qué un dato no está bien escrito, o `null` si lo está. Vacío es válido (ausente): ningún dato bloquea. Las reglas son las de las primitivas (una regla, un lugar), las mismas que
 * aplica caja dentro de la transacción: el cupón (largo, lista permitida, sin espacios, nunca un número de tarjeta), 4 dígitos, cuotas de 1 al tope y el DNI sin puntos.
 */
export function errorDeUnDato(dato: DatoDelMedio, valor: string): ErrorDeDato | null {
  if (valor === "") return null;
  switch (dato) {
    case "cupon": {
      const motivo = motivoDelCupon(valor);
      if (motivo === null) return null;
      return motivo === "NUMERO_DE_TARJETA" ? "CUPON_ES_TARJETA" : "CUPON_INVALIDO";
    }
    case "ultimos4":
      return ultimosCuatroDigitosDesdeTexto(valor).ok ? null : "ULTIMOS4";
    case "cuotas":
      return cuotasDesdeTexto(valor).ok ? null : "CUOTAS";
    case "dni":
      return FORMATO_DE_DNI.test(valor) ? null : "DNI";
    case "marca":
      // La marca se elige de la lista del servidor: no se escribe, así que no hay forma de escribirla mal.
      return null;
  }
}

/** El texto de un error de dato (con el tope de cuotas, que vive en la primitiva). */
export const textoDelErrorDeDato = (error: ErrorDeDato): string =>
  texto({}, ERRORES_DE_DATO[error], { maximo: String(MAXIMO_DE_CUOTAS) });

// ─── Las filas de pago ────────────────────────────────────────────────────────────────────────────────────

/** Una fila de la hoja: lo que se eligió y se escribió, no lo que se cobra. El importe es el texto decimal canónico (`"1234.50"`) o `""`. */
export type PagoEnEdicion = Readonly<{
  /** Identifica la fila en la pantalla (no viaja al servidor). */
  clave: string;
  medioId: string;
  /** `""` = sin cuenta (la cuenta de cobro es opcional, decisión 151). */
  cuentaId: string;
  importe: string;
  /** Pasa a `true` apenas se toca el importe: el error «Importe no válido» no se muestra antes. */
  tocado: boolean;
  datos: DatosEscritos;
}>;

/** Una fila nueva con ese medio y ese importe. */
export const pagoNuevo = (clave: string, medioId: string, importe: string): PagoEnEdicion => ({
  clave,
  medioId,
  cuentaId: "",
  importe,
  tocado: false,
  datos: SIN_DATOS,
});

/** El primer medio que se ofrece: el efectivo si existe (lo que se espera en un mostrador) y, si no, el primero de la lista. `null` si el servidor no ofrece ninguno. */
export function medioInicial(medios: readonly MedioParaCobrar[]): MedioParaCobrar | null {
  return medios.find((m) => m.tipo === TIPO_DE_MEDIO_CON_VUELTO) ?? medios[0] ?? null;
}

/** Cambia el medio de una fila: lo que el medio nuevo no admite se descarta (la pantalla no ofrece lo que el servidor rechazaría), y la cuenta se conserva solo si es de ese medio. */
export function cambiarDeMedio(pago: PagoEnEdicion, medio: MedioParaCobrar): PagoEnEdicion {
  const datos = Object.fromEntries(
    DATOS_EN_ORDEN.map((d) => [d, medio.datosQuePide[d] ? pago.datos[d] : ""]),
  ) as unknown as DatosEscritos;
  return {
    ...pago,
    medioId: medio.id,
    cuentaId: medio.cuentas.some((c) => c.id === pago.cuentaId) ? pago.cuentaId : "",
    datos,
  };
}

/** La fila que agrega «Agregar otro medio»: el primer medio que todavía no se usa (o el inicial si ya se usaron todos) con lo que falta cobrar como importe. `null` si el servidor no ofrece ningún medio. */
export function pagoAdicional(
  clave: string,
  medios: readonly MedioParaCobrar[],
  pagos: readonly PagoEnEdicion[],
  falta: string | null,
): PagoEnEdicion | null {
  const elegido =
    medios.find((m) => !pagos.some((p) => p.medioId === m.id)) ?? medioInicial(medios);
  if (elegido === null) return null;
  return pagoNuevo(clave, elegido.id, falta === null || esCero(falta) ? "" : falta);
}

export const cambiarUnDato = (
  pago: PagoEnEdicion,
  dato: DatoDelMedio,
  valor: string,
): PagoEnEdicion => ({ ...pago, datos: { ...pago.datos, [dato]: valor } });

/** El texto de un medio: su nombre propio, o el de su tipo (nunca se esconde un medio por no saber nombrarlo). */
export const nombreDelMedio = (medio: MedioParaCobrar): string =>
  medio.nombre ?? nombreDelTipo(medio.tipo);

// ─── El estado del cobro ─────────────────────────────────────────────────────────────────────────────────

const IMPORTE_EN_CERO = /^0+(\.0+)?$/;

/** ¿Es un importe que el servidor aceptaría para UN cobro? Forma de importe y mayor que cero. */
export const esImporteValido = (importe: string): boolean =>
  FORMA_DEL_IMPORTE.test(importe) && !IMPORTE_EN_CERO.test(importe);

export type EstadoDeUnaFila = Readonly<{
  clave: string;
  importeNoValido: boolean;
  /** Solo los datos que el medio admite y que están mal escritos. */
  erroresDeDatos: Readonly<Partial<Record<DatoDelMedio, ErrorDeDato>>>;
}>;

export type EstadoDelCobro = Readonly<{
  filas: readonly EstadoDeUnaFila[];
  /** `null` mientras alguna fila no tiene un importe válido (no hay cuenta que mostrar). */
  vuelto: Vuelto | null;
  /** Se puede cobrar: todas las filas válidas, sin datos mal escritos y el total cubierto justo (con o sin vuelto). No mira la caja ni la conexión. */
  listo: boolean;
}>;

/** Los datos que cuentan: los que el medio admite, en el orden del servidor. */
const datosAdmitidos = (medio: MedioParaCobrar | undefined): readonly DatoDelMedio[] =>
  medio === undefined ? [] : DATOS_EN_ORDEN.filter((d) => medio.datosQuePide[d]);

/** Lo que el medio pide («se pide») y la fila dejó vacío: INFORMATIVO, no entra en `listo` (dueño, 18/11/2026: se advierte, no se exige); el pendiente real lo sella el servidor. */
export function datosPendientes(
  medio: MedioParaCobrar | undefined,
  pago: PagoEnEdicion,
): readonly DatoDelMedio[] {
  // Sin medio no hay datos admitidos (la lista sale vacía) y el filtro no corre.
  return datosAdmitidos(medio).filter(
    (d) => (medio as MedioParaCobrar).datosQueSePiden[d] && pago.datos[d].trim() === "",
  );
}

export function estadoDelCobro(
  total: Readonly<{ moneda: string; monto: string }>,
  pagos: readonly PagoEnEdicion[],
  medios: readonly MedioParaCobrar[],
): EstadoDelCobro {
  const medioDe = (pago: PagoEnEdicion) => medios.find((m) => m.id === pago.medioId);
  const filas = pagos.map((pago): EstadoDeUnaFila => {
    const erroresDeDatos: Partial<Record<DatoDelMedio, ErrorDeDato>> = {};
    for (const dato of datosAdmitidos(medioDe(pago))) {
      const error = errorDeUnDato(dato, pago.datos[dato]);
      if (error !== null) erroresDeDatos[dato] = error;
    }
    return { clave: pago.clave, importeNoValido: !esImporteValido(pago.importe), erroresDeDatos };
  });
  // Que haya de 1 al tope de filas lo juzga `calcularVuelto` (PAGOS_INVALIDOS): una sola regla.
  const todasConMedioEImporte = pagos.every(
    (p) => medioDe(p) !== undefined && esImporteValido(p.importe),
  );
  const vuelto = todasConMedioEImporte
    ? calcularVuelto({
        total,
        pagos: pagos.map((p) => ({
          tipo: (medioDe(p) as MedioParaCobrar).tipo,
          importe: { moneda: total.moneda, monto: p.importe },
        })),
      })
    : null;
  const cuenta = vuelto?.ok === true ? vuelto.valor : null;
  const sinDatosMalos = filas.every((f) => Object.keys(f.erroresDeDatos).length === 0);
  return {
    filas,
    vuelto: cuenta,
    listo: cuenta !== null && sinDatosMalos && esCero(cuenta.falta) && esCero(cuenta.sobra),
  };
}

const esCero = (importe: string): boolean => IMPORTE_EN_CERO.test(importe);

/** Lo que falta cobrar (si falta), lo que sobra sin vuelto (si sobra), el vuelto (si hay) o nada: la línea de estado de la hoja. */
export type LineaDeEstado =
  | Readonly<{ tipo: "VUELTO"; importe: string }>
  | Readonly<{ tipo: "FALTA"; importe: string }>
  | Readonly<{ tipo: "SOBRA"; importe: string }>
  | Readonly<{ tipo: "COMPLETO" }>
  | null;

export function lineaDeEstado(vuelto: Vuelto | null): LineaDeEstado {
  if (vuelto === null) return null;
  if (!esCero(vuelto.vuelto)) return { tipo: "VUELTO", importe: vuelto.vuelto };
  if (!esCero(vuelto.falta)) return { tipo: "FALTA", importe: vuelto.falta };
  if (!esCero(vuelto.sobra)) return { tipo: "SOBRA", importe: vuelto.sobra };
  return { tipo: "COMPLETO" };
}

// ─── El pedido al servidor ───────────────────────────────────────────────────────────────────────────────

/** Los identificadores de UNA venta: los genera la pantalla una vez y los repite en cada reintento (idempotencia, e4 §3.7). */
export type IdsDeLaVenta = Readonly<{
  cuentaId: string;
  ejemplarId: string;
  /** El id de cada línea, por la clave de la línea de la cuenta. */
  lineas: ReadonlyMap<string, string>;
}>;

export type EntradaDelPedido = Readonly<{
  ids: IdsDeLaVenta;
  cajaId: string;
  cuenta: readonly LineaDeLaVenta[];
  total: Readonly<{ moneda: string; monto: string }>;
  pagos: readonly PagoEnEdicion[];
  medios: readonly MedioParaCobrar[];
  vuelto: Vuelto;
}>;

/**
 * El pedido de cobro (la forma de `entradas-de-cobrar.ts`, que el servidor vuelve a leer con lista de permitidos). Cada fila va como se escribió, salvo el efectivo: todas las filas de efectivo
 * se juntan en la primera con el NETO (lo entregado menos el vuelto) y si el neto es cero no va ninguna. Los datos que el medio no admite o que no se escribieron no viajan. Devuelve `null` si
 * no hay nada que mandar (sin filas o con un medio que el servidor no ofreció): nunca un pedido a medias.
 */
export function pedidoDeCobro(entrada: EntradaDelPedido): Readonly<Record<string, unknown>> | null {
  const { pagos, medios, vuelto, total } = entrada;
  const medioDe = (pago: PagoEnEdicion) => medios.find((m) => m.id === pago.medioId);
  const primeraDeEfectivo = pagos.find((p) => medioDe(p)?.tipo === TIPO_DE_MEDIO_CON_VUELTO);
  const cobros: Record<string, unknown>[] = [];
  for (const pago of pagos) {
    const medio = medioDe(pago);
    if (medio === undefined) return null;
    const esEfectivo = medio.tipo === TIPO_DE_MEDIO_CON_VUELTO;
    if (esEfectivo && pago !== primeraDeEfectivo) continue;
    const monto = esEfectivo ? vuelto.netoEnEfectivo : pago.importe;
    if (!esImporteValido(monto)) continue;
    cobros.push({
      medioDePagoId: pago.medioId,
      cuentaDeCobroId: pago.cuentaId === "" ? null : pago.cuentaId,
      importe: { moneda: total.moneda, monto },
      ...datosParaEnviar(pago, medio),
    });
  }
  const lineas = entrada.cuenta.map((l) => {
    const lineaId = entrada.ids.lineas.get(l.clave);
    return lineaId === undefined
      ? null
      : {
          lineaId,
          productoId: l.productoId,
          ...(l.varianteId === null ? {} : { varianteId: l.varianteId }),
          opcionIds: l.opcionIds,
          cantidad: deDiezmilesimos(l.cantidad),
        };
  });
  if (cobros.length === 0 || lineas.length === 0 || lineas.includes(null)) return null;
  return {
    cuentaId: entrada.ids.cuentaId,
    ejemplarId: entrada.ids.ejemplarId,
    lineas,
    totalEsperado: { moneda: total.moneda, monto: total.monto },
    cajaId: entrada.cajaId,
    cobros,
  };
}

/** `{ datos }` con solo lo escrito y admitido por el medio, o nada. Las cuotas son un conteo entero: viajan como número (`cuotas.ts`). */
function datosParaEnviar(
  pago: PagoEnEdicion,
  medio: MedioParaCobrar,
):
  Readonly<{ datos: Readonly<Record<string, string | number>> }> | Readonly<Record<string, never>> {
  const datos: Record<string, string | number> = {};
  for (const dato of datosAdmitidos(medio)) {
    const valor = pago.datos[dato];
    if (valor === "") continue;
    if (dato === "marca") datos["marcaDeTarjetaId"] = valor;
    else if (dato === "cuotas") datos["cuotas"] = Number(valor);
    else datos[dato] = valor;
  }
  return Object.keys(datos).length === 0 ? {} : { datos };
}

// ─── El resultado ────────────────────────────────────────────────────────────────────────────────────────

/** Lo que vuelve de cobrar (`cobrarLaVenta`). */
export type VentaCobrada = Readonly<{
  ticketId: string;
  ejemplarId: string;
  numero: number;
  estado: string;
  total: Readonly<{ moneda: string; monto: string }>;
  cobros: readonly Readonly<{
    medioDePagoId: string;
    cuentaDeCobroId: string | null;
    importe: Readonly<{ moneda: string; monto: string }>;
  }>[];
}>;

/** Lo que vuelve de anular (`anularElTicket`). */
export type TicketAnulado = Readonly<{
  ticketId: string;
  numero: number;
  estado: string;
}>;

export type LineaDelResumen = Readonly<{ rotulo: string; monto: string }>;

/**
 * El resumen del resultado (maqueta): cada cobro con su medio (y su cuenta, si tiene) y su importe, tal como quedó en caja. Un medio o una cuenta que ya no figuran en las opciones se dicen
 * con lo que se sabe (nunca se esconde un cobro).
 */
export function resumenDelCobro(
  venta: VentaCobrada,
  medios: readonly MedioParaCobrar[],
): readonly LineaDelResumen[] {
  return venta.cobros.map((c) => {
    const medio = medios.find((m) => m.id === c.medioDePagoId);
    const cuenta = medio?.cuentas.find((x) => x.id === c.cuentaDeCobroId)?.nombre;
    const nombre = medio === undefined ? "" : nombreDelMedio(medio);
    return {
      rotulo: cuenta === undefined ? nombre : `${nombre} · ${cuenta}`,
      monto: c.importe.monto,
    };
  });
}
