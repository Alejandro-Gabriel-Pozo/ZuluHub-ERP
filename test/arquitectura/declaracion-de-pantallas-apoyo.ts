import ts from "typescript";
import type { DefinicionDeCamino } from "../../src/capacidades/datos/tipos-de-caminos";
import type { FichaDePantalla } from "../../src/capacidades/pantallas/tipos-de-fichas";
import type { DefinicionDeTexto } from "../../src/capacidades/vocabulario/catalogo";
import type { UsoDeTexto } from "../../src/capacidades/vocabulario/uso-y-fuente-de-texto";
import {
  atributo,
  esDeTipos,
  literalDe,
  literalesDe,
  TIPOS_DE_SCRIPT,
} from "./campos-con-dato-apoyo";

/**
 * ANALIZADOR ÚNICO de declaraciones (tramo U2 de `Pedernal-docs/11-especificaciones/ficha-de-pantalla-diseno.md` §7 bis; decisión del
 * dueño, filas 173 y 174 de `decisiones-del-dueno-2026-11.md`: un texto o una pantalla no declarados no existen). Lee `texto()`, los
 * botones, los modales y los campos UNA vez por archivo y de ahí salen las reglas:
 *  - R1 texto sin declarar: una clave citada que no está en el catálogo, o que está pero sin `usos`;
 *  - R2 consumidor no declarado: una clave con `usos` citada desde donde sus `usos` no dicen;
 *  - R3 texto sin consumidor: una clave con `usos` que ninguno de sus usos cita (o con `usos` vacío);
 *  - R4 uso declarado inexistente: un uso que apunta a un archivo, una función o un dato que no existe;
 *  - P1 botón sin `boton="…"` o con un id que la ficha no declara; P3 campo fuera de la ficha; P4 modal sin `modal="…"` o no declarado
 *    (P1, P3 y P4 solo en los archivos que una ficha nombra; fuera de las fichas se MIDEN: `medidas.botonesSinId`, `modalesSinId`);
 *  - P2 botón de la ficha sin acción, con una acción que no existe o de otro módulo.
 * Reutiliza de `campos-con-dato-apoyo.ts` el modo de leer atributos y literales; los campos (control crudo, dato registrado) los sigue
 * midiendo `campos-con-dato`, acá solo se lee el `dato` de cada campo para compararlo con la ficha.
 *
 * Es puro: recibe el código y los registros ya leídos, no toca el disco. Fail-closed (`CLAUDE.md` «Todo nace cerrado»): lo que no se
 * puede analizar es un hallazgo `NO_ANALIZABLE` (error de sintaxis, `texto` con alias o pasado como valor, clave que no es un literal,
 * `boton=`/`modal=` con una expresión o con `{...props}` que podría traerlo, alias o espacio de nombres de los componentes, archivo de
 * una ficha que no existe, módulo de la ficha que no se puede determinar).
 * Límites que NO ve (alarma para errores honestos, no un límite de seguridad): una clave armada con una plantilla o con una función
 * propia (cuenta como NO_ANALIZABLE solo si pasa por `texto()`); una clave que pasa por una variable intermedia; un `texto` local que
 * tapa al importado; texto traído de la base o de un servicio; botones o modales de componentes fuera de las listas cerradas
 * (`componentes-de-ficha.ts`); la calidad de la palabra, que decide quien la acepta.
 */

type Regla = "R1" | "R2" | "R3" | "R4" | "P1" | "P2" | "P3" | "P4";
type Hallazgo = Readonly<{
  regla: Regla | "NO_ANALIZABLE";
  archivo: string;
  /** Línea (desde 1), o `null` si el hallazgo es de un dato y no de una línea de código. */
  linea: number | null;
  detalle: string;
}>;

