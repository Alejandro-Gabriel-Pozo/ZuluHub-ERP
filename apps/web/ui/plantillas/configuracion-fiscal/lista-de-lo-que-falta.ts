import type { ClaveDeTexto } from "../../../../../src/capacidades/vocabulario/catalogo";
import { texto } from "../../../../../src/capacidades/vocabulario/vocabulario";
import type { TonoDeEstado } from "../../componentes/Insignia";

/**
 * El modelo de vista de la lista de Configuración fiscal (D-43, opción C; carteles de D-64): de lo que entrega
 * `estadoDeLaConfiguracionFiscal`, qué cartel lleva cada fila. Puro: sin React ni servidor. Un tema completo NO lleva cartel.
 * Previene: mostrar un cartel que no es del tema (el «Vencido» de un certificado en los datos fiscales) o dejar sin aviso lo que
 * falta. Chequeo: `test/web/configuracion-fiscal-lista.test.ts` (cada estado y el orden de lo más urgente).
 */

/** Lo que la lista lee del estado: la misma forma que entrega la composición, sin importarla (la interfaz no la conoce). */
export type EstadoParaLaLista = Readonly<{
  datosFiscales: Readonly<{ estado: "VIGENTES" | "BORRADOR" | "SOLO_FUTUROS" | "SIN_CARGAR" }>;
  puntosDeVenta: Readonly<{
    estado: "CON_ACTIVOS" | "SIN_ACTIVOS" | "SIN_PUNTOS";
    ambientesEnUso: readonly ("HOMOLOGACION" | "PRODUCCION")[];
  }>;
  certificados: readonly Readonly<{
    ambiente: "HOMOLOGACION" | "PRODUCCION";
    situacion: "FALTA_CARGAR" | "PEDIDO_GENERADO" | "VIGENTE";
    vencido: boolean;
  }>[];
}>;

export type CartelDeLaLista =
  "FALTA_CARGAR" | "PENDIENTE" | "FALTA_CREAR_UNO" | "VENCIDO" | "NINGUNO_ACTIVO";

const CLAVE_DEL_CARTEL: Readonly<Record<CartelDeLaLista, ClaveDeTexto>> = {
  FALTA_CARGAR: "fiscal.pantalla.config_cartel_falta_cargar",
  PENDIENTE: "fiscal.pantalla.config_cartel_pendiente",
  FALTA_CREAR_UNO: "fiscal.pantalla.config_cartel_falta_crear_uno",
  VENCIDO: "fiscal.pantalla.config_cartel_vencido",
  NINGUNO_ACTIVO: "fiscal.pantalla.config_cartel_ninguno_activo",
};

/** El peligro es lo vencido; lo que falta, aviso; lo que se empezó y no se terminó, información. El estado nunca se dice solo con color. */
const TONO_DEL_CARTEL: Readonly<Record<CartelDeLaLista, TonoDeEstado>> = {
  FALTA_CARGAR: "aviso",
  PENDIENTE: "info",
  FALTA_CREAR_UNO: "aviso",
  VENCIDO: "peligro",
  NINGUNO_ACTIVO: "aviso",
};

/**
 * D-64. SOLO_FUTUROS (datos que rigen más adelante) dice «Pendiente» (no «completo»): SUPUESTO del ingeniero; fuente D-61 (la web ya
 * no puede producirlo).
 */
export function cartelDeDatosFiscales(
  estado: EstadoParaLaLista["datosFiscales"]["estado"],
): CartelDeLaLista | null {
  switch (estado) {
    case "VIGENTES":
      return null;
    case "SIN_CARGAR":
      return "FALTA_CARGAR";
    case "BORRADOR":
    case "SOLO_FUTUROS":
      return "PENDIENTE";
  }
}

export function cartelDePuntosDeVenta(
  estado: EstadoParaLaLista["puntosDeVenta"]["estado"],
): CartelDeLaLista | null {
  switch (estado) {
    case "CON_ACTIVOS":
      return null;
    case "SIN_PUNTOS":
      return "FALTA_CREAR_UNO";
    case "SIN_ACTIVOS":
      return "NINGUNO_ACTIVO";
  }
}

/**
 * De más a menos urgente. SUPUESTO del ingeniero: con varios ambientes la fila del certificado muestra UN solo cartel, el más urgente
 * (Vencido, Falta cargar, Pendiente). Fuente: cuestionario B (21:11Z), pregunta 2 (la fila solo informa «Vencido», «Falta cargar» o
 * «Pendiente») y D-64, que no ordena los carteles del certificado; no se le preguntó al dueño cuál gana cuando hay más de uno.
 */
