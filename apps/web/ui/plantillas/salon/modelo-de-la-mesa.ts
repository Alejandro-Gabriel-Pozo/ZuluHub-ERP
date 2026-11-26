import {
  texto,
  type DiccionarioResuelto,
} from "../../../../../src/capacidades/vocabulario/vocabulario";
import {
  importeAJson,
  importeDesdeJson,
  sumar,
} from "../../../../../src/primitivas/dinero/importe";
import { formatearCantidad, formatearImporte } from "../../patrones/formato-fiscal";
import {
  lineasParaDividir,
  type CuentaHijaArmada,
  type LineaParaDividir,
} from "./modelo-de-dividir";
import { conNumero } from "./textos-de-dividir";

/**
 * El modelo de vista de la ficha de la mesa (SAL-B; maqueta `salon.html`, orden de salida `salida.html`, aprobadas el 09/11/2026): de lo que entrega el servidor (`cargarLaFichaDeLaMesa`), lo que se ve y NADA más.
 * Puro: sin React ni servidor. Los textos salen del catálogo (`salon.texto.*`, `comandas.texto.*`, `ventas.venta.*`); no se arma ningún texto nuevo, solo se eligen los aprobados.
 *
 * Reglas (cada una con su prueba en `test/web/salon-mesa-modelo.test.ts`):
 *  - **Tres modos y solo uno ofrece acciones**: mesa libre («Tomar pedido»), mesa con UNA cuenta (agregar, quitar, orden de salida, liberar, cambiar de mesa) y mesa de solo lectura (unida o dividida: su unir y su
 *    dividir son otros PR; sin acciones). Cualquier otra forma (varias cuentas sin ser hijas, estado desconocido) también es de solo lectura: ante la duda no se ofrece nada.
 *  - **Los platos se agrupan por su estado de comanda**: «Para enviar», «Esperan para después» y «Enviadas», en ese orden y solo los grupos que tienen platos. Solo un plato todavía no enviado se puede quitar
 *    o cambiar de «Sale ahora» a «Sale después»; uno enviado no ofrece ni lo uno ni lo otro (para eso, anular el ítem enviado: SAL-C).
 *  - **«Liberar mesa» solo con la cuenta sin ningún plato**; con platos no se ofrece (el servidor también lo rechaza).
 *  - **El dinero llega como texto decimal con su moneda** y se muestra con `formatearImporte`; la cantidad, con `formatearCantidad`. Nunca pasa por `number`. Una moneda distinta de ARS no se muestra como pesos.
 *  - **Nada de precios calculados acá**: el importe de cada plato y el total son los que da el servidor.
 */

type Importe = Readonly<{ moneda: string; monto: string }>;

export type LineaDeLaFichaDeLaPantalla = Readonly<{
  lineaId: string;
  posicion: number;
  descripcion: string;
  varianteNombre: string | null;
  cantidad: string;
  precioUnitario: string;
  pasoDeCantidad: string;
  importe: string;
  compartida: boolean;
  comanda: string;
  numeroDeEnvio: number | null;
  envioId: string | null;
  deLaMesa: number | null;
}>;

type CuentaDeLaFichaDeLaPantalla = Readonly<{
  cuentaId: string;
  parte: number | null;
  cobrada: boolean;
  total: Importe;
  lineas: readonly LineaDeLaFichaDeLaPantalla[];
}>;

/** La ficha de la mesa como la entrega la composición (la UI no importa los módulos). */
export type FichaDeLaMesaDeLaPantalla = Readonly<{
  mesaId: string;
  numero: number;
  estado: string;
  unidaAMesa: number | null;
  cuentas: readonly CuentaDeLaFichaDeLaPantalla[];
}>;

const MONEDA = "ARS";

