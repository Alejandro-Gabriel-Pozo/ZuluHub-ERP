/**
 * EL GRAFO DEL SISTEMA, ETAPA 0 (MEDICIÓN). Diseño aprobado por el dueño el 21/11/2026 y orden del 23/11/2026:
 * `Pedernal-docs/11-especificaciones/diseno-del-grafo-del-sistema-2026-11-21.md` (§6 etapa 0, §7 primer informe).
 *
 * QUÉ ES: una función pura y determinista que arma nodos y aristas a partir de lo que ya declaran los registros (catálogo de módulos,
 * declaraciones de casos de uso, rutas, fichas, migraciones, índice de docs) y los mide por categoría. NO es un registro más escrito
 * a mano: no guarda nada que se pueda calcular (una regla, un lugar). NO falla el CI por lo que mide (eso es la etapa 1 en adelante).
 * Los lectores que tocan el disco viven en `grafo-lectores.ts`; acá no hay lectura de archivos, reloj ni azar: misma entrada, mismo
 * informe (prueba de determinismo en `grafo-evasiones.test.ts`).
 *
 * Justificación (una línea): previene la categoría «declarado y no conectado» (acción sin caso de uso, maqueta sin pantalla, tabla sin
 * escritor, brief sin código), que hoy se descubre a mano. Chequeo: es MEDICIÓN; `grafo-evasiones.test.ts` inyecta un caso por
 * categoría para probar que el detector la ve, y `grafo.test.ts` falla solo si el propio generador se rompe (mira vacío).
 *
 * Límites que NO ve (diseño §8): existencia operativa en producción, comportamiento correcto, y todo lo no declarado en un registro.
 * Las heurísticas por nombre (casos de uso vistos desde una página, maqueta ↔ pantalla, brief ↔ código) se marcan en cada categoría.
 */

const TIPOS_DE_NODO = [
  "modulo",
  "accion",
  "caso_de_uso",
  "pantalla",
  "ficha",
  "maqueta",
  "tabla",
  "migracion",
  "brief",
] as const;
type TipoDeNodo = (typeof TIPOS_DE_NODO)[number];

/** Las aristas del diseño §2 (`pertenece_a`, `protege`, `se_ve_en`, `dibuja`, `declara`) más las dos de datos (`crea`, `escribe`). */
const TIPOS_DE_ARISTA = [
  "pertenece_a",
  "protege",
  "se_ve_en",
  "dibuja",
  "declara",
  "crea",
  "escribe",
] as const;
type TipoDeArista = (typeof TIPOS_DE_ARISTA)[number];

type Atributo = string | number | boolean | null;

type Nodo = Readonly<{
  id: string;
  tipo: TipoDeNodo;
  /** Módulo del catálogo al que pertenece, o `null` si no se pudo resolver (el huérfano se mide aparte). */
  modulo: string | null;
  atributos: Readonly<Record<string, Atributo>>;
}>;

type Arista = Readonly<{
  de: string;
  hacia: string;
  tipo: TipoDeArista;
  /** `nombre` = inferida por nombre (heurística); `dudosa` = el nombre está repetido entre módulos; sin marca = declarada. */
  via?: "declarada" | "nombre" | "dudosa";
}>;

export type Grafo = Readonly<{ nodos: readonly Nodo[]; aristas: readonly Arista[] }>;

type EntradaDeModulo = Readonly<{
  clave: string;
  estado: string;
  acciones: readonly string[];
  /** Carpetas de `src/` (`modulos/caja`): sirven para ubicar un caso de uso sin acción (`sinGuard`) en un módulo. */
  implementadoPor: readonly string[];
}>;

export type EntradaDeCaso = Readonly<{
  nombre: string;
  /** Carpeta `src/modulos/<carpeta>` donde se declara. */
  carpeta: string;
  clase: "caso" | "consulta";
  accion: string | null;
  tambien: readonly string[];
  sinGuard: string | null;
}>;

export type EntradaDeRuta = Readonly<{
  /** `web:/caja/cajas` o `plataforma:/planes`. */
  id: string;
  app: "web" | "plataforma";
  ruta: string;
  archivo: string;
}>;

