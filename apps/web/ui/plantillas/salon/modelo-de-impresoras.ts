import {
  texto,
  type DiccionarioResuelto,
} from "../../../../../src/capacidades/vocabulario/vocabulario";
import { rotuloDelAncho } from "../../patrones/papel/hoja-del-papel";

/**
 * El modelo de vista de la pantalla «Impresoras» del salón (S-2; maqueta aprobada `imprimir.html`, 09/11/2026): de lo que entrega la composición, lo que se ve en la lista y en el formulario, y NADA más. Puro: sin React
 * ni servidor. Los textos salen del catálogo (`comandas.texto.imprimir_*`, con su fuente en `catalogo-comandas.ts`); no se arma ningún texto nuevo, solo se eligen los aprobados.
 *
 * Reglas (cada una con su prueba en `test/web/impresoras-modelo.test.ts`):
 *  - **Solo las activas.** «Quitar» desactiva (el servidor nunca borra: queda el registro) y la impresora sale de la lista, como en la maqueta; el orden lo da el servidor.
 *  - **Lo que cambia algo sale solo si la persona puede administrar las impresoras** (`puedeAdministrar`, solo una ayuda: el guard decide): sin permiso «Agregar impresora» no se ofrece, y el nombre (que lleva a editar) y
 *    «Quitar» salen apagados. Todo lo que no sea exactamente `true` cierra. «Imprimir prueba» es solo del navegador (no cambia ningún dato): lo tienen los tres roles.
 *  - **Uso y papel son listas cerradas** que repiten los valores del dominio (`USOS_DE_IMPRESORA`, `PAPELES_EN_MM`): una prueba falla si difieren.
 * SUPUESTO (DEC-0716): ruta `/salon/impresoras`; la edición se abre desde el nombre de la impresora (la maqueta no dibuja «Editar»: no se suma ninguna palabra). La lista vacía dice «No hay impresoras», como la maqueta.
 */

export const RUTA_DE_IMPRESORAS = "/salon/impresoras";
const RUTA_DE_LA_IMPRESORA_NUEVA = `${RUTA_DE_IMPRESORAS}/nueva`;
const rutaDeLaImpresora = (id: string): string => `${RUTA_DE_IMPRESORAS}/${id}`;

/** Los valores de uso y de papel tal como los guarda el dominio. */
export const USOS = ["COMANDA", "TICKET"] as const;
export const PAPELES = [58, 80] as const;

/** El texto aprobado de cada uso; un valor que no es de la lista no dice nada. */
const textoDelUso = (uso: string, d: DiccionarioResuelto): string => {
  if (uso === "COMANDA") return texto(d, "comandas.texto.imprimir_comanda_de_cocina");
  if (uso === "TICKET") return texto(d, "comandas.texto.imprimir_ticket_del_cliente");
  return "";
};

/** Una impresora como la entrega la composición (la UI no importa los módulos). */
export type ImpresoraDeLaLista = Readonly<{
  id: string;
  nombre: string;
  uso: string;
  papelMm: number;
  activa: boolean;
  version: number;
}>;

type FilaDeImpresora = Readonly<{
  id: string;
  nombre: string;
  /** El ancho del papel («80 mm»). */
  papel: string;
  /** «Comanda de cocina» o «Ticket del cliente». */
  uso: string;
  /** El anchoMm para la hoja de prueba. */
  papelMm: number;
  /** La edición: el nombre lleva a ella; `null` si la persona no puede administrar. */
  editar: string | null;
  prueba: string;
  quitar: Readonly<{ texto: string; apagado: boolean }>;
}>;

export type ListaDeImpresorasArmada = Readonly<{
  filas: readonly FilaDeImpresora[];
  /** «Agregar impresora»; `null` si la persona no puede administrar. */
  nueva: Readonly<{ href: string; texto: string }> | null;
  /** El mensaje genérico («Esta acción no está permitida») si la persona no puede administrar (maqueta, estado «Sin permiso»); `null` si puede. */
  sinPermiso: string | null;
  /** «Imprimiendo»: lo que dice «Imprimir prueba» mientras corre. */
  imprimiendo: string;
  /** «No hay impresoras» si la lista no tiene ninguna activa (maqueta, `vConfig`); `null` si hay. */
  vacia: string | null;
}>;

