import type { ClaveDeTexto } from "../../../../../src/capacidades/vocabulario/catalogo";
import {
  texto,
  type DiccionarioResuelto,
} from "../../../../../src/capacidades/vocabulario/vocabulario";
import {
  TIPOS_DE_DOCUMENTO_DE_IDENTIDAD,
  type TipoDeDocumentoDeIdentidad,
} from "../../../../../src/primitivas/identificacion-fiscal/documento";
import { documentoMientrasSeEscribe } from "../../../../../src/primitivas/identificacion-fiscal/documento-tipeado";

/**
 * El modelo de vista de «Clientes y proveedores» (maqueta aprobada `directorio.html`, 09/11/2026): de lo que entrega la composición, lo que se ve en la lista, en los filtros y en el
 * formulario, y NADA más. Puro: sin React ni servidor. Los textos salen del catálogo (`clientes.*` y los ya aprobados en otras pantallas); no se arma ningún texto nuevo, solo se eligen
 * los aprobados. Los permisos solo ofrecen o apagan botones: el servidor decide; todo lo que no sea exactamente `true` cierra.
 *
 * Reglas (cada una con su prueba en `test/web/directorio-modelo.test.ts`):
 *  - **Filtros de la dirección en lista cerrada:** un `rol` que no es «cliente» o «proveedor» es «Todos»; `desactivados` es verdadero solo con `on` (lo que manda la casilla) o `1`.
 *  - **El nombre de la lista viene armado** por la composición («Apellido, Nombre» o la razón social): no se rearma.
 *  - **Tipos de documento:** persona, los cinco de la primitiva; empresa, solo CUIT. «ID extranjero» no se ofrece (no tiene texto aprobado). Una prueba los compara con el dominio.
 *  - **«(opcional)» como la maqueta** (función `vForm`): lo llevan Apellido, Alias, Número del documento, Condición frente al IVA, Email, Teléfono, Calle, Número de la calle, Código postal,
 *    Localidad, Provincia y Nota; no lo llevan Persona/Empresa, Nombre o Razón social, Tipo de documento ni País.
 */

/** Una parte como la entrega la composición para la lista (la misma forma, sin importar de dónde venga: la UI no importa la composición). */
type ParteDeLaLista = Readonly<{
  id: string;
  /** Ya armado: persona «Apellido, Nombre» si hay apellido; empresa, el nombre. */
  nombre: string;
  documento: Readonly<{ tipo: string; pais: string | null; numero: string }> | null;
  roles: readonly string[];
  activa: boolean;
}>;

export type PaginaDePartes = Readonly<{
  partes: readonly ParteDeLaLista[];
  /** El cursor de la página que sigue, o `null`. */
  siguiente: string | null;
}>;

/** La ficha de una parte como la entrega la composición (solo lo que la pantalla usa). */
export type FichaDeParte = Readonly<{
  id: string;
  version: number;
  naturaleza: "HUMANA" | "JURIDICA";
  nombre: string | null;
  apellido: string | null;
  alias: string | null;
  documento: Readonly<{ tipo: string; pais: string | null; numero: string }> | null;
  condicionIva: string | null;
  email: string | null;
  telefono: string | null;
  domicilio: Readonly<{
    calle: string;
    numero: string;
    codigoPostal: string | null;
    localidad: string;
    provincia: string;
  }> | null;
  nota: string | null;
  activa: boolean;
  roles: readonly string[];
}>;

export const RUTA_DE_CLIENTES = "/clientes";
export const rutaDeLaParte = (id: string): string => `${RUTA_DE_CLIENTES}/${id}`;
export const RUTA_DE_LA_PARTE_NUEVA = `${RUTA_DE_CLIENTES}/nuevo`;

type ParametrosDeLaDireccion = Readonly<Record<string, string | readonly string[] | undefined>>;

const primero = (params: ParametrosDeLaDireccion, nombre: string): string => {
  const valor = params[nombre];
  return (
    (Array.isArray(valor) ? (valor[0] as string | undefined) : (valor as string | undefined)) ?? ""
  );
};

const ROLES_DEL_FILTRO = ["cliente", "proveedor"] as const;
export type RolDelFiltro = (typeof ROLES_DEL_FILTRO)[number];

const CLAVE_DE_ROL_DEL_FILTRO = {
  cliente: "clientes.lista.clientes",
  proveedor: "clientes.lista.proveedores",
} as const satisfies Record<RolDelFiltro, ClaveDeTexto>;

/** Los roles de la parte tal como los entrega la composición, con el texto de su insignia (el orden es el de la maqueta: Cliente, Proveedor). */
const INSIGNIAS_DE_ROL = [
  { rol: "CUSTOMER", clave: "fiscal.pantalla.rotulo_cliente" },
  { rol: "PROVEEDOR", clave: "compras.compra.proveedor" },
] as const satisfies readonly Readonly<{ rol: string; clave: ClaveDeTexto }>[];

export type FiltrosDelDirectorio = Readonly<{
  texto: string;
  rol: "" | RolDelFiltro;
  desactivados: boolean;
}>;

/** De la dirección a los filtros: lista cerrada. El texto se recorta; su validez es del servidor. */
export function leerLosFiltros(params: ParametrosDeLaDireccion): FiltrosDelDirectorio {
  const rol = primero(params, "rol");
  const desactivados = primero(params, "desactivados");
  return {
    texto: primero(params, "texto").trim(),
    rol: ROLES_DEL_FILTRO.find((permitido) => permitido === rol) ?? "",
    desactivados: desactivados === "on" || desactivados === "1",
  };
}