/** Los textos de la ficha de la mesa ya resueltos: viajan al navegador como datos (una función no cruza esa frontera). */
export type TextosDeLaMesa = Readonly<{
  mesaLibre: string;
  tomarPedido: string;
  sinPedido: string;
  liberar: string;
  cambiarDeMesa: string;
  unirConOtraMesa: string;
  confirmarUnion: string;
  cuantoQueda: string;
  noSeDeshace: string;
  noSePuedenUnir: string;
  pasarALaMesa: string;
  noHayMesasLibres: string;
  agregar: string;
  total: string;
  cuandoSale: string;
  saleAhora: string;
  saleDespues: string;
  quitar: string;
  cancelar: string;
  cerrar: string;
  enviarACocina: string;
  cobrar: string;
  enviadoACocina: string;
  pedirQueSalga: string;
  pedirQueSalgaTodo: string;
  anular: string;
  motivo: string;
  cantidad: string;
  reimprimir: string;
  seImprimeUnaCopia: string;
  configurarImpresoras: string;
  itemAnulado: string;
}>;

export function textosDeLaMesa(d: DiccionarioResuelto = {}): TextosDeLaMesa {
  return {
    mesaLibre: texto(d, "salon.texto.mesa_mesa_libre"),
    tomarPedido: texto(d, "salon.texto.mesa_tomar_pedido"),
    sinPedido: texto(d, "salon.texto.mesa_la_mesa_no_tiene_pedido"),
    liberar: texto(d, "salon.texto.mesa_liberar_mesa"),
    cambiarDeMesa: texto(d, "salon.texto.mesa_cambiar_de_mesa"),
    unirConOtraMesa: texto(d, "salon.texto.unir_unir_con_otra_mesa"),
    confirmarUnion: texto(d, "salon.texto.unir_unir_ahora"),
    cuantoQueda: texto(d, "salon.texto.unir_cuanto_queda"),
    noSeDeshace: texto(d, "salon.texto.unir_esto_no_se_deshace_para_separar_se_divide_la_cuent"),
    noSePuedenUnir: texto(d, "salon.texto.unir_no_se_pueden_unir"),
    pasarALaMesa: texto(d, "salon.texto.mesa_pasar_a_la_mesa"),
    noHayMesasLibres: texto(d, "salon.texto.mesa_no_hay_mesas_libres"),
    agregar: texto(d, "ventas.venta.agregar"),
    total: texto(d, "ventas.venta.total"),
    cuandoSale: texto(d, "comandas.texto.salida_cuando_sale"),
    saleAhora: texto(d, "comandas.texto.salida_sale_ahora"),
    saleDespues: texto(d, "comandas.texto.salida_sale_despues"),
    quitar: texto(d, "comandas.texto.salida_quitar"),
    cancelar: texto(d, "ventas.venta.cancelar"),
    cerrar: texto(d, "vidriera.producto.cerrar"),
    enviarACocina: texto(d, "comandas.texto.envio_enviar_a_cocina"),
    cobrar: texto(d, "ventas.cobro.cobrar"),
    enviadoACocina: texto(d, "comandas.texto.envio_enviado_a_cocina"),
    pedirQueSalga: texto(d, "comandas.texto.salida_pedir_que_salga"),
    pedirQueSalgaTodo: texto(d, "comandas.texto.salida_pedir_que_salga_todo"),
    anular: texto(d, "comandas.texto.anulacion_anular"),
    motivo: texto(d, "comandas.texto.anulacion_motivo"),
    cantidad: texto(d, "ventas.venta.cantidad"),
    reimprimir: texto(d, "comandas.texto.envio_reimprimir"),
    seImprimeUnaCopia: texto(
      d,
      "comandas.texto.imprimir_se_imprime_una_copia_con_la_hora_del_envio_origina",
    ),
    configurarImpresoras: texto(d, "comandas.texto.imprimir_configurar_impresoras"),
    itemAnulado: texto(d, "comandas.texto.envio_item_anulado"),
  };
}