export type EntradaDeFicha = Readonly<{
  id: string;
  archivo: string;
  rutas: readonly string[];
  /** La acción de lectura que abre la pantalla; `null` si la ficha todavía no la declara (cinco de las once, hoy). */
  acceso: string | null;
  /** El acceso y las acciones que envían sus botones. */
  acciones: readonly string[];
  /** Nombres de maqueta (`caja.html`) que la ficha cita en su texto. */
  maquetasCitadas: readonly string[];
}>;

export type EntradaDeMigracion = Readonly<{ id: string; tablasCreadas: readonly string[] }>;

export type EntradaDeTabla = Readonly<{
  nombre: string;
  migracion: string;
  /** Migración que la borra o la renombra, si la hay. */
  retiradaEn: string | null;
  /** Orígenes del código que la escriben o la leen (`modulos/caja`, `plataforma`, `adaptadores`…). */
  escritores: readonly string[];
  lectores: readonly string[];
  /** La escribe alguna migración (semilla, disparador): no cuenta como escritor del código. */
  escritaEnMigracion: boolean;
}>;

type EntradaDeMaqueta = Readonly<{ id: string; nombre: string; carpeta: string }>;

/** Lo que cada brief nombra (extraído del texto por `generar-indice-de-docs.cjs`; es una heurística por nombre, no un enlace declarado). */
export type EntradaDeBrief = Readonly<{
  id: string;
  pack: string;
  archivo: string;
  titulo: string;
  acciones: readonly string[];
  rutas: readonly string[];
  maquetas: readonly string[];
  funciones: readonly string[];
  tablas: readonly string[];
}>;

export type EntradaDelGrafo = Readonly<{
  modulos: readonly EntradaDeModulo[];
  casos: readonly EntradaDeCaso[];
  rutas: readonly EntradaDeRuta[];
  /** Por ruta (`id`), los nombres que aparecen en los archivos que esa página alcanza sin pasar por la composición ni por los módulos. */
  nombresAlcanzadosPorRuta: ReadonlyMap<string, ReadonlySet<string>>;
  fichas: readonly EntradaDeFicha[];
  /** Acciones cuyo nombre aparece escrito en el código de los casos de uso (`exigirAcciones` dentro del caso), fuera de las declaraciones. */
  accionesExigidasDentroDeUnCaso: ReadonlySet<string>;
  migraciones: readonly EntradaDeMigracion[];
  tablas: readonly EntradaDeTabla[];
  maquetas: readonly EntradaDeMaqueta[];
  briefs: readonly EntradaDeBrief[];
}>;

const id = (tipo: TipoDeNodo, clave: string): string => `${tipo}:${clave}`;

/** Ordena por texto con comparación fija: el informe no depende del orden del sistema de archivos. */
const porTexto = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const sinTipo = (nodo: string): string => nodo.slice(nodo.indexOf(":") + 1);

