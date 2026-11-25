import {
  texto,
  type DiccionarioResuelto,
} from "../../../../../src/capacidades/vocabulario/vocabulario";
import { formatearImporte } from "../../patrones/formato-fiscal";
import { RUTA_DEL_SALON, rutaDeLaCuentaDeMesa } from "./rutas-del-salon";

/**
 * El modelo de vista del mapa de mesas del salón (SAL-A; maqueta `salon.html`, aprobada el 09/11/2026): de lo que entrega el servidor (`cargarElMapaDeMesas`), lo que se ve y NADA más. Puro: sin
 * React ni servidor. Los textos salen del catálogo (`salon.texto.*`); no se arma ningún texto nuevo, solo se eligen los aprobados.
 *
 * Reglas (cada una con su prueba en `test/web/salon-mapa-modelo.test.ts`):
 *  - **El filtro sale de una lista cerrada.** Lo que no figura (o viene repetido) es «sin filtro»: se ven todas las mesas. El servidor vuelve a validarlo (`leerElPedidoDelMapa`).
 *  - **Cada estado se lee con ícono y texto**, nunca solo con color (`Insignia`). Un estado que esta pantalla no conoce no se inventa: sale sin rótulo y el servidor sigue siendo la fuente.
 *  - **El dinero llega como texto decimal con su moneda** y se muestra con `formatearImporte`; nunca pasa por `number`. Una moneda distinta de ARS no se muestra como pesos: la mesa sale sin total.
 *  - **Una mesa unida dice a qué mesa** («Unida a la mesa 5») y **una dividida lista sus cuentas** («Cuenta 1 · $ 100,00»); ninguna se oculta ni se suma.
 *  - **Cada mesa lleva a su ficha** (SAL-B, `/salon/cuenta/<id>`; el id viaja codificado): también la unida y la dividida (la ficha las muestra de solo lectura).
 *  - Sin el nombre del mozo ni los minutos abiertos: el mapa solo trae el id del mozo y esos rótulos no tienen texto aprobado (inventario `TX-S2-01`, pendiente). Se agregan cuando se acepten.
 */

/** Los filtros que se ofrecen. «Todas» no tiene texto aprobado con clave de salón (`TX-S1-01`, pendiente): quien está en un filtro lo apaga tocándolo de nuevo. */
export const FILTROS_DEL_MAPA = [
  { valor: "LIBRES", clave: "salon.texto.estado_libres" },
  { valor: "EN_PEDIDO", clave: "salon.texto.estado_en_pedido" },
  { valor: "OCUPADAS", clave: "salon.texto.estado_ocupadas" },
] as const;

export type FiltroOfrecido = (typeof FILTROS_DEL_MAPA)[number]["valor"];

/** El filtro que viene en la dirección (`?filtro=LIBRES`): solo uno de la lista cerrada; todo lo demás (otro valor, repetido, vacío) es «sin filtro». */
export function filtroDeLaDireccion(
  crudo: string | readonly string[] | undefined,
): FiltroOfrecido | null {
  if (typeof crudo !== "string") return null;
  const hallado = FILTROS_DEL_MAPA.find((f) => f.valor === crudo);
  return hallado === undefined ? null : hallado.valor;
}

type Importe = Readonly<{ moneda: string; monto: string }>;

/** Una mesa del mapa como la entrega la composición (la UI no importa los módulos). */
export type MesaDelMapaDeLaPantalla = Readonly<{
  mesaId: string;
  numero: number;
  estado: string;
  total?: Importe;
  unidaAMesa?: number;
  cuentasHijas?: readonly Readonly<{ cuentaId: string; numero: number; total: Importe }>[];
}>;

const MONEDA = "ARS";

const ESTADOS = {
  LIBRE: { clave: "salon.texto.estado_libre", tono: "exito" },
  EN_PEDIDO: { clave: "salon.texto.estado_en_pedido", tono: "aviso" },
  OCUPADA: { clave: "salon.texto.estado_ocupada", tono: "info" },
  // «Unida» no tiene rótulo propio: dice «Unida a la mesa N» (`salon.texto.unir_unida_a_la_mesa`).
  UNIDA: { clave: "salon.texto.unir_unida_a_la_mesa", tono: "info" },
} as const;