const GRUPOS = [
  { comanda: "PARA_ENVIAR", clave: "comandas.texto.salida_para_enviar" },
  { comanda: "ESPERA", clave: "comandas.texto.salida_esperan_para_despues" },
  { comanda: "ENVIADA", clave: "comandas.texto.salida_enviadas" },
] as const;

type GrupoDeComanda = (typeof GRUPOS)[number]["comanda"];

export type PlatoArmado = Readonly<{
  id: string;
  /** «2 × Milanesa · Grande». */
  nombre: string;
  /** «Envío 1», «De la mesa 3» o «Compartido» (textos aprobados); vacío si no aplica. */
  nota: string;
  importe: string | null;
  /** Solo un plato todavía no enviado: «Sale ahora» (`AHORA`) o «Sale después» (`DESPUES`). */
  salida: "AHORA" | "DESPUES" | null;
  quitable: boolean;
  /** La cantidad tal como la guarda la cuenta, como texto decimal sin ceros de más («2», «1.5»): es lo que se propone al anular. */
  cantidad: string;
  /** El envío en que salió; `null` si todavía no se envió. */
  envioId: string | null;
}>;

type GrupoArmado = Readonly<{
  comanda: GrupoDeComanda;
  titulo: string;
  platos: readonly PlatoArmado[];
}>;

export type MesaArmada = Readonly<{
  /** «Mesa 7». */
  titulo: string;
  modo: "LIBRE" | "CON_CUENTA" | "SOLO_LECTURA";
  /** «Unida a la mesa 5»; `null` si no está unida. */
  unida: string | null;
  /** Las cuentas de una mesa dividida, por número; vacío si no. */
  cuentasHijas: readonly CuentaHijaArmada[];
  /** Las líneas a repartir en «Dividir la cuenta»; vacío si la mesa no se puede dividir (con platos sin enviar, sin platos o sin total en pesos). */
  paraDividir: readonly LineaParaDividir[];
  cuentaId: string | null;
  /** «$ 1.234,56»; `null` si no hay cuenta (o su moneda no es ARS). */
  total: string | null;
  /** El total tal como lo guarda la cuenta (texto decimal con su moneda): es el `totalEsperado` de «Cobrar»; `null` si no hay cuenta o su moneda no es ARS. */
  totalACobrar: Importe | null;
  grupos: readonly GrupoArmado[];
  /** Los envíos de la cuenta, por número y sin repetir («Envío 1»): de cada uno se puede pedir una copia. */
  envios: readonly Readonly<{ envioId: string; titulo: string }>[];
  /** Hay platos «Para enviar» (se ofrece «Enviar a cocina»). */
  hayParaEnviar: boolean;
  /** Los platos que esperan (para «Pedir que salga todo»). */
  hayEnEspera: boolean;
  /** Una cuenta sin ningún plato: se muestra «La mesa no tiene pedido» y se ofrece «Liberar mesa». */
  sinPlatos: boolean;
}>;

const importeDe = (i: Importe | undefined): string | null =>
  i === undefined || i.moneda !== MONEDA ? null : formatearImporte(i.monto);

/** «Envío 1»: `comandas.texto.envio_envio_n` dice «Envío N» (la N final es el lugar del número). */
const numeroDeEnvio = (d: DiccionarioResuelto, numero: number): string => {
  const rotulo = texto(d, "comandas.texto.envio_envio_n");
  return rotulo.endsWith("N")
    ? `${rotulo.slice(0, -1)}${String(numero)}`
    : `${rotulo} ${String(numero)}`;
};

/** «Envío 1», con los textos aprobados por defecto (para lo que arma la pantalla en el navegador, que no recibe un diccionario). */
export const tituloDelEnvio = (numero: number): string => numeroDeEnvio({}, numero);

/** «2.0000» pasa a «2» y «1.5000» a «1.5», sin pasar por `number`. */
const sinCerosDeMas = (cantidad: string): string =>
  cantidad.includes(".") ? cantidad.replace(/0+$/, "").replace(/\.$/, "") : cantidad;

