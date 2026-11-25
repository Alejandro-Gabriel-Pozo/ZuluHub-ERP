import {
  texto,
  type DiccionarioResuelto,
} from "../../../../../src/capacidades/vocabulario/vocabulario";
import { formatearCantidad, formatearImporte } from "../../patrones/formato-fiscal";

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
  importe: string;
  compartida: boolean;
  comanda: string;
  numeroDeEnvio: number | null;
  deLaMesa: number | null;
}>;

type CuentaDeLaFichaDeLaPantalla = Readonly<{
  cuentaId: string;
  parte: number | null;
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
}>;

export function textosDeLaMesa(d: DiccionarioResuelto = {}): TextosDeLaMesa {
  return {
    mesaLibre: texto(d, "salon.texto.mesa_mesa_libre"),
    tomarPedido: texto(d, "salon.texto.mesa_tomar_pedido"),
    sinPedido: texto(d, "salon.texto.mesa_la_mesa_no_tiene_pedido"),
    liberar: texto(d, "salon.texto.mesa_liberar_mesa"),
    cambiarDeMesa: texto(d, "salon.texto.mesa_cambiar_de_mesa"),
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
  /** Las cuentas de una mesa dividida («Cuenta 1 · $ 100,00»); vacío si no. */
  cuentasHijas: readonly string[];
  cuentaId: string | null;
  /** «$ 1.234,56»; `null` si no hay cuenta (o su moneda no es ARS). */
  total: string | null;
  grupos: readonly GrupoArmado[];
  /** Una cuenta sin ningún plato: se muestra «La mesa no tiene pedido» y se ofrece «Liberar mesa». */
  sinPlatos: boolean;
}>;

const importeDe = (i: Importe | undefined): string | null =>
  i === undefined || i.moneda !== MONEDA ? null : formatearImporte(i.monto);

const cuentaN = (d: DiccionarioResuelto, numero: number): string => {
  const rotulo = texto(d, "salon.texto.dividir_cuenta_n");
  return rotulo.endsWith("N")
    ? `${rotulo.slice(0, -1)}${String(numero)}`
    : `${rotulo} ${String(numero)}`;
};

function armarElPlato(d: DiccionarioResuelto, l: LineaDeLaFichaDeLaPantalla): PlatoArmado {
  const enviado = l.comanda === "ENVIADA";
  const variante = l.varianteNombre === null ? "" : ` · ${l.varianteNombre}`;
  const notas = [
    l.numeroDeEnvio === null
      ? ""
      : `${texto(d, "comandas.texto.envio_envio_n").replace(/N$/, String(l.numeroDeEnvio))}`,
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
  };
}

/** Arma la ficha de la mesa. Una mesa libre, de una sola cuenta o de solo lectura (unida, dividida o de una forma que esta pantalla no conoce). */
export function armarLaMesa(d: DiccionarioResuelto, ficha: FichaDeLaMesaDeLaPantalla): MesaArmada {
  const titulo = texto(d, "salon.texto.admin_mesa_numero", { numero: String(ficha.numero) });
  const base = {
    titulo,
    unida: null,
    cuentasHijas: [],
    cuentaId: null,
    total: null,
    grupos: [],
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
      cuentasHijas: ficha.cuentas.flatMap((c) => {
        const importe = importeDe(c.total);
        return c.parte === null || importe === null ? [] : [`${cuentaN(d, c.parte)} · ${importe}`];
      }),
    };
  }
  const platos = unica.lineas.map((l) => ({ l, plato: armarElPlato(d, l) }));
  return {
    ...base,
    modo: "CON_CUENTA",
    cuentaId: unica.cuentaId,
    total: importeDe(unica.total),
    sinPlatos: platos.length === 0,
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