type TonoDelMapa = (typeof ESTADOS)[keyof typeof ESTADOS]["tono"];

const importeDeLaMesa = (i: Importe | undefined): string | null =>
  i === undefined || i.moneda !== MONEDA ? null : formatearImporte(i.monto);

type FilaDelMapa = Readonly<{
  id: string;
  /** La ficha de la mesa. */
  href: string;
  /** «Mesa 7». */
  titulo: string;
  /** El estado: su texto y su tono (el tono pone el ícono). `null` si el estado no se conoce. */
  estado: Readonly<{ texto: string; tono: TonoDelMapa }> | null;
  /** «$ 1.234,56»; `null` si la mesa no tiene cuenta (o su moneda no es ARS). */
  total: string | null;
  /** Una por cuenta hija de una mesa dividida: «Cuenta 1 · $ 100,00». Vacía si la mesa no está dividida. */
  cuentas: readonly string[];
}>;

export type MapaArmado = Readonly<{
  /** El rótulo del mapa («Mesas»). */
  etiqueta: string;
  filtros: readonly Readonly<{
    valor: FiltroOfrecido;
    texto: string;
    activo: boolean;
    /** Apuntar al filtro activo vuelve a «sin filtro». */
    href: string;
  }>[];
  filas: readonly FilaDelMapa[];
}>;

const hrefDelFiltro = (valor: FiltroOfrecido | null): string =>
  valor === null ? RUTA_DEL_SALON : `${RUTA_DEL_SALON}?filtro=${valor}`;

/** «Cuenta 1»: `salon.texto.dividir_cuenta_n` dice «Cuenta N» (la N final es el lugar del número; si una marca la redacta sin esa N, el número va al final). */
const cuentaN = (d: DiccionarioResuelto, numero: number): string => {
  const rotulo = texto(d, "salon.texto.dividir_cuenta_n");
  return rotulo.endsWith("N")
    ? `${rotulo.slice(0, -1)}${String(numero)}`
    : `${rotulo} ${String(numero)}`;
};

function armarLaFila(d: DiccionarioResuelto, mesa: MesaDelMapaDeLaPantalla): FilaDelMapa {
  const conocido = Object.hasOwn(ESTADOS, mesa.estado)
    ? ESTADOS[mesa.estado as keyof typeof ESTADOS]
    : null;
  const unida = mesa.estado === "UNIDA" && mesa.unidaAMesa !== undefined;
  const rotulo =
    conocido === null
      ? null
      : {
          texto: unida
            ? `${texto(d, conocido.clave)} ${String(mesa.unidaAMesa)}`
            : texto(d, conocido.clave),
          tono: conocido.tono,
        };
  return {
    id: mesa.mesaId,
    href: rutaDeLaCuentaDeMesa(mesa.mesaId),
    titulo: texto(d, "salon.texto.admin_mesa_numero", { numero: String(mesa.numero) }),
    estado: rotulo,
    total: importeDeLaMesa(mesa.total),
    cuentas: (mesa.cuentasHijas ?? []).flatMap((h) => {
      const importe = importeDeLaMesa(h.total);
      return importe === null ? [] : [`${cuentaN(d, h.numero)} · ${importe}`];
    }),
  };
}

/** Arma la pantalla con las mesas que devolvió el servidor (ya filtradas por él) y el filtro que se pidió. El orden es el del servidor. */
export function armarElMapa(
  d: DiccionarioResuelto,
  mesas: readonly MesaDelMapaDeLaPantalla[],
  filtro: FiltroOfrecido | null,
): MapaArmado {
  return {
    etiqueta: texto(d, "salon.texto.estado_mesas"),
    filtros: FILTROS_DEL_MAPA.map((f) => ({
      valor: f.valor,
      texto: texto(d, f.clave),
      activo: f.valor === filtro,
      href: hrefDelFiltro(f.valor === filtro ? null : f.valor),
    })),
    filas: mesas.map((m) => armarLaFila(d, m)),
  };
}