function armarElPlato(d: DiccionarioResuelto, l: LineaDeLaFichaDeLaPantalla): PlatoArmado {
  const enviado = l.comanda === "ENVIADA";
  const variante = l.varianteNombre === null ? "" : ` · ${l.varianteNombre}`;
  const notas = [
    l.numeroDeEnvio === null ? "" : numeroDeEnvio(d, l.numeroDeEnvio),
    l.deLaMesa === null ? "" : `${texto(d, "salon.texto.unir_de_la_mesa")} ${String(l.deLaMesa)}`,
    l.compartida ? texto(d, "salon.texto.unir_compartido") : "",
  ].filter((n) => n !== "");
  return {
    id: l.lineaId,
    nombre: `${formatearCantidad(l.cantidad)} × ${l.descripcion}${variante}`,
    nota: notas.join(" · "),
    importe: l.compartida ? null : formatearImporte(l.importe),
    salida: enviado ? null : l.comanda === "ESPERA" ? "DESPUES" : "AHORA",
    quitable: !enviado,
    cantidad: sinCerosDeMas(l.cantidad),
    envioId: l.envioId,
  };
}

/** Arma la ficha de la mesa. Una mesa libre, de una sola cuenta o de solo lectura (unida, dividida o de una forma que esta pantalla no conoce). */
export function armarLaMesa(d: DiccionarioResuelto, ficha: FichaDeLaMesaDeLaPantalla): MesaArmada {
  const titulo = texto(d, "salon.texto.admin_mesa_numero", { numero: String(ficha.numero) });
  const base = {
    titulo,
    unida: null,
    cuentasHijas: [],
    paraDividir: [],
    cuentaId: null,
    total: null,
    totalACobrar: null,
    grupos: [],
    envios: [],
    hayParaEnviar: false,
    hayEnEspera: false,
    sinPlatos: false,
  } as const;
  if (ficha.estado === "UNIDA") {
    return {
      ...base,
      modo: "SOLO_LECTURA",
      unida:
        ficha.unidaAMesa === null
          ? texto(d, "salon.texto.unir_unida_a_la_mesa")
          : `${texto(d, "salon.texto.unir_unida_a_la_mesa")} ${String(ficha.unidaAMesa)}`,
    };
  }
  if (ficha.estado === "LIBRE" && ficha.cuentas.length === 0) return { ...base, modo: "LIBRE" };
  const [unica] = ficha.cuentas;
  const conUnaCuenta =
    (ficha.estado === "EN_PEDIDO" || ficha.estado === "OCUPADA") &&
    ficha.cuentas.length === 1 &&
    unica !== undefined &&
    unica.parte === null;
  if (!conUnaCuenta) {
    return {
      ...base,
      modo: "SOLO_LECTURA",
      cuentasHijas: ficha.cuentas
        .flatMap((c) => (c.parte === null ? [] : [{ c, parte: c.parte }]))
        .sort((a, b) => a.parte - b.parte)
        .map(({ c, parte }) => ({
          cuentaId: c.cuentaId,
          titulo: conNumero(texto(d, "salon.texto.dividir_cuenta_n"), parte),
          importe: importeDe(c.total),
          totalACobrar: c.total.moneda === MONEDA ? c.total : null,
          cobrada: c.cobrada,
          cobrable:
            !c.cobrada &&
            c.total.moneda === MONEDA &&
            c.lineas.length > 0 &&
            c.lineas.every((l) => l.comanda === "ENVIADA"),
        })),
    };
  }
  const platos = unica.lineas.map((l) => ({ l, plato: armarElPlato(d, l) }));
  const envios = new Map<number, string>();
  for (const { l } of platos) {
    if (l.numeroDeEnvio !== null && l.envioId !== null) envios.set(l.numeroDeEnvio, l.envioId);
  }
  return {
    ...base,
    modo: "CON_CUENTA",
    cuentaId: unica.cuentaId,
    total: importeDe(unica.total),
    totalACobrar:
      unica.total.moneda === MONEDA
        ? { moneda: unica.total.moneda, monto: unica.total.monto }
        : null,
    sinPlatos: platos.length === 0,
    paraDividir:
      platos.length > 0 &&
      unica.total.moneda === MONEDA &&
      platos.every((p) => p.l.comanda === "ENVIADA")
        ? lineasParaDividir(unica.lineas)
        : [],
    hayParaEnviar: platos.some((p) => p.l.comanda === "PARA_ENVIAR"),
    hayEnEspera: platos.some((p) => p.l.comanda === "ESPERA"),
    envios: [...envios.entries()]
      .sort(([a], [b]) => a - b)
      .map(([numero, envioId]) => ({ envioId, titulo: numeroDeEnvio(d, numero) })),
    grupos: GRUPOS.flatMap((g) => {
      const de = platos.filter((p) => p.l.comanda === g.comanda).map((p) => p.plato);
      return de.length === 0 ? [] : [{ comanda: g.comanda, titulo: texto(d, g.clave), platos: de }];
    }),
  };
}

