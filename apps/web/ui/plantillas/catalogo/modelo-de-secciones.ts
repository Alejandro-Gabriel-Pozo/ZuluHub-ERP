import {
  texto,
  type DiccionarioResuelto,
} from "../../../../../src/capacidades/vocabulario/vocabulario";

/**
 * El modelo de vista de la pantalla «Secciones de la carta» (A8, partes 1 y 2; maqueta aprobada `productos-secciones.html`, 12/11/2026): de lo que entrega la composición, lo que se ve en la lista,
 * en la página de una sección y en el formulario del nombre, y NADA más. Puro: sin React ni servidor. Los textos salen del catálogo (`catalogo.*`, con su fuente en `catalogo-catalogo.ts`); no
 * se arma ningún texto nuevo, solo se eligen los aprobados.
 *
 * Reglas (cada una con su prueba en `test/web/secciones-modelo.test.ts`):
 *  - **Las activas van primero, en el orden de la carta, con flechas; las desactivadas van al final, sin flechas (S1; SUPUESTO, DEC-0435).** `reordenarSeccionesDeCarta` solo conoce las activas, así que una
 *    desactivada no se mueve; las flechas de una activa saltean a las desactivadas. La primera activa no sube y la última no baja. Previene: una flecha que mande a una desactivada una posición
 *    que el servidor no entiende.
 *  - **Lo que cambia algo sale solo si la persona puede editar** (`puedeEditarProductos`, solo una ayuda: el guard decide): sin permiso las flechas salen apagadas y «Nueva sección», «Nombre»
 *    y «Desactivar» / «Reactivar» no se ofrecen o salen apagados. Todo lo que no sea exactamente `true` cierra.
 *  - **«Agregar producto» y «Quitar» (parte 2) se ofrecen solo si la persona puede editar**; apagados si no (ayuda, no autorización). «Quitar» sale en cada producto de la sección; los candidatos de
 *    «Agregar producto» salen apagados sin permiso y, si falta completarlos, siempre (no se pueden elegir). Un candidato dice dónde está hoy: «Falta completar», su sección o «Sin elegir».
 *  - **Lo que la persona vio viaja con el toque**: la página liga a la acción las secciones activas en el orden en que se ven, cada una con su versión (`vistas`); un cambio de otra persona
 *    entre medio lo rechaza el caso de uso y la pantalla recarga.
 */

/** La lista de secciones y la única dirección de cada pantalla (S5 de la ficha: sigue el patrón de `/catalogo/productos`). */
export const RUTA_DE_SECCIONES = "/catalogo/secciones";
export const RUTA_DE_LA_SECCION_NUEVA = `${RUTA_DE_SECCIONES}/nueva`;
export const rutaDeLaSeccion = (id: string): string => `${RUTA_DE_SECCIONES}/${id}`;
export const rutaDelNombreDeLaSeccion = (id: string): string => `${rutaDeLaSeccion(id)}/nombre`;

export const rutaDeAgregarProducto = (id: string): string => `${rutaDeLaSeccion(id)}/agregar`;

/** Los nombres con los que «Quitar» y un candidato de «Agregar producto» viajan en el formulario: el valor es el id del producto tocado. */
export const CAMPO_DE_QUITAR = "quitar";
export const CAMPO_DE_AGREGAR = "agregar";

/** Los nombres con los que una flecha viaja en el formulario: el valor es el id de la sección tocada. */
export const CAMPO_DE_SUBIR = "subir";
export const CAMPO_DE_BAJAR = "bajar";

/** Una sección como la entrega la composición (la misma forma, sin importar de dónde venga; la UI no importa los módulos). */
export type SeccionDeLaLista = Readonly<{
  id: string;
  nombre: string;
  activa: boolean;
  version: number;
}>;

/** Lo que la persona vio de una sección activa: lo que la página liga a la acción. */
export type VistaDeSeccion = Readonly<{ seccionId: string; versionEsperada: number }>;