export type ContextoDeDeclaraciones = Readonly<{
  /** El catálogo de textos: solo se mira si la clave existe y sus `usos`. */
  catalogo: Readonly<Record<string, DefinicionDeTexto>>;
  /** El registro de datos: solo los archivos que consumen cada dato. */
  datos: Readonly<Record<string, Readonly<{ consumidores: readonly string[] }>>>;
  caminos: Readonly<Record<string, DefinicionDeCamino>>;
  fichas: Readonly<Record<string, FichaDePantalla>>;
  /** Todo el código que consume textos (ruta desde la raíz → contenido); sin pruebas. */
  codigo: ReadonlyMap<string, string>;
  componentesDeBoton: readonly string[];
  componentesDeModal: readonly string[];
  componentesDeCampo: readonly string[];
  /** El módulo (`ClaveModulo`) dueño de una acción de permiso, o `undefined` si no existe. */
  moduloDeAccion: (accion: string) => string | undefined;
  /** El módulo dueño de un archivo (tabla de frontera, tramo U0), o `undefined` si todavía no se puede saber. */
  moduloDeArchivo: (ruta: string) => string | undefined;
}>;

export type Informe = Readonly<{
  hallazgos: readonly Hallazgo[];
  porRegla: Readonly<Record<Regla | "NO_ANALIZABLE", number>>;
  medidas: Readonly<{
    archivosAnalizados: number;
    clavesEnElCatalogo: number;
    clavesConUsos: number;
    clavesConUsosPendientes: number;
    clavesSinUsos: number;
    /** Claves del catálogo que ningún archivo analizado cita (la ficha las puede citar: ver R3). */
    clavesSinCitar: number;
    citasLiterales: number;
    llamadasATexto: number;
    botones: number;
    botonesSinId: number;
    modales: number;
    modalesSinId: number;
    camposConDato: number;
    fichas: number;
  }>;
}>;

/** El catálogo y las fichas citan las claves como DATOS, no las consumen: sus archivos no cuentan como consumidores. */
const PREFIJOS_QUE_NO_CONSUMEN = [
  "src/capacidades/vocabulario/",
  "src/capacidades/pantallas/",
] as const;
const FORMA_DE_CLAVE = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+){1,5}$/;
const ESPECIFICADOR_DE_VOCABULARIO = /vocabulario/;
const FUNCIONES_DE_TEXTO = new Map([
  ["texto", 1],
  ["textoContra", 2],
]);

type Cita = Readonly<{ clave: string; linea: number; contenedores: readonly string[] }>;
type UsoDeComponente = Readonly<{ linea: number; id: string | null }>;
type Hechos = Readonly<{
  citas: readonly Cita[];
  llamadasATexto: readonly Readonly<{ clave: string; linea: number }>[];
  declarados: ReadonlySet<string>;
  botones: readonly UsoDeComponente[];
  modales: readonly UsoDeComponente[];
  camposConDato: readonly Readonly<{ linea: number; dato: string | null }>[];
  noAnalizables: readonly Readonly<{ linea: number; detalle: string }>[];
}>;

/** El último tramo de una ruta de import es un componente (`Boton.cliente`, `Superposicion`), no una hoja de estilos ni una imagen. */
const ES_UN_COMPONENTE = /^[A-Za-z]+(\.cliente)?(\.[cm]?[jt]sx?)?$/;
const ultimoTramo = (ruta: string): string => ruta.split("/").pop() ?? ruta;
const nombreDelTag = (ruta: string): string =>
  (ruta.split("/").pop() ?? ruta).split(".")[0] ?? ruta;