/** Una mesa libre para «Cambiar de mesa»: de las que devuelve el mapa con el filtro «Libres», por número. */
export type MesaLibre = Readonly<{ id: string; titulo: string }>;

export function mesasLibresParaElCambio(
  d: DiccionarioResuelto,
  mesas: readonly Readonly<{ mesaId: string; numero: number; estado: string }>[],
  mesaActual: string,
): readonly MesaLibre[] {
  return mesas
    .filter((m) => m.estado === "LIBRE" && m.mesaId !== mesaActual)
    .map((m) => ({
      id: m.mesaId,
      titulo: texto(d, "salon.texto.admin_mesa_numero", { numero: String(m.numero) }),
      numero: m.numero,
    }))
    .sort((a, b) => a.numero - b.numero)
    .map(({ id, titulo }) => ({ id, titulo }));
}

/** Una mesa con cuenta a la que se puede unir la actual: su cuenta (el destino) y su total, para «Cuánto queda». */
export type MesaParaUnir = Readonly<{
  mesaId: string;
  cuentaId: string;
  titulo: string;
  total: Importe;
}>;

/**
 * Las mesas a las que se puede unir la actual: del mapa, las que tienen una cuenta abierta con total en pesos, sin la actual, por número. Las unidas, divididas o libres no se ofrecen (el servidor igual rechaza cada caso).
 * Ayuda de pantalla: la regla es del servidor.
 */
export function mesasParaUnir(
  d: DiccionarioResuelto,
  mesas: readonly Readonly<{
    mesaId: string;
    numero: number;
    estado: string;
    cuentaId?: string | undefined;
    total?: Importe | undefined;
  }>[],
  mesaActual: string,
): readonly MesaParaUnir[] {
  return mesas
    .filter(
      (m) =>
        (m.estado === "EN_PEDIDO" || m.estado === "OCUPADA") &&
        m.mesaId !== mesaActual &&
        m.cuentaId !== undefined &&
        m.total?.moneda === MONEDA,
    )
    .sort((a, b) => a.numero - b.numero)
    .map((m) => ({
      mesaId: m.mesaId,
      cuentaId: m.cuentaId as string,
      titulo: texto(d, "salon.texto.admin_mesa_numero", { numero: String(m.numero) }),
      total: m.total as Importe,
    }));
}

/** «Cuánto queda»: la suma EXACTA de las dos cuentas («$ 1.234,56»), sin pasar por `number`; `null` si no se pueden sumar (otra moneda o un monto mal formado). */
export function cuantoQuedaAlUnir(actual: Importe, destino: Importe): string | null {
  try {
    const suma = sumar(importeDesdeJson(actual), importeDesdeJson(destino));
    return formatearImporte(importeAJson(suma).monto);
  } catch {
    return null;
  }
}