/** Lo que la persona vio de un producto (de la sección o candidato): lo que la página liga a la acción de «Quitar» y de «Agregar». */
export type VistaDeProducto = Readonly<{ productoId: string; versionEsperada: number }>;

type FlechaArmada = Readonly<{
  /** El nombre accesible: «Subir {nombre}» / «Bajar {nombre}» (SUPUESTO, DEC-0433, ver `catalogo-catalogo.ts`). */
  etiqueta: string;
  /** El nombre con el que viaja el toque (`CAMPO_DE_SUBIR` o `CAMPO_DE_BAJAR`); su valor es el id de la sección. */
  campo: string;
  apagada: boolean;
}>;

type FilaDeSeccion = Readonly<{
  id: string;
  nombre: string;
  href: string;
  /** «Desactivado»; `null` si la sección está activa. */
  marca: string | null;
  /** `null` en una desactivada: no se mueve. */
  flechas: Readonly<{ subir: FlechaArmada; bajar: FlechaArmada }> | null;
}>;

export type ListaDeSeccionesArmada = Readonly<{
  filas: readonly FilaDeSeccion[];
  /** Las activas en el orden en que se ven, con la versión de cada una: la página las liga a la acción de las flechas. */
  vistas: readonly VistaDeSeccion[];
  /** «Nueva sección»; `null` si la persona no puede editar. */
  nueva: Readonly<{ href: string; texto: string }> | null;
}>;

/** Todo lo que no sea exactamente `true` (falso, ausente, dudoso) cierra. */
const puede = (puedeEditar: boolean | undefined): boolean => puedeEditar === true;

export function armarLaListaDeSecciones(
  secciones: readonly SeccionDeLaLista[],
  puedeEditar: boolean | undefined,
  d: DiccionarioResuelto = {},
): ListaDeSeccionesArmada {
  const activas = secciones.filter((s) => s.activa);
  const desactivadas = secciones.filter((s) => !s.activa);
  const edita = puede(puedeEditar);
  const base = (s: SeccionDeLaLista) => ({
    id: s.id,
    nombre: s.nombre,
    href: rutaDeLaSeccion(s.id),
  });
  const filaActiva = (s: SeccionDeLaLista, posicion: number): FilaDeSeccion => ({
    ...base(s),
    marca: null,
    flechas: {
      subir: {
        etiqueta: texto(d, "catalogo.seccion.subir", { nombre: s.nombre }),
        campo: CAMPO_DE_SUBIR,
        apagada: !edita || posicion === 0,
      },
      bajar: {
        etiqueta: texto(d, "catalogo.seccion.bajar", { nombre: s.nombre }),
        campo: CAMPO_DE_BAJAR,
        apagada: !edita || posicion === activas.length - 1,
      },
    },
  });
  const filaDesactivada = (s: SeccionDeLaLista): FilaDeSeccion => ({
    ...base(s),
    marca: texto(d, "catalogo.estado.desactivado"),
    flechas: null,
  });
  return {
    filas: [...activas.map(filaActiva), ...desactivadas.map(filaDesactivada)],
    vistas: activas.map((s) => ({ seccionId: s.id, versionEsperada: s.version })),
    nueva: edita
      ? { href: RUTA_DE_LA_SECCION_NUEVA, texto: texto(d, "catalogo.seccion.nueva") }
      : null,
  };
}

type EnlaceArmado = Readonly<{ href: string; texto: string }>;

/** Lo que entrega la composición para una sección: ella y una página de sus productos activos (en orden alfabético). */
export type UnaSeccionDeLaPantalla = Readonly<{
  seccion: SeccionDeLaLista;
  productos: readonly Readonly<{ id: string; nombre: string; version: number }>[];
  /** La clave de la página que sigue; `null` en la última. */
  siguiente: string | null;
}>;