/** El cursor de la página que sigue, o `undefined` en la primera. */
export function leerLaPagina(params: ParametrosDeLaDireccion): string | undefined {
  const despuesDe = primero(params, "despuesDe");
  return despuesDe === "" ? undefined : despuesDe;
}

/** La dirección de la lista con estos filtros (solo los que se apartan de «Todos») y, si sigue, la página. */
export function direccionDeLaLista(filtros: FiltrosDelDirectorio, despuesDe?: string): string {
  const pares: [string, string][] = [];
  if (filtros.texto !== "") pares.push(["texto", filtros.texto]);
  if (filtros.rol !== "") pares.push(["rol", filtros.rol]);
  if (filtros.desactivados) pares.push(["desactivados", "1"]);
  if (despuesDe !== undefined) pares.push(["despuesDe", despuesDe]);
  return pares.length === 0
    ? RUTA_DE_CLIENTES
    : `${RUTA_DE_CLIENTES}?${new URLSearchParams(pares).toString()}`;
}

export type Opcion = Readonly<{ valor: string; etiqueta: string }>;

/** Lo que el formulario de filtros necesita, con todos los textos ya resueltos (un componente de cliente no arma textos). */
export type FiltrosArmados = Readonly<{
  accion: string;
  valores: FiltrosDelDirectorio;
  textos: Readonly<{
    buscar: string;
    rol: string;
    todos: string;
    desactivados: string;
    aplicar: string;
  }>;
  roles: readonly Opcion[];
}>;

export function armarLosFiltros(
  filtros: FiltrosDelDirectorio,
  d: DiccionarioResuelto = {},
): FiltrosArmados {
  return {
    accion: RUTA_DE_CLIENTES,
    valores: filtros,
    textos: {
      buscar: texto(d, "catalogo.lista.buscar"),
      // SUPUESTO (DEC-0837): el selector de rol (DDD:294) necesita un rótulo y la maqueta usa pestañas sin rótulo; se reusa «Roles» (`clientes.formulario.roles`, aprobado). Costo de revertir: una línea.
      rol: texto(d, "clientes.formulario.roles"),
      todos: texto(d, "catalogo.lista.todos"),
      desactivados: texto(d, "clientes.lista.mostrar_desactivados"),
      aplicar: texto(d, "fiscal.pantalla.listado_aplicar"),
    },
    roles: ROLES_DEL_FILTRO.map((r) => ({
      valor: r,
      etiqueta: texto(d, CLAVE_DE_ROL_DEL_FILTRO[r]),
    })),
  };
}

/** Lo que la persona puede hacer en la pantalla (lo calcula el servidor, `accionesDelDirectorio`): solo ayuda para ofrecer o apagar botones. */
export type AccionesParaLaPantalla = Readonly<{
  crear: boolean;
  editar: boolean;
  desactivar: boolean;
  reactivar: boolean;
}>;

/** Todo lo que no sea exactamente `true` (falso, ausente, dudoso) cierra. */
export const puede = (permiso: boolean | undefined): boolean => permiso === true;

/** El documento de la lista: «tipo número», con el formato de pantalla de su tipo (el CUIT con guiones); un tipo sin texto aprobado muestra solo el número; sin documento, «—». */
function documentoDeLaLista(documento: ParteDeLaLista["documento"]): string {
  if (documento === null) return "—";
  const tipo = (TIPOS_DE_DOCUMENTO_DE_IDENTIDAD as readonly string[]).includes(documento.tipo)
    ? (documento.tipo as TipoDeDocumentoDeIdentidad)
    : null;
  if (tipo === null) return documento.numero;
  return `${documento.tipo} ${documentoMientrasSeEscribe(tipo, documento.numero)}`;
}

type FilaDelDirectorio = Readonly<{
  id: string;
  href: string;
  nombre: string;
  documento: string;
  roles: readonly string[];
  /** «Desactivado»; `null` si está activa. */
  desactivado: string | null;
}>;

export type ListaDelDirectorioArmada = Readonly<{
  filas: readonly FilaDelDirectorio[];
  /** «Sin resultados»; `null` si hay filas. */
  vacio: string | null;
  siguiente: Readonly<{ href: string; texto: string }> | null;
  /** «Nuevo»; `null` sin `partes.crear`. */
  nuevo: Readonly<{ href: string; texto: string }> | null;
}>;

export function armarLaLista(
  pagina: PaginaDePartes,
  filtros: FiltrosDelDirectorio,
  puedeEnLaPantalla: AccionesParaLaPantalla,
  d: DiccionarioResuelto = {},
): ListaDelDirectorioArmada {
  return {
    filas: pagina.partes.map((p) => ({
      id: p.id,
      href: rutaDeLaParte(p.id),
      nombre: p.nombre,
      documento: documentoDeLaLista(p.documento),
      roles: INSIGNIAS_DE_ROL.filter((i) => p.roles.includes(i.rol)).map((i) => texto(d, i.clave)),
      desactivado: p.activa ? null : texto(d, "catalogo.estado.desactivado"),
    })),
    vacio: pagina.partes.length === 0 ? texto(d, "catalogo.lista.sin_resultados") : null,
    siguiente:
      pagina.siguiente === null
        ? null
        : {
            href: direccionDeLaLista(filtros, pagina.siguiente),
            texto: texto(d, "fiscal.pantalla.listado_pagina_siguiente"),
          },
    nuevo: puede(puedeEnLaPantalla.crear)
      ? { href: RUTA_DE_LA_PARTE_NUEVA, texto: texto(d, "clientes.lista.nuevo") }
      : null,
  };
}