/** Qué ve el analizador de un archivo. `esImplementacion`: el archivo ES un componente vigilado (no se cuentan sus botones ni modales). */
function extraerHechos(
  ruta: string,
  texto: string,
  vigilados: Readonly<{
    botones: ReadonlySet<string>;
    modales: ReadonlySet<string>;
    campos: ReadonlySet<string>;
  }>,
  esImplementacion: boolean,
): Hechos {
  const tipo = TIPOS_DE_SCRIPT[ruta.split(".").pop() ?? ""] ?? ts.ScriptKind.TSX;
  const fuente = ts.createSourceFile(ruta, texto, ts.ScriptTarget.Latest, true, tipo);
  const linea = (nodo: ts.Node): number =>
    fuente.getLineAndCharacterOfPosition(nodo.getStart(fuente)).line + 1;
  const citas: Cita[] = [];
  const llamadasATexto: { clave: string; linea: number }[] = [];
  const declarados = new Set<string>();
  const botones: UsoDeComponente[] = [];
  const modales: UsoDeComponente[] = [];
  const camposConDato: { linea: number; dato: string | null }[] = [];
  const noAnalizables: { linea: number; detalle: string }[] = [];
  const noSePuede = (donde: number, detalle: string): void => {
    noAnalizables.push({ linea: donde, detalle });
  };
  const sintaxis = (fuente as unknown as { parseDiagnostics?: readonly unknown[] })
    .parseDiagnostics;
  if (sintaxis === undefined || sintaxis.length > 0) {
    noSePuede(1, "error de sintaxis (o no se pudo leer): el archivo no se puede analizar");
  }
  const vigilanTodos = new Set([...vigilados.botones, ...vigilados.modales]);
  /** Los nombres LOCALES con que este archivo importó `texto` y `textoContra` del vocabulario. */
  const textoLocal = new Map<string, number>();

  for (const sentencia of fuente.statements) {
    if (!ts.isImportDeclaration(sentencia) || !ts.isStringLiteral(sentencia.moduleSpecifier))
      continue;
    const origen = sentencia.moduleSpecifier.text;
    const clausula = sentencia.importClause;
    if (clausula === undefined || clausula.isTypeOnly) continue;
    const delVocabulario = ESPECIFICADOR_DE_VOCABULARIO.test(origen);
    if (
      clausula.name !== undefined &&
      ES_UN_COMPONENTE.test(ultimoTramo(origen)) &&
      vigilanTodos.has(nombreDelTag(origen))
    ) {
      if (clausula.name.text !== nombreDelTag(origen))
        noSePuede(
          linea(sentencia),
          `${origen} se importa con otro nombre: el alias esconde el componente`,
        );
    }
    const enlaces = clausula.namedBindings;
    if (enlaces !== undefined && ts.isNamespaceImport(enlaces)) {
      if (
        delVocabulario ||
        (ES_UN_COMPONENTE.test(ultimoTramo(origen)) && vigilanTodos.has(nombreDelTag(origen)))
      )
        noSePuede(
          linea(sentencia),
          `${origen} se importa como espacio de nombres: no se puede seguir qué usa`,
        );
    }
    if (enlaces !== undefined && ts.isNamedImports(enlaces)) {
      for (const e of enlaces.elements) {
        if (e.isTypeOnly) continue;
        const original = (e.propertyName ?? e.name).text;
        const alias = e.propertyName !== undefined && e.propertyName.text !== e.name.text;
        const posicion = FUNCIONES_DE_TEXTO.get(original);
        if (delVocabulario && posicion !== undefined) {
          textoLocal.set(e.name.text, posicion);
          if (alias) noSePuede(linea(e), `${original} se importa con el alias ${e.name.text}`);
        } else if (vigilanTodos.has(original) && alias) {
          noSePuede(
            linea(e),
            `${original} se importa con el alias ${e.name.text}: esconde el componente`,
          );
        }
      }
    }
  }

  const contenedoresDe = (nodo: ts.Node): string[] => {
    const nombres = new Set<string>();
    for (let p: ts.Node | undefined = nodo.parent; p !== undefined; p = p.parent) {
      if (
        (ts.isFunctionDeclaration(p) || ts.isClassDeclaration(p) || ts.isMethodDeclaration(p)) &&
        p.name !== undefined &&
        ts.isIdentifier(p.name)
      )
        nombres.add(p.name.text);
      if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) nombres.add(p.name.text);
    }
    return [...nombres];
  };

  const usoDe = (
    nodo: ts.JsxOpeningLikeElement,
    prop: "boton" | "modal",
    destino: UsoDeComponente[],
    etiqueta: string,
  ): void => {
    const atributos = nodo.attributes.properties;
    const dato = atributo(atributos, prop, fuente);
    if (dato === undefined) {
      if (atributos.some(ts.isJsxSpreadAttribute)) {
        noSePuede(
          linea(nodo),
          `<${etiqueta}> tiene {...props}: podría traer ${prop}="…" y no se puede saber`,
        );
      } else destino.push({ linea: linea(nodo), id: null });
      return;
    }
    const literal = literalDe(dato);
    if (literal === undefined || literal === "") {
      noSePuede(
        linea(nodo),
        `<${etiqueta}> declara ${prop} con una expresión o vacío: tiene que ser un literal`,
      );
    } else destino.push({ linea: linea(nodo), id: literal });
  };

  const mirar = (nodo: ts.Node): void => {
    if (
      (ts.isFunctionDeclaration(nodo) ||
        ts.isClassDeclaration(nodo) ||
        ts.isMethodDeclaration(nodo)) &&
      nodo.name !== undefined &&
      ts.isIdentifier(nodo.name)
    )
      declarados.add(nodo.name.text);
    if (ts.isVariableDeclaration(nodo) && ts.isIdentifier(nodo.name))
      declarados.add(nodo.name.text);

    if (ts.isCallExpression(nodo) && ts.isIdentifier(nodo.expression)) {
      const posicion = textoLocal.get(nodo.expression.text);
      if (posicion !== undefined) {
        const argumento = nodo.arguments[posicion];
        const valores =
          argumento === undefined || nodo.arguments.some(ts.isSpreadElement)
            ? undefined
            : literalesDe(argumento);
        if (valores === undefined) {
          noSePuede(
            linea(nodo),
            `${nodo.expression.text}(…) con una clave que no es un literal: no se sabe qué texto pide`,
          );
        } else {
          for (const clave of valores) llamadasATexto.push({ clave, linea: linea(nodo) });
        }
      }
    }
    if (ts.isIdentifier(nodo) && textoLocal.has(nodo.text) && !esDeTipos(nodo)) {
      const p = nodo.parent;
      const comoLlamada = ts.isCallExpression(p) && p.expression === nodo;
      const declaracion =
        ts.isImportSpecifier(p) ||
        (ts.isPropertyAccessExpression(p) && p.name === nodo) ||
        (ts.isPropertyAssignment(p) && p.name === nodo) ||
        (ts.isParameter(p) && p.name === nodo) ||
        (ts.isVariableDeclaration(p) && p.name === nodo);
      if (!comoLlamada && !declaracion)
        noSePuede(
          linea(nodo),
          `${nodo.text} se usa como valor (no como llamada directa): esconde qué claves pide`,
        );
    }
    if (
      (ts.isStringLiteral(nodo) || ts.isNoSubstitutionTemplateLiteral(nodo)) &&
      FORMA_DE_CLAVE.test(nodo.text) &&
      !(ts.isImportDeclaration(nodo.parent) || ts.isExportDeclaration(nodo.parent)) &&
      !esDeTipos(nodo)
    ) {
      citas.push({ clave: nodo.text, linea: linea(nodo), contenedores: contenedoresDe(nodo) });
    }

    if (ts.isJsxOpeningElement(nodo) || ts.isJsxSelfClosingElement(nodo)) {
      const tag = nodo.tagName;
      if (!ts.isIdentifier(tag)) {
        const ultimo = ts.isPropertyAccessExpression(tag) ? tag.name.text : "";
        if (vigilanTodos.has(ultimo))
          noSePuede(
            linea(nodo),
            `<${tag.getText(fuente)}> usa un componente vigilado por un nombre compuesto`,
          );
      } else if (!esImplementacion && (vigilados.botones.has(tag.text) || tag.text === "button")) {
        usoDe(nodo, "boton", botones, tag.text);
      } else if (!esImplementacion && (vigilados.modales.has(tag.text) || tag.text === "dialog")) {
        usoDe(nodo, "modal", modales, tag.text);
      } else if (vigilados.campos.has(tag.text)) {
        const dato = literalDe(atributo(nodo.attributes.properties, "dato", fuente));
        camposConDato.push({ linea: linea(nodo), dato: dato ?? null });
      }
    }
    if (ts.isIdentifier(nodo) && vigilanTodos.has(nodo.text) && !esDeTipos(nodo)) {
      const p = nodo.parent;
      const comoTag =
        (ts.isJsxOpeningElement(p) || ts.isJsxSelfClosingElement(p) || ts.isJsxClosingElement(p)) &&
        p.tagName === nodo;
      const enImport = ts.isImportSpecifier(p) || ts.isImportClause(p);
      const declaracion =
        ((ts.isFunctionDeclaration(p) || ts.isVariableDeclaration(p)) && p.name === nodo) ||
        (ts.isPropertyAccessExpression(p) && p.name === nodo) ||
        (ts.isPropertyAssignment(p) && p.name === nodo);
      if (!comoTag && !enImport && !declaracion && !esImplementacion)
        noSePuede(
          linea(nodo),
          `${nodo.text} se usa fuera de un tag JSX directo: esconde el botón o el modal`,
        );
    }
    ts.forEachChild(nodo, mirar);
  };
  mirar(fuente);
  return { citas, llamadasATexto, declarados, botones, modales, camposConDato, noAnalizables };
}