export type UnaSeccionArmada = Readonly<{
  id: string;
  titulo: string;
  /** El botón ‹ de la maqueta, de vuelta a la lista (SUPUESTO, DEC-0434, ver `catalogo-catalogo.ts`). */
  volver: Readonly<{ href: string; etiqueta: string }>;
  /** «Desactivado»; `null` si la sección está activa. */
  marca: string | null;
  /** «Nombre»: lleva a renombrar; sin `href` (la persona no puede editar) sale apagado. */
  nombre: Readonly<{ texto: string; href: string | null }>;
  /** «Desactivar» si está activa, «Reactivar» si no; apagado si la persona no puede editar. */
  estado: Readonly<{ reactivar: boolean; texto: string; apagado: boolean }>;
  /** «Agregar producto»: lleva a elegir; sin `href` (la persona no puede editar) sale apagado. */
  agregar: Readonly<{ texto: string; href: string | null }>;
  /** De cada producto, su id, su nombre y el nombre accesible de su «Quitar» («Quitar {nombre}», DEC-0522). */
  productos: readonly Readonly<{ id: string; nombre: string; etiquetaDeQuitar: string }>[];
  /** «Quitar», el mismo texto en cada producto; apagado si la persona no puede editar. */
  quitar: Readonly<{ texto: string; apagado: boolean }>;
  /** Los productos como se ven, con su versión: la página los liga a la acción de «Quitar». */
  vistas: readonly VistaDeProducto[];
  siguiente: EnlaceArmado | null;
}>;

const volverALaLista = (d: DiccionarioResuelto) => ({
  href: RUTA_DE_SECCIONES,
  etiqueta: texto(d, "catalogo.seccion.volver_a_la_lista"),
});

export function armarUnaSeccion(
  dato: UnaSeccionDeLaPantalla,
  puedeEditar: boolean | undefined,
  d: DiccionarioResuelto = {},
): UnaSeccionArmada {
  const { seccion } = dato;
  const edita = puede(puedeEditar);
  return {
    id: seccion.id,
    titulo: seccion.nombre,
    volver: volverALaLista(d),
    marca: seccion.activa ? null : texto(d, "catalogo.estado.desactivado"),
    nombre: {
      texto: texto(d, "catalogo.dato.nombre"),
      href: edita ? rutaDelNombreDeLaSeccion(seccion.id) : null,
    },
    estado: {
      reactivar: !seccion.activa,
      texto: texto(d, seccion.activa ? "catalogo.accion.desactivar" : "catalogo.accion.reactivar"),
      apagado: !edita,
    },
    agregar: {
      texto: texto(d, "catalogo.seccion.agregar_producto"),
      href: edita ? rutaDeAgregarProducto(seccion.id) : null,
    },
    productos: dato.productos.map((p) => ({
      id: p.id,
      nombre: p.nombre,
      etiquetaDeQuitar: texto(d, "catalogo.seccion.quitar_producto", { nombre: p.nombre }),
    })),
    quitar: { texto: texto(d, "catalogo.accion.quitar"), apagado: !edita },
    vistas: dato.productos.map((p) => ({ productoId: p.id, versionEsperada: p.version })),
    siguiente:
      dato.siguiente === null
        ? null
        : {
            href: `${rutaDeLaSeccion(seccion.id)}?${new URLSearchParams([["despues", dato.siguiente]]).toString()}`,
            texto: texto(d, "fiscal.pantalla.listado_pagina_siguiente"),
          },
  };
}

/** Lo que entrega la composición para «Agregar producto»: la sección y una página de candidatos. */
export type CandidatosDeLaPantalla = Readonly<{
  seccion: SeccionDeLaLista;
  candidatos: readonly Readonly<{
    id: string;
    nombre: string;
    version: number;
    faltaCompletar: boolean;
    seccion: string | null;
  }>[];
  /** La clave de la página que sigue; `null` en la última. */
  siguiente: string | null;
}>;

type FilaDeCandidato = Readonly<{
  id: string;
  nombre: string;
  /** Dónde está hoy: «Falta completar», el nombre de su sección o «Sin elegir». */
  donde: string;
  /** Sin permiso, o si falta completarlo: no se puede elegir. */
  apagada: boolean;
}>;