const URGENCIA_DEL_CERTIFICADO = ["VENCIDO", "FALTA_CARGAR", "PENDIENTE"] as const;

function cartelDeUnCertificado(
  c: EstadoParaLaLista["certificados"][number],
): (typeof URGENCIA_DEL_CERTIFICADO)[number] | null {
  if (c.situacion === "FALTA_CARGAR") return "FALTA_CARGAR";
  if (c.situacion === "PEDIDO_GENERADO") return "PENDIENTE";
  return c.vencido ? "VENCIDO" : null;
}

/**
 * El cartel del certificado: el MÁS URGENTE entre los ambientes en uso (los de los puntos de venta activos). SUPUESTO del ingeniero:
 * sin ningún ambiente en uso (ningún punto de venta activo) cuentan los dos, porque la fila tiene que decir algo y no hay otro
 * criterio. Fuente: cuestionario B (21:11Z), pregunta 3, donde el dueño contestó que sin punto de venta activo «sigue faltando»; no se
 * le preguntó qué cartel lleva la fila del certificado en ese caso (esa falta ya la dice la fila de Puntos de venta: «Ninguno activo»).
 */
export function cartelDelCertificado(
  ambientesEnUso: EstadoParaLaLista["puntosDeVenta"]["ambientesEnUso"],
  certificados: EstadoParaLaLista["certificados"],
): CartelDeLaLista | null {
  const considerados =
    ambientesEnUso.length === 0
      ? certificados
      : certificados.filter((c) => ambientesEnUso.includes(c.ambiente));
  const carteles = considerados.map(cartelDeUnCertificado);
  return URGENCIA_DEL_CERTIFICADO.find((cartel) => carteles.includes(cartel)) ?? null;
}

export type FilaDeLaLista = Readonly<{
  clave: "DATOS_FISCALES" | "PUNTOS_DE_VENTA" | "CERTIFICADO";
  titulo: string;
  /** Adónde lleva; `null`: la fila no es un enlace (Certificado: no tiene textos aprobados). */
  href: string | null;
  cartel: Readonly<{ texto: string; tono: TonoDeEstado }> | null;
}>;

/** Las rutas de Configuración fiscal. Un solo lugar: las usan la lista, las pantallas de Datos fiscales y de puntos de venta y sus pruebas. */
export const RUTAS_DE_CONFIGURACION = {
  lista: "/configuracion-fiscal",
  datosFiscales: "/configuracion-fiscal/datos-fiscales",
  puntosDeVenta: "/configuracion-fiscal/puntos-de-venta",
  nuevoPuntoDeVenta: "/configuracion-fiscal/puntos-de-venta/nuevo",
} as const;

export const rutaDeUnPuntoDeVenta = (id: string): string =>
  `${RUTAS_DE_CONFIGURACION.puntosDeVenta}/${id}`;

function conCartel(cartel: CartelDeLaLista | null): FilaDeLaLista["cartel"] {
  return cartel === null
    ? null
    : { texto: texto({}, CLAVE_DEL_CARTEL[cartel]), tono: TONO_DEL_CARTEL[cartel] };
}

/** Las tres filas, en el orden del prototipo aprobado: Datos fiscales, Puntos de venta, Certificado de ARCA. */
export function armarLaLista(estado: EstadoParaLaLista): readonly FilaDeLaLista[] {
  return [
    {
      clave: "DATOS_FISCALES",
      titulo: texto({}, "fiscal.pantalla.config_fila_datos_fiscales"),
      href: RUTAS_DE_CONFIGURACION.datosFiscales,
      cartel: conCartel(cartelDeDatosFiscales(estado.datosFiscales.estado)),
    },
    {
      clave: "PUNTOS_DE_VENTA",
      titulo: texto({}, "fiscal.pantalla.config_puntos_de_venta"),
      href: RUTAS_DE_CONFIGURACION.puntosDeVenta,
      cartel: conCartel(cartelDePuntosDeVenta(estado.puntosDeVenta.estado)),
    },
    {
      clave: "CERTIFICADO",
      titulo: texto({}, "fiscal.pantalla.config_fila_certificado"),
      href: null,
      cartel: conCartel(
        cartelDelCertificado(estado.puntosDeVenta.ambientesEnUso, estado.certificados),
      ),
    },
  ];
}