/** `/caja/[id]` y `/caja/:id` y `/caja/{id}` son la misma ruta con un parámetro. */
export function normalizarRuta(ruta: string): string {
  const limpia = ruta.replace(/[?#].*$/, "").replace(/\/+$/, "");
  return (limpia === "" ? "/" : limpia)
    .split("/")
    .map((s) => (/^(\[.*\]|:.+|\{.*\})$/.test(s) ? "*" : s))
    .join("/");
}

/** El nombre de una maqueta sin extensión, para compararlo con el último tramo de una ruta (`mesas.html` ↔ `/salon/mesas`). */
const raizDeMaqueta = (nombre: string): string => nombre.replace(/\.html$/, "");

export function construirGrafo(entrada: EntradaDelGrafo): Grafo {
  const nodos = new Map<string, Nodo>();
  const aristas = new Map<string, Arista>();
  const nodo = (
    tipo: TipoDeNodo,
    clave: string,
    modulo: string | null,
    atributos: Readonly<Record<string, Atributo>> = {},
  ): string => {
    const nodoId = id(tipo, clave);
    if (!nodos.has(nodoId)) nodos.set(nodoId, { id: nodoId, tipo, modulo, atributos });
    return nodoId;
  };
  const arista = (de: string, hacia: string, tipo: TipoDeArista, via?: Arista["via"]): void => {
    if (!nodos.has(de) || !nodos.has(hacia)) return;
    aristas.set(
      `${de}|${tipo}|${hacia}`,
      via === undefined ? { de, hacia, tipo } : { de, hacia, tipo, via },
    );
  };

  const moduloDeAccion = new Map<string, string>();
  for (const m of entrada.modulos) {
    const moduloId = nodo("modulo", m.clave, m.clave, { estado: m.estado });
    for (const a of m.acciones) {
      moduloDeAccion.set(a, m.clave);
      arista(nodo("accion", a, m.clave), moduloId, "pertenece_a");
    }
  }
  const moduloDeCarpeta = new Map<string, string>();
  for (const m of entrada.modulos)
    for (const carpeta of m.implementadoPor) moduloDeCarpeta.set(carpeta, m.clave);

  // Casos de uso y consultas. Un nombre declarado en más de una carpeta es ambiguo: no se puede atribuir por nombre a una pantalla.
  const carpetasPorNombre = new Map<string, Set<string>>();
  for (const c of entrada.casos) {
    const set = carpetasPorNombre.get(c.nombre) ?? new Set<string>();
    set.add(c.carpeta);
    carpetasPorNombre.set(c.nombre, set);
  }
  const casoId = (c: EntradaDeCaso): string => `${c.carpeta}.${c.nombre}`;
  for (const c of entrada.casos) {
    const modulo =
      (c.accion === null ? undefined : moduloDeAccion.get(c.accion)) ??
      moduloDeCarpeta.get(`modulos/${c.carpeta}`) ??
      null;
    const ambiguo = (carpetasPorNombre.get(c.nombre)?.size ?? 0) > 1;
    const nodoCaso = nodo("caso_de_uso", casoId(c), modulo, {
      nombre: c.nombre,
      carpeta: c.carpeta,
      clase: c.clase,
      accion: c.accion,
      sinGuard: c.sinGuard !== null,
      nombreRepetido: ambiguo,
    });
    if (modulo !== null) arista(nodoCaso, id("modulo", modulo), "pertenece_a");
    for (const a of c.accion === null ? [] : [c.accion, ...c.tambien])
      arista(id("accion", a), nodoCaso, "protege");
  }

  // Pantallas y su alcance por nombre.
  const rutasPorTexto = new Map<string, string[]>();
  for (const r of entrada.rutas) {
    const nodoRuta = nodo("pantalla", r.id, null, { app: r.app, ruta: r.ruta, archivo: r.archivo });
    const lista = rutasPorTexto.get(r.ruta) ?? [];
    lista.push(nodoRuta);
    rutasPorTexto.set(r.ruta, lista);
  }
  for (const r of entrada.rutas) {
    const alcanzados = entrada.nombresAlcanzadosPorRuta.get(r.id);
    if (alcanzados === undefined) continue;
    for (const c of entrada.casos) {
      if (!alcanzados.has(c.nombre)) continue;
      const repetido = (carpetasPorNombre.get(c.nombre)?.size ?? 0) > 1;
      arista(
        id("caso_de_uso", casoId(c)),
        id("pantalla", r.id),
        "se_ve_en",
        repetido ? "dudosa" : "nombre",
      );
    }
  }

  // Fichas: acción → ficha → pantalla.
  for (const f of entrada.fichas) {
    const nodoFicha = nodo("ficha", f.id, null, { archivo: f.archivo });
    for (const ruta of f.rutas)
      for (const destino of rutasPorTexto.get(ruta) ?? [])
        arista(nodoFicha, destino, "se_ve_en", "declarada");
    for (const a of f.acciones) arista(id("accion", a), nodoFicha, "se_ve_en", "declarada");
  }

  // Maquetas: por la ficha que las cita (declarada) o, si nadie las cita, por el nombre contra el último tramo de una ruta.
  const maquetasCitadasPorFicha = new Map<string, EntradaDeFicha[]>();
  for (const f of entrada.fichas)
    for (const m of f.maquetasCitadas) {
      const lista = maquetasCitadasPorFicha.get(m) ?? [];
      lista.push(f);
      maquetasCitadasPorFicha.set(m, lista);
    }
  for (const m of entrada.maquetas) {
    const nodoMaqueta = nodo("maqueta", m.id, null, { nombre: m.nombre, carpeta: m.carpeta });
    const citantes = maquetasCitadasPorFicha.get(m.nombre) ?? [];
    for (const f of citantes)
      for (const ruta of f.rutas)
        for (const destino of rutasPorTexto.get(ruta) ?? [])
          arista(nodoMaqueta, destino, "dibuja", "declarada");
    if (citantes.length > 0) continue;
    const raiz = raizDeMaqueta(m.nombre);
    for (const r of entrada.rutas) {
      const ultimo = r.ruta
        .split("/")
        .filter((s) => s !== "")
        .at(-1);
      if (ultimo === raiz) arista(nodoMaqueta, id("pantalla", r.id), "dibuja", "nombre");
    }
  }

  // Tablas y migraciones.
  for (const mig of entrada.migraciones)
    nodo("migracion", mig.id, null, { tablas: mig.tablasCreadas.length });
  for (const t of entrada.tablas) {
    const nodoTabla = nodo("tabla", t.nombre, null, {
      migracion: t.migracion,
      retirada: t.retiradaEn !== null,
      escritaEnMigracion: t.escritaEnMigracion,
      lectores: t.lectores.length,
    });
    arista(id("migracion", t.migracion), nodoTabla, "crea");
    for (const origen of t.escritores) {
      const modulo = moduloDeCarpeta.get(origen);
      if (modulo !== undefined) arista(id("modulo", modulo), nodoTabla, "escribe");
    }
  }

  // Briefs: lo que cada uno nombra y existe.
  const rutasNormalizadas = new Map<string, string[]>();
  for (const r of entrada.rutas) {
    const clave = normalizarRuta(r.ruta);
    const lista = rutasNormalizadas.get(clave) ?? [];
    lista.push(id("pantalla", r.id));
    rutasNormalizadas.set(clave, lista);
  }
  const casosPorNombre = new Map<string, string[]>();
  for (const c of entrada.casos) {
    const lista = casosPorNombre.get(c.nombre) ?? [];
    lista.push(id("caso_de_uso", casoId(c)));
    casosPorNombre.set(c.nombre, lista);
  }
  for (const b of entrada.briefs) {
    const nodoBrief = nodo("brief", b.id, null, {
      pack: b.pack,
      titulo: b.titulo,
      archivo: b.archivo,
    });
    for (const a of b.acciones) arista(nodoBrief, id("accion", a), "declara");
    for (const r of b.rutas)
      for (const d of rutasNormalizadas.get(normalizarRuta(r)) ?? [])
        arista(nodoBrief, d, "declara");
    for (const f of b.funciones)
      for (const d of casosPorNombre.get(f) ?? []) arista(nodoBrief, d, "declara");
    for (const t of b.tablas) arista(nodoBrief, id("tabla", t), "declara");
    for (const m of b.maquetas)
      for (const mq of entrada.maquetas)
        if (mq.nombre === m) arista(nodoBrief, id("maqueta", mq.id), "declara");
  }

  return {
    nodos: [...nodos.values()].sort((a, b) => porTexto(a.id, b.id)),
    aristas: [...aristas.values()].sort((a, b) =>
      porTexto(`${a.de}|${a.tipo}|${a.hacia}`, `${b.de}|${b.tipo}|${b.hacia}`),
    ),
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Informe por categoría (solo mide).

export const CATEGORIAS = [
  "accion_sin_caso_de_uso",
  "accion_sin_caso_de_uso_ni_exigida_en_el_codigo",
  "caso_sin_modulo",
  "caso_sin_guard",
  "nombre_de_caso_repetido",
  "accion_con_pantalla",
  "accion_sin_pantalla",
  "accion_sin_pantalla_solo_por_nombre_repetido",
  "accion_sin_pantalla_solo_en_una_ficha",
  "caso_sin_pantalla",
  "accion_sin_ficha",
  "pantalla_sin_ficha",
  "ficha_sin_pantalla",
  "maqueta_sin_pantalla",
  "pantalla_sin_maqueta",
  "modulo_no_activo",
  "modulo_sin_caso_de_uso",
  "tabla_sin_escritor_en_el_codigo",
  "tabla_sin_lector_en_el_codigo",
  "tabla_retirada",
  "migracion_sin_tabla_escrita",
  "brief_con_codigo",
  "brief_parcial",
  "brief_sin_codigo",
  "brief_sin_enlace",
  "caso_sin_brief_por_nombre",
  "caso_sin_brief",
  "tabla_sin_brief",
  "pantalla_sin_brief",
  "pantalla_sin_brief_ni_maqueta",
] as const;
type Categoria = (typeof CATEGORIAS)[number];

type ResultadoDeCategoria = Readonly<{
  cuenta: number;
  /** Todos los ids (ordenados). El informe los lleva completos: es la lista de trabajo, no una muestra. */
  ids: readonly string[];
}>;

type EstadoDeBrief = "CON_CODIGO" | "PARCIAL" | "SIN_CODIGO" | "SIN_ENLACE";

type CruceDeBrief = Readonly<{
  id: string;
  pack: string;
  titulo: string;
  estado: EstadoDeBrief;
  existentes: readonly string[];
  faltantes: readonly string[];
}>;

export type InformeDelGrafo = Readonly<{
  medidas: Readonly<{
    nodosPorTipo: Readonly<Record<TipoDeNodo, number>>;
    aristasPorTipo: Readonly<Record<TipoDeArista, number>>;
    acciones: number;
    accionesConCasoDeUso: number;
    casosDeUso: number;
    paginas: number;
    fichas: number;
    maquetas: number;
    tablas: number;
    briefs: number;
  }>;
  categorias: Readonly<Record<Categoria, ResultadoDeCategoria>>;
  /** El cruce «briefs sin código» (diseño §7): cada brief contra el código de hoy. */
  briefsContraElCodigo: readonly CruceDeBrief[];
  briefsPorPack: Readonly<Record<string, Readonly<Record<EstadoDeBrief, number>>>>;
}>;

/** Lo que viene después del punto en un nombre que parece una acción pero es un archivo (`menu.ts`): no es una acción prometida. */
const EXTENSIONES_DE_ARCHIVO = new Set([
  "ts",
  "tsx",
  "js",
  "cjs",
  "mjs",
  "json",
  "md",
  "html",
  "sql",
  "css",
  "yml",
  "yaml",
  "txt",
]);

export function analizarGrafo(grafo: Grafo, entrada: EntradaDelGrafo): InformeDelGrafo {
  const nodosPorTipo = Object.fromEntries(TIPOS_DE_NODO.map((t) => [t, 0])) as Record<
    TipoDeNodo,
    number
  >;
  for (const n of grafo.nodos) nodosPorTipo[n.tipo] += 1;
  const aristasPorTipo = Object.fromEntries(TIPOS_DE_ARISTA.map((t) => [t, 0])) as Record<
    TipoDeArista,
    number
  >;
  for (const a of grafo.aristas) aristasPorTipo[a.tipo] += 1;

  const de = (tipo: TipoDeNodo): readonly Nodo[] => grafo.nodos.filter((n) => n.tipo === tipo);
  const mapaEntrantes = (tipo: TipoDeArista): Map<string, Arista[]> => {
    const m = new Map<string, Arista[]>();
    for (const a of grafo.aristas)
      if (a.tipo === tipo) (m.get(a.hacia) ?? m.set(a.hacia, []).get(a.hacia)!).push(a);
    return m;
  };
  const mapaSalientes = (tipo: TipoDeArista): Map<string, Arista[]> => {
    const m = new Map<string, Arista[]>();
    for (const a of grafo.aristas)
      if (a.tipo === tipo) (m.get(a.de) ?? m.set(a.de, []).get(a.de)!).push(a);
    return m;
  };

  const protege = mapaSalientes("protege"); // acción → casos
  const seVeEnDeCaso = mapaSalientes("se_ve_en"); // caso/ficha/acción → pantalla/ficha
  const seVeEnHacia = mapaEntrantes("se_ve_en"); // pantalla/ficha ← ...
  const dibujaHacia = mapaEntrantes("dibuja");
  const protegidoPor = mapaEntrantes("protege"); // caso ← acciones
  const declaraDe = mapaSalientes("declara");
  const creaDe = mapaSalientes("crea");

  const lista = (nodos: readonly string[]): ResultadoDeCategoria => {
    const ids = [...new Set(nodos)].sort(porTexto);
    return { cuenta: ids.length, ids };
  };

  const acciones = de("accion");
  const casos = de("caso_de_uso");
  const paginas = de("pantalla");

  // ---- Servidor ↔ pantalla.
  const casosDeLaAccion = (accion: string): readonly string[] =>
    (protege.get(accion) ?? []).map((a) => a.hacia);
  const pantallasDelCaso = (caso: string, via: "nombre" | "dudosa"): readonly string[] =>
    (seVeEnDeCaso.get(caso) ?? [])
      .filter((a) => a.via === via && a.hacia.startsWith("pantalla:"))
      .map((a) => a.hacia);
  const accionSinCaso = acciones.filter((a) => casosDeLaAccion(a.id).length === 0).map((a) => a.id);
  const accionConPantalla = acciones
    .filter((a) => casosDeLaAccion(a.id).some((c) => pantallasDelCaso(c, "nombre").length > 0))
    .map((a) => a.id);
  const conPantalla = new Set(accionConPantalla);
  const accionSinPantalla = acciones.filter((a) => !conPantalla.has(a.id)).map((a) => a.id);
  const soloPorNombreRepetido = accionSinPantalla.filter((a) =>
    casosDeLaAccion(a).some((c) => pantallasDelCaso(c, "dudosa").length > 0),
  );
  const accionSinCasoNiExigida = accionSinCaso.filter(
    (a) => !entrada.accionesExigidasDentroDeUnCaso.has(sinTipo(a)),
  );
  const casoSinPantalla = casos
    .filter((c) => pantallasDelCaso(c.id, "nombre").length === 0)
    .map((c) => c.id);

  // ---- Fichas.
  const accionesConFicha = new Set(
    grafo.aristas
      .filter((a) => a.tipo === "se_ve_en" && a.hacia.startsWith("ficha:"))
      .map((a) => a.de),
  );
  const accionSinFicha = acciones.filter((a) => !accionesConFicha.has(a.id)).map((a) => a.id);
  const fichasConPantalla = new Set(
    grafo.aristas
      .filter(
        (a) =>
          a.tipo === "se_ve_en" && a.de.startsWith("ficha:") && a.hacia.startsWith("pantalla:"),
      )
      .map((a) => a.de),
  );
  const soloEnUnaFicha = accionSinPantalla.filter((a) =>
    (seVeEnDeCaso.get(a) ?? []).some((x) => fichasConPantalla.has(x.hacia)),
  );
  const pantallaSinFicha = paginas
    .filter((p) => !(seVeEnHacia.get(p.id) ?? []).some((a) => a.de.startsWith("ficha:")))
    .map((p) => p.id);
  const fichaSinPantalla = de("ficha")
    .filter((f) => !(seVeEnDeCaso.get(f.id) ?? []).some((a) => a.hacia.startsWith("pantalla:")))
    .map((f) => f.id);

  // ---- Maquetas.
  const maquetaSinPantalla = de("maqueta")
    .filter((m) => !grafo.aristas.some((a) => a.tipo === "dibuja" && a.de === m.id))
    .map((m) => m.id);
  const pantallaSinMaqueta = paginas
    .filter((p) => !(dibujaHacia.get(p.id) ?? []).length)
    .map((p) => p.id);

  // ---- Módulos y casos.
  const modulos = de("modulo");
  const moduloNoActivo = modulos
    .filter((m) => m.atributos["estado"] !== "disponible")
    .map((m) => m.id);
  const moduloConCasos = new Set(casos.map((c) => c.modulo).filter((m): m is string => m !== null));
  const moduloSinCaso = modulos
    .filter((m) => !moduloConCasos.has(m.id.slice("modulo:".length)))
    .map((m) => m.id);
  const casoSinModulo = casos.filter((c) => c.modulo === null).map((c) => c.id);
  const casoSinGuard = casos.filter((c) => c.atributos["sinGuard"] === true).map((c) => c.id);
  const nombreRepetido = casos
    .filter((c) => c.atributos["nombreRepetido"] === true)
    .map((c) => c.id);

  // ---- Tablas y migraciones.
  const tablas = de("tabla");
  const escritasEnElCodigo = new Set(
    entrada.tablas.filter((t) => t.escritores.length > 0).map((t) => t.nombre),
  );
  const tablaSinEscritor = tablas
    .filter((t) => t.atributos["retirada"] !== true && !escritasEnElCodigo.has(sinTipo(t.id)))
    .map((t) => t.id);
  const tablaSinLector = tablas
    .filter((t) => t.atributos["retirada"] !== true && t.atributos["lectores"] === 0)
    .map((t) => t.id);
  const tablaRetirada = tablas.filter((t) => t.atributos["retirada"] === true).map((t) => t.id);
  const migracionSinTablaEscrita = de("migracion")
    .filter((m) => {
      const creadas = (creaDe.get(m.id) ?? []).map((a) => sinTipo(a.hacia));
      return creadas.length > 0 && creadas.every((t) => !escritasEnElCodigo.has(t));
    })
    .map((m) => m.id);

  // ---- Briefs contra el código (diseño §7, cruce 1).
  const nombresDeAccion = new Set(acciones.map((a) => sinTipo(a.id)));
  const prefijosDeAccion = new Set([...nombresDeAccion].map((a) => a.slice(0, a.indexOf("."))));
  const rutasExistentes = new Set(paginas.map((p) => normalizarRuta(String(p.atributos["ruta"]))));
  const casosExistentes = new Set(casos.map((c) => String(c.atributos["nombre"])));
  const cruces: CruceDeBrief[] = [];
  for (const b of entrada.briefs) {
    const existentes: string[] = [];
    const faltantes: string[] = [];
    for (const a of b.acciones) {
      if (nombresDeAccion.has(a)) existentes.push(`accion:${a}`);
      else {
        const [prefijo = "", sufijo = ""] = a.split(".");
        if (prefijosDeAccion.has(prefijo) && !EXTENSIONES_DE_ARCHIVO.has(sufijo))
          faltantes.push(`accion:${a}`);
      }
    }
    for (const r of b.rutas) {
      if (rutasExistentes.has(normalizarRuta(r))) existentes.push(`ruta:${r}`);
      else faltantes.push(`ruta:${r}`);
    }
    for (const f of b.funciones) if (casosExistentes.has(f)) existentes.push(`caso:${f}`);
    let estado: EstadoDeBrief;
    if (existentes.length + faltantes.length === 0) estado = "SIN_ENLACE";
    else if (faltantes.length === 0) estado = "CON_CODIGO";
    else if (existentes.length > 0) estado = "PARCIAL";
    else estado = "SIN_CODIGO";
    cruces.push({
      id: b.id,
      pack: b.pack,
      titulo: b.titulo,
      estado,
      existentes: [...new Set(existentes)].sort(porTexto),
      faltantes: [...new Set(faltantes)].sort(porTexto),
    });
  }
  cruces.sort((a, b) => porTexto(a.id, b.id));
  const briefsPorPack: Record<string, Record<EstadoDeBrief, number>> = {};
  for (const c of cruces) {
    const fila = (briefsPorPack[c.pack] ??= {
      CON_CODIGO: 0,
      PARCIAL: 0,
      SIN_CODIGO: 0,
      SIN_ENLACE: 0,
    });
    fila[c.estado] += 1;
  }
  const deEstado = (e: EstadoDeBrief): readonly string[] =>
    cruces.filter((c) => c.estado === e).map((c) => `brief:${c.id}`);

  // ---- Código sin brief (diseño §7, cruce 2): ningún brief lo nombra.
  const declarado = new Set<string>();
  for (const origen of de("brief"))
    for (const a of declaraDe.get(origen.id) ?? []) declarado.add(a.hacia);
  const accionesDeclaradas = new Set(
    [...declarado].filter((d) => d.startsWith("accion:")).map((d) => sinTipo(d)),
  );
  const casoSinBriefPorNombre = casos.filter((c) => !declarado.has(c.id));
  const casoSinBrief = casoSinBriefPorNombre
    .filter(
      (c) => !(protegidoPor.get(c.id) ?? []).some((a) => accionesDeclaradas.has(sinTipo(a.de))),
    )
    .map((c) => c.id);
  const tablaSinBrief = tablas
    .filter((t) => t.atributos["retirada"] !== true && !declarado.has(t.id))
    .map((t) => t.id);
  const pantallaSinBrief = paginas.filter((p) => !declarado.has(p.id)).map((p) => p.id);
  const sinBriefNiMaqueta = pantallaSinBrief.filter((p) => pantallaSinMaqueta.includes(p));

  const categorias: Record<Categoria, ResultadoDeCategoria> = {
    accion_sin_caso_de_uso: lista(accionSinCaso),
    accion_sin_caso_de_uso_ni_exigida_en_el_codigo: lista(accionSinCasoNiExigida),
    caso_sin_modulo: lista(casoSinModulo),
    caso_sin_guard: lista(casoSinGuard),
    nombre_de_caso_repetido: lista(nombreRepetido),
    accion_con_pantalla: lista(accionConPantalla),
    accion_sin_pantalla: lista(accionSinPantalla),
    accion_sin_pantalla_solo_por_nombre_repetido: lista(soloPorNombreRepetido),
    accion_sin_pantalla_solo_en_una_ficha: lista(soloEnUnaFicha),
    caso_sin_pantalla: lista(casoSinPantalla),
    accion_sin_ficha: lista(accionSinFicha),
    pantalla_sin_ficha: lista(pantallaSinFicha),
    ficha_sin_pantalla: lista(fichaSinPantalla),
    maqueta_sin_pantalla: lista(maquetaSinPantalla),
    pantalla_sin_maqueta: lista(pantallaSinMaqueta),
    modulo_no_activo: lista(moduloNoActivo),
    modulo_sin_caso_de_uso: lista(moduloSinCaso),
    tabla_sin_escritor_en_el_codigo: lista(tablaSinEscritor),
    tabla_sin_lector_en_el_codigo: lista(tablaSinLector),
    tabla_retirada: lista(tablaRetirada),
    migracion_sin_tabla_escrita: lista(migracionSinTablaEscrita),
    brief_con_codigo: lista(deEstado("CON_CODIGO")),
    brief_parcial: lista(deEstado("PARCIAL")),
    brief_sin_codigo: lista(deEstado("SIN_CODIGO")),
    brief_sin_enlace: lista(deEstado("SIN_ENLACE")),
    caso_sin_brief_por_nombre: lista(casoSinBriefPorNombre.map((c) => c.id)),
    caso_sin_brief: lista(casoSinBrief),
    tabla_sin_brief: lista(tablaSinBrief),
    pantalla_sin_brief: lista(pantallaSinBrief),
    pantalla_sin_brief_ni_maqueta: lista(sinBriefNiMaqueta),
  };

  return {
    medidas: {
      nodosPorTipo,
      aristasPorTipo,
      acciones: acciones.length,
      accionesConCasoDeUso: acciones.length - accionSinCaso.length,
      casosDeUso: casos.length,
      paginas: paginas.length,
      fichas: de("ficha").length,
      maquetas: de("maqueta").length,
      tablas: tablas.length,
      briefs: entrada.briefs.length,
    },
    categorias,
    briefsContraElCodigo: cruces,
    briefsPorPack,
  };
}