/** Todos los textos que una ficha cita (título, rótulos, botones, modales, estados y textos propios). */
function textosDeUnaFicha(ficha: FichaDePantalla): ReadonlySet<string> {
  const textos = new Set<string>([ficha.titulo, ...Object.values(ficha.rotulos), ...ficha.textos]);
  for (const b of ficha.botones) textos.add(b.texto);
  for (const m of ficha.modales) {
    textos.add(m.titulo);
    for (const b of m.botones) textos.add(b.texto);
  }
  for (const valor of Object.values(ficha.estados))
    if (valor !== undefined && valor !== "GENERICO") textos.add(valor);
  return textos;
}

const idsDeBotones = (f: FichaDePantalla): string[] => [
  ...f.botones.map((b) => b.id),
  ...f.modales.flatMap((m) => m.botones.map((b) => b.id)),
];
const datosDeLosCaminos = (
  f: FichaDePantalla,
  caminos: ContextoDeDeclaraciones["caminos"],
): string[] =>
  f.caminos.flatMap((id) => (caminos[id]?.pasos ?? []).flatMap((p) => Object.values(p.campos)));

/** Corre todas las reglas sobre el código y las fichas dados. */
export function analizarDeclaraciones(contexto: ContextoDeDeclaraciones): Informe {
  const hallazgos: Hallazgo[] = [];
  const agregar = (
    regla: Hallazgo["regla"],
    archivo: string,
    linea: number | null,
    detalle: string,
  ): void => {
    hallazgos.push({ regla, archivo, linea, detalle });
  };
  const vigilados = {
    botones: new Set(contexto.componentesDeBoton.map(nombreDelTag)),
    modales: new Set(contexto.componentesDeModal.map(nombreDelTag)),
    campos: new Set(contexto.componentesDeCampo.map(nombreDelTag)),
  };
  const implementaciones = new Set([
    ...contexto.componentesDeBoton,
    ...contexto.componentesDeModal,
  ]);
  const hechos = new Map<string, Hechos>();
  for (const [ruta, texto] of contexto.codigo) {
    hechos.set(ruta, extraerHechos(ruta, texto, vigilados, implementaciones.has(ruta)));
  }
  for (const [ruta, h] of hechos)
    for (const n of h.noAnalizables) agregar("NO_ANALIZABLE", ruta, n.linea, n.detalle);

  // Las citas de las claves del catálogo desde los archivos que consumen textos.
  const consumidores = [...hechos].filter(
    ([ruta]) => !PREFIJOS_QUE_NO_CONSUMEN.some((p) => ruta.startsWith(p)),
  );
  const citasPorClave = new Map<string, { ruta: string; cita: Cita }[]>();
  let citasLiterales = 0;
  let llamadasATexto = 0;
  for (const [ruta, h] of consumidores) {
    for (const cita of h.citas) {
      if (!Object.hasOwn(contexto.catalogo, cita.clave)) continue;
      citasLiterales += 1;
      citasPorClave.set(cita.clave, [...(citasPorClave.get(cita.clave) ?? []), { ruta, cita }]);
    }
    for (const llamada of h.llamadasATexto) {
      llamadasATexto += 1;
      if (!Object.hasOwn(contexto.catalogo, llamada.clave))
        agregar(
          "R1",
          ruta,
          llamada.linea,
          `texto(…) pide «${llamada.clave}», que no está en el catálogo`,
        );
    }
  }

  // Fichas: los textos que cita cada una y los archivos que nombra.
  const fichas = Object.entries(contexto.fichas);
  const textosPorFicha = new Map(fichas.map(([id, f]) => [id, textosDeUnaFicha(f)]));
  const fichaCita = (clave: string): boolean =>
    [...textosPorFicha.values()].some((t) => t.has(clave));
  const fichaDelArchivoCita = (ruta: string, clave: string): boolean =>
    fichas.some(
      ([id, f]) => f.archivos.includes(ruta) && (textosPorFicha.get(id) ?? new Set()).has(clave),
    );

  const claves = Object.keys(contexto.catalogo);
  let clavesConUsos = 0;
  let clavesPendientes = 0;
  let clavesSinUsos = 0;
  let clavesSinCitar = 0;
  const cubre = (
    uso: UsoDeTexto,
    clave: string,
    ruta: string,
    contenedores: readonly string[],
  ): boolean => {
    if (uso === "DE_FICHA") return fichaDelArchivoCita(ruta, clave);
    if (uso.como === "FUNCION") return uso.archivo === ruta && contenedores.includes(uso.nombre);
    return contexto.datos[uso.dato]?.consumidores.includes(ruta) ?? false;
  };
  for (const clave of claves) {
    const citas = citasPorClave.get(clave) ?? [];
    if (citas.length === 0 && !fichaCita(clave)) clavesSinCitar += 1;
    const usos = contexto.catalogo[clave]?.usos;
    if (usos === undefined) {
      clavesSinUsos += 1;
      const primera = citas[0];
      if (primera !== undefined)
        agregar(
          "R1",
          primera.ruta,
          primera.cita.linea,
          `«${clave}» se usa pero no declara sus usos (${citas.length} citas)`,
        );
      continue;
    }
    if (usos === "pendiente") {
      clavesPendientes += 1;
      continue;
    }
    clavesConUsos += 1;
    if (usos.length === 0) {
      // El tipo lo impide, pero el dato puede venir de cualquier lado: un texto sin usos no tiene consumidor.
      agregar(
        "R3",
        "src/capacidades/vocabulario",
        null,
        `«${clave}» declara usos vacíos: no tiene consumidor`,
      );
      continue;
    }
    for (const { ruta, cita } of citas) {
      if (!usos.some((u) => cubre(u, clave, ruta, cita.contenedores)))
        agregar(
          "R2",
          ruta,
          cita.linea,
          `«${clave}» se usa en ${cita.contenedores.join("/") || "el módulo"} y sus usos no lo declaran`,
        );
    }
    const ejercido = usos.some((u) => {
      if (u === "DE_FICHA") return fichaCita(clave);
      return citas.some(({ ruta, cita }) => cubre(u, clave, ruta, cita.contenedores));
    });
    if (!ejercido)
      agregar(
        "R3",
        "src/capacidades/vocabulario",
        null,
        `«${clave}» declara usos pero ninguno lo cita`,
      );
    for (const u of usos) {
      if (u === "DE_FICHA") continue;
      if (u.como === "DATO") {
        if (!Object.hasOwn(contexto.datos, u.dato))
          agregar(
            "R4",
            "src/capacidades/vocabulario",
            null,
            `«${clave}» declara el dato «${u.dato}», que no existe`,
          );
      } else {
        const destino = hechos.get(u.archivo);
        if (destino === undefined)
          agregar(
            "R4",
            u.archivo,
            null,
            `«${clave}» declara el archivo ${u.archivo}, que no existe (o no se analiza)`,
          );
        else if (!destino.declarados.has(u.nombre))
          agregar(
            "R4",
            u.archivo,
            null,
            `«${clave}» declara la función ${u.nombre}, que ${u.archivo} no declara`,
          );
      }
    }
  }

  // Botones, modales y campos: medidas en todo el código; reglas en los archivos que una ficha nombra.
  let botones = 0;
  let botonesSinId = 0;
  let modales = 0;
  let modalesSinId = 0;
  let camposConDato = 0;
  for (const [ruta, h] of hechos) {
    botones += h.botones.length;
    botonesSinId += h.botones.filter((b) => b.id === null).length;
    modales += h.modales.length;
    modalesSinId += h.modales.filter((m) => m.id === null).length;
    camposConDato += h.camposConDato.length;
    const delArchivo = fichas.filter(([, f]) => f.archivos.includes(ruta)).map(([, f]) => f);
    if (delArchivo.length === 0) continue;
    const idsDeBoton = new Set(delArchivo.flatMap(idsDeBotones));
    const idsDeModal = new Set(delArchivo.flatMap((f) => f.modales.map((m) => m.id)));
    const datos = new Set(delArchivo.flatMap((f) => datosDeLosCaminos(f, contexto.caminos)));
    for (const b of h.botones) {
      if (b.id === null) agregar("P1", ruta, b.linea, 'botón sin boton="…"');
      else if (!idsDeBoton.has(b.id))
        agregar("P1", ruta, b.linea, `botón «${b.id}» que ninguna ficha de este archivo declara`);
    }
    for (const m of h.modales) {
      if (m.id === null) agregar("P4", ruta, m.linea, 'modal sin modal="…"');
      else if (!idsDeModal.has(m.id))
        agregar("P4", ruta, m.linea, `modal «${m.id}» que ninguna ficha de este archivo declara`);
    }
    for (const c of h.camposConDato) {
      if (c.dato === null)
        agregar("P3", ruta, c.linea, "campo sin dato literal: no se puede comparar con la ficha");
      else if (!datos.has(c.dato))
        agregar(
          "P3",
          ruta,
          c.linea,
          `campo con el dato «${c.dato}», que ningún paso de los caminos de la ficha completa`,
        );
    }
  }

  // P2 y los archivos de cada ficha: datos de la ficha, no de una línea de código.
  for (const [id, f] of fichas) {
    for (const archivo of f.archivos)
      if (!hechos.has(archivo))
        agregar(
          "NO_ANALIZABLE",
          archivo,
          null,
          `la ficha ${id} nombra un archivo que no existe (o no se analiza)`,
        );
    const modulos = new Set(
      f.archivos.map(contexto.moduloDeArchivo).filter((m): m is string => m !== undefined),
    );
    const botonesDeLaFicha = [...f.botones, ...f.modales.flatMap((m) => m.botones)];
    const modalesDeclarados = new Set(f.modales.map((m) => m.id));
    for (const b of botonesDeLaFicha) {
      const hace = b.hace as Readonly<Record<string, unknown>>;
      const acciones = ["envia", "navega", "abre"].filter(
        (k) => typeof hace[k] === "string" && hace[k] !== "",
      );
      if (acciones.length !== 1) {
        agregar(
          "P2",
          id,
          null,
          `el botón «${b.id}» tiene que hacer una sola cosa (envia, navega o abre): hace ${acciones.length}`,
        );
        continue;
      }
      if ("abre" in b.hace && !modalesDeclarados.has(b.hace.abre))
        agregar(
          "P4",
          id,
          null,
          `el botón «${b.id}» abre el modal «${b.hace.abre}», que la ficha no declara`,
        );
      if (!("envia" in b.hace)) continue;
      const modulo = contexto.moduloDeAccion(b.hace.envia);
      if (modulo === undefined)
        agregar(
          "P2",
          id,
          null,
          `el botón «${b.id}» envía «${b.hace.envia}», que no es una acción del catálogo`,
        );
      else if (modulos.size === 0)
        agregar(
          "NO_ANALIZABLE",
          id,
          null,
          `la ficha ${id} no tiene un módulo determinable: no se puede comprobar la acción «${b.hace.envia}»`,
        );
      else if (!modulos.has(modulo))
        agregar(
          "P2",
          id,
          null,
          `el botón «${b.id}» envía «${b.hace.envia}», de ${modulo}: la ficha es de ${[...modulos].join(", ")}`,
        );
    }
  }

  const porRegla = Object.fromEntries(
    (["R1", "R2", "R3", "R4", "P1", "P2", "P3", "P4", "NO_ANALIZABLE"] as const).map((r) => [
      r,
      hallazgos.filter((h) => h.regla === r).length,
    ]),
  ) as Informe["porRegla"];
  return {
    hallazgos,
    porRegla,
    medidas: {
      archivosAnalizados: hechos.size,
      clavesEnElCatalogo: claves.length,
      clavesConUsos,
      clavesConUsosPendientes: clavesPendientes,
      clavesSinUsos,
      clavesSinCitar,
      citasLiterales,
      llamadasATexto,
      botones,
      botonesSinId,
      modales,
      modalesSinId,
      camposConDato,
      fichas: fichas.length,
    },
  };
}