export type CandidatosArmados = Readonly<{
  seccion: SeccionDeLaLista;
  buscador: Readonly<{ accion: string; etiqueta: string; boton: string; valorInicial: string }>;
  filas: readonly FilaDeCandidato[];
  /** Los candidatos como se ven, con su versión: la página los liga a la acción de agregar. */
  vistas: readonly VistaDeProducto[];
  /** «Cancelar»: vuelve a la sección, como el cuadro de la maqueta. */
  cancelar: EnlaceArmado;
  siguiente: EnlaceArmado | null;
}>;

/** La dirección de la página siguiente de «Agregar producto»: el texto buscado (si hay) y la clave de la página. */
function direccionDeLaPaginaSiguiente(seccionId: string, buscado: string, despues: string): string {
  const pares: [string, string][] = buscado === "" ? [] : [["texto", buscado]];
  pares.push(["despues", despues]);
  return `${rutaDeAgregarProducto(seccionId)}?${new URLSearchParams(pares).toString()}`;
}

export function armarLosCandidatos(
  dato: CandidatosDeLaPantalla,
  buscado: string,
  puedeEditar: boolean | undefined,
  d: DiccionarioResuelto = {},
): CandidatosArmados {
  const edita = puede(puedeEditar);
  const { seccion } = dato;
  return {
    seccion,
    buscador: {
      accion: rutaDeAgregarProducto(seccion.id),
      etiqueta: texto(d, "catalogo.lista.buscar"),
      boton: texto(d, "catalogo.lista.buscar"),
      valorInicial: buscado,
    },
    filas: dato.candidatos.map((c) => ({
      id: c.id,
      nombre: c.nombre,
      donde: c.faltaCompletar
        ? texto(d, "catalogo.estado.falta_completar")
        : (c.seccion ?? texto(d, "catalogo.dato.sin_elegir")),
      apagada: !edita || c.faltaCompletar,
    })),
    vistas: dato.candidatos.map((c) => ({ productoId: c.id, versionEsperada: c.version })),
    cancelar: { href: rutaDeLaSeccion(seccion.id), texto: texto(d, "catalogo.accion.cancelar") },
    siguiente:
      dato.siguiente === null
        ? null
        : {
            href: direccionDeLaPaginaSiguiente(seccion.id, buscado, dato.siguiente),
            texto: texto(d, "fiscal.pantalla.listado_pagina_siguiente"),
          },
  };
}

export type FormularioDeSeccionArmado = Readonly<{
  nombre: Readonly<{ etiqueta: string; valorInicial: string }>;
  guardar: string;
  cancelar: EnlaceArmado;
  volver: Readonly<{ href: string; etiqueta: string }>;
  /** Si el servidor deja guardar hoy: si no, «Guardar» sale apagado (solo una ayuda: el guard decide; DEC-0346). */
  puedeGuardar: boolean;
}>;

/** «Guardar» se ofrece con un nombre que no esté vacío (maqueta, `nombreValido`); si el nombre es válido para el negocio lo decide el servidor. */
export const sePuedeGuardarElNombre = (nombre: string): boolean => nombre.trim() !== "";

/** El formulario del nombre: vacío para una sección nueva, con el nombre actual para renombrar. «Cancelar» y ‹ vuelven a la lista, como en la maqueta. */
export function armarElFormularioDeSeccion(
  seccion: Readonly<{ nombre: string }> | null,
  puedeEditar: boolean | undefined,
  d: DiccionarioResuelto = {},
): FormularioDeSeccionArmado {
  return {
    nombre: {
      etiqueta: texto(d, "catalogo.dato.nombre"),
      valorInicial: seccion === null ? "" : seccion.nombre,
    },
    guardar: texto(d, "catalogo.accion.guardar"),
    cancelar: { href: RUTA_DE_SECCIONES, texto: texto(d, "catalogo.accion.cancelar") },
    volver: volverALaLista(d),
    puedeGuardar: puede(puedeEditar),
  };
}