/** Todo lo que no sea exactamente `true` (falso, ausente, dudoso) cierra. */
const puede = (puedeAdministrar: boolean | undefined): boolean => puedeAdministrar === true;

export function armarLaListaDeImpresoras(
  impresoras: readonly ImpresoraDeLaLista[],
  puedeAdministrar: boolean | undefined,
  d: DiccionarioResuelto = {},
): ListaDeImpresorasArmada {
  const administra = puede(puedeAdministrar);
  return {
    filas: impresoras
      .filter((i) => i.activa)
      .map((i) => ({
        id: i.id,
        nombre: i.nombre,
        papel: rotuloDelAncho(i.papelMm),
        uso: textoDelUso(i.uso, d),
        papelMm: i.papelMm,
        editar: administra ? rutaDeLaImpresora(i.id) : null,
        prueba: texto(d, "comandas.texto.imprimir_imprimir_prueba"),
        quitar: { texto: texto(d, "comandas.texto.salida_quitar"), apagado: !administra },
      })),
    nueva: administra
      ? {
          href: RUTA_DE_LA_IMPRESORA_NUEVA,
          texto: texto(d, "comandas.texto.imprimir_agregar_impresora"),
        }
      : null,
    sinPermiso: administra ? null : texto(d, "catalogo.error.accion_no_permitida"),
    imprimiendo: texto(d, "comandas.texto.imprimir_imprimiendo"),
    vacia: impresoras.some((i) => i.activa)
      ? null
      : texto(d, "comandas.texto.imprimir_no_hay_impresoras"),
  };
}

type Opcion = Readonly<{ valor: string; etiqueta: string }>;

export type FormularioDeImpresoraArmado = Readonly<{
  titulo: string;
  nombre: Readonly<{ etiqueta: string; valorInicial: string }>;
  uso: Readonly<{ etiqueta: string; valorInicial: string; opciones: readonly Opcion[] }>;
  papel: Readonly<{ etiqueta: string; valorInicial: string; opciones: readonly Opcion[] }>;
  guardar: string;
  cancelar: Readonly<{ href: string; texto: string }>;
  volver: Readonly<{ href: string; etiqueta: string }>;
  /** Si el servidor deja guardar hoy: si no, «Guardar» sale apagado (solo una ayuda: el guard decide). */
  puedeGuardar: boolean;
}>;

/**
 * El formulario: para una impresora nueva, el nombre vacío, comanda y 80 mm (lo que propone la maqueta); para editar, con los datos de la impresora. «Cancelar» y ‹ vuelven a la lista. El título de la alta es «Agregar
 * impresora»; el de la edición, «Impresoras» (no hay palabra aprobada para editar).
 */
export function armarElFormularioDeImpresora(
  impresora: ImpresoraDeLaLista | null,
  puedeAdministrar: boolean | undefined,
  d: DiccionarioResuelto = {},
): FormularioDeImpresoraArmado {
  return {
    titulo:
      impresora === null
        ? texto(d, "comandas.texto.imprimir_agregar_impresora")
        : texto(d, "comandas.texto.imprimir_impresoras"),
    nombre: {
      etiqueta: texto(d, "comandas.texto.imprimir_nombre"),
      valorInicial: impresora === null ? "" : impresora.nombre,
    },
    uso: {
      etiqueta: texto(d, "comandas.texto.imprimir_para_que_sirve"),
      valorInicial: impresora === null ? USOS[0] : impresora.uso,
      opciones: USOS.map((u) => ({ valor: u, etiqueta: textoDelUso(u, d) })),
    },
    papel: {
      etiqueta: texto(d, "comandas.texto.imprimir_papel"),
      valorInicial: String(impresora === null ? PAPELES[1] : impresora.papelMm),
      opciones: PAPELES.map((p) => ({ valor: String(p), etiqueta: rotuloDelAncho(p) })),
    },
    guardar: texto(d, "salon.texto.admin_guardar"),
    cancelar: { href: RUTA_DE_IMPRESORAS, texto: texto(d, "catalogo.accion.cancelar") },
    volver: { href: RUTA_DE_IMPRESORAS, etiqueta: texto(d, "catalogo.seccion.volver_a_la_lista") },
    puedeGuardar: puede(puedeAdministrar),
  };
}
