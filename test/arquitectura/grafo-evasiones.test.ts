import { describe, expect, it } from "vitest";
import {
  analizarGrafo,
  CATEGORIAS,
  construirGrafo,
  normalizarRuta,
  type EntradaDelGrafo,
} from "./grafo-apoyo";
import {
  accionesExigidasDentroDeUnCaso,
  casosDeDeclaraciones,
  maquetasCitadas,
  nombresAlcanzadosPorPagina,
  rutaDePagina,
  sinComentarios,
  usoDeTablas,
  type LecturaDeMigraciones,
} from "./grafo-lectores";

/**
 * Una violación inyectada por categoría del grafo (etapa 0, solo mide): cada caso arma un mundo chico con UN defecto y comprueba que el
 * detector lo ve, y un mundo sano comprueba que no inventa defectos. Sin esto, un detector roto mediría cero y nadie se enteraría.
 * Previene: un informe que dice «0 huérfanos» porque el lector dejó de leer. Fuente del diseño: `diseno-del-grafo-del-sistema-2026-11-21.md` §4 y §9.
 */

const brief = (
  id: string,
  partes: Partial<EntradaDelGrafo["briefs"][number]> = {},
): EntradaDelGrafo["briefs"][number] => ({
  id,
  pack: "p",
  archivo: `briefs/p/${id}.md`,
  titulo: id,
  acciones: [],
  rutas: [],
  maquetas: [],
  funciones: [],
  tablas: [],
  ...partes,
});

/** Un mundo con un defecto de cada tipo, armado a mano; abajo cada prueba dice cuál es el suyo. */
const MUNDO: EntradaDelGrafo = {
  modulos: [
    {
      clave: "caja",
      estado: "disponible",
      acciones: ["caja.ver", "caja.abrir", "caja.huerfana"],
      implementadoPor: ["modulos/caja"],
    },
    {
      clave: "stock",
      estado: "en_desarrollo",
      acciones: ["stock.ver"],
      implementadoPor: ["modulos/stock"],
    },
    { clave: "vacio", estado: "disponible", acciones: [], implementadoPor: [] },
  ],
  casos: [
    {
      nombre: "listar",
      carpeta: "caja",
      clase: "consulta",
      accion: "caja.ver",
      tambien: [],
      sinGuard: null,
    },
    {
      nombre: "abrir",
      carpeta: "caja",
      clase: "caso",
      accion: "caja.abrir",
      tambien: [],
      sinGuard: null,
    },
    {
      nombre: "cerrar",
      carpeta: "caja",
      clase: "caso",
      accion: "caja.ver",
      tambien: [],
      sinGuard: null,
    },
    {
      nombre: "cerrar",
      carpeta: "stock",
      clase: "caso",
      accion: "stock.ver",
      tambien: [],
      sinGuard: null,
    },
    {
      nombre: "listarExistencias",
      carpeta: "stock",
      clase: "consulta",
      accion: "stock.ver",
      tambien: [],
      sinGuard: null,
    },
    {
      nombre: "interno",
      carpeta: "caja",
      clase: "caso",
      accion: null,
      tambien: [],
      sinGuard: "lo llama el sistema",
    },
    {
      nombre: "suelto",
      carpeta: "suelto",
      clase: "caso",
      accion: null,
      tambien: [],
      sinGuard: "no tiene dueño",
    },
  ],
  rutas: [
    {
      id: "web:/caja",
      app: "web",
      ruta: "/caja",
      archivo: "apps/web/app/s/app/(operacion)/caja/page.tsx",
    },
    {
      id: "web:/stock/lista",
      app: "web",
      ruta: "/stock/lista",
      archivo: "apps/web/app/s/app/(operacion)/stock/lista/page.tsx",
    },
    {
      id: "plataforma:/planes",
      app: "plataforma",
      ruta: "/planes",
      archivo: "apps/plataforma/app/planes/page.tsx",
    },
  ],
  nombresAlcanzadosPorRuta: new Map([
    ["web:/caja", new Set(["listar", "abrir", "cerrar"])],
    ["web:/stock/lista", new Set(["cerrar"])],
  ]),
  fichas: [
    {
      id: "caja",
      archivo: "src/capacidades/pantallas/ficha-de-caja.ts",
      rutas: ["/caja"],
      acceso: "caja.ver",
      acciones: ["caja.ver", "caja.huerfana"],
      maquetasCitadas: ["caja.html"],
    },
    {
      id: "fantasma",
      archivo: "src/capacidades/pantallas/ficha-de-fantasma.ts",
      rutas: ["/no-existe"],
      acceso: null,
      acciones: [],
      maquetasCitadas: [],
    },
  ],
  accionesExigidasDentroDeUnCaso: new Set(["caja.huerfana"]),
  migraciones: [
    {
      id: "0001",
      tablasCreadas: ["t_viva", "t_sin_escritor", "t_sin_lector", "t_semilla", "t_retirada"],
    },
    { id: "0002", tablasCreadas: ["t_sin_uso"] },
  ],
  tablas: [
    {
      nombre: "t_viva",
      migracion: "0001",
      retiradaEn: null,
      escritores: ["modulos/caja"],
      lectores: ["modulos/caja"],
      escritaEnMigracion: false,
    },
    {
      nombre: "t_sin_escritor",
      migracion: "0001",
      retiradaEn: null,
      escritores: [],
      lectores: ["modulos/caja"],
      escritaEnMigracion: false,
    },
    {
      nombre: "t_sin_lector",
      migracion: "0001",
      retiradaEn: null,
      escritores: ["modulos/caja"],
      lectores: [],
      escritaEnMigracion: false,
    },
    {
      nombre: "t_semilla",
      migracion: "0001",
      retiradaEn: null,
      escritores: [],
      lectores: ["modulos/caja"],
      escritaEnMigracion: true,
    },
    {
      nombre: "t_retirada",
      migracion: "0001",
      retiradaEn: "0002",
      escritores: [],
      lectores: [],
      escritaEnMigracion: false,
    },
    {
      nombre: "t_sin_uso",
      migracion: "0002",
      retiradaEn: null,
      escritores: [],
      lectores: [],
      escritaEnMigracion: false,
    },
  ],
  maquetas: [
    {
      id: "prototipos-gastronomia/caja.html",
      nombre: "caja.html",
      carpeta: "prototipos-gastronomia",
    },
    {
      id: "prototipos-gastronomia/lista.html",
      nombre: "lista.html",
      carpeta: "prototipos-gastronomia",
    },
    {
      id: "prototipos-gastronomia/huerfana.html",
      nombre: "huerfana.html",
      carpeta: "prototipos-gastronomia",
    },
  ],
  briefs: [
    brief("con-codigo", {
      acciones: ["caja.ver"],
      rutas: ["/caja"],
      tablas: ["t_viva"],
      maquetas: ["caja.html"],
    }),
    brief("parcial", { acciones: ["caja.ver"], rutas: ["/compras"] }),
    brief("sin-codigo", { acciones: ["caja.nueva"], rutas: ["/compras/lista"] }),
    brief("sin-enlace"),
    brief("solo-un-archivo", { acciones: ["menu.ts"] }),
    brief("por-funcion", { funciones: ["abrir"] }),
  ],
};

const informe = analizarGrafo(construirGrafo(MUNDO), MUNDO);
const ids = (c: (typeof CATEGORIAS)[number]): readonly string[] => informe.categorias[c].ids;

describe("el grafo: cada categoría ve su violación inyectada", () => {
  it("acción sin caso de uso (y la que solo se exige por dentro de un caso)", () => {
    expect(ids("accion_sin_caso_de_uso")).toEqual(["accion:caja.huerfana"]);
    expect(ids("accion_sin_caso_de_uso_ni_exigida_en_el_codigo")).toEqual([]);
    const sinExigencia = analizarGrafo(
      construirGrafo({ ...MUNDO, accionesExigidasDentroDeUnCaso: new Set() }),
      {
        ...MUNDO,
        accionesExigidasDentroDeUnCaso: new Set(),
      },
    );
    expect(sinExigencia.categorias.accion_sin_caso_de_uso_ni_exigida_en_el_codigo.ids).toEqual([
      "accion:caja.huerfana",
    ]);
  });

  it("caso de uso sin módulo, sin guard y con el nombre repetido en dos carpetas", () => {
    expect(ids("caso_sin_modulo")).toEqual(["caso_de_uso:suelto.suelto"]);
    expect(ids("caso_sin_guard")).toEqual([
      "caso_de_uso:caja.interno",
      "caso_de_uso:suelto.suelto",
    ]);
    expect(ids("nombre_de_caso_repetido")).toEqual([
      "caso_de_uso:caja.cerrar",
      "caso_de_uso:stock.cerrar",
    ]);
  });

  it("acción con y sin pantalla: un nombre repetido entre módulos no cuenta como pantalla, solo se anota", () => {
    expect(ids("accion_con_pantalla")).toEqual(["accion:caja.abrir", "accion:caja.ver"]);
    expect(ids("accion_sin_pantalla")).toEqual(["accion:caja.huerfana", "accion:stock.ver"]);
    expect(ids("accion_sin_pantalla_solo_por_nombre_repetido")).toEqual(["accion:stock.ver"]);
    expect(ids("accion_sin_pantalla_solo_en_una_ficha")).toEqual(["accion:caja.huerfana"]);
    // `cerrar` está en dos carpetas: ninguna de las dos se atribuye a una pantalla por nombre.
    expect(ids("caso_sin_pantalla")).toEqual([
      "caso_de_uso:caja.cerrar",
      "caso_de_uso:caja.interno",
      "caso_de_uso:stock.cerrar",
      "caso_de_uso:stock.listarExistencias",
      "caso_de_uso:suelto.suelto",
    ]);
  });

  it("fichas: acción sin ficha, pantalla sin ficha y ficha con una ruta que no existe", () => {
    expect(ids("accion_sin_ficha")).toEqual(["accion:caja.abrir", "accion:stock.ver"]);
    expect(ids("pantalla_sin_ficha")).toEqual([
      "pantalla:plataforma:/planes",
      "pantalla:web:/stock/lista",
    ]);
    expect(ids("ficha_sin_pantalla")).toEqual(["ficha:fantasma"]);
  });

  it("maquetas: la que cita una ficha dibuja su ruta; la que solo coincide por nombre se marca por nombre; la huérfana no dibuja nada", () => {
    const grafo = construirGrafo(MUNDO);
    const dibuja = grafo.aristas.filter((a) => a.tipo === "dibuja");
    expect(dibuja).toEqual([
      {
        de: "maqueta:prototipos-gastronomia/caja.html",
        hacia: "pantalla:web:/caja",
        tipo: "dibuja",
        via: "declarada",
      },
      {
        de: "maqueta:prototipos-gastronomia/lista.html",
        hacia: "pantalla:web:/stock/lista",
        tipo: "dibuja",
        via: "nombre",
      },
    ]);
    expect(ids("maqueta_sin_pantalla")).toEqual(["maqueta:prototipos-gastronomia/huerfana.html"]);
    expect(ids("pantalla_sin_maqueta")).toEqual(["pantalla:plataforma:/planes"]);
  });

  it("módulos: no activo (sin vencimiento declarado) y sin caso de uso", () => {
    expect(ids("modulo_no_activo")).toEqual(["modulo:stock"]);
    expect(ids("modulo_sin_caso_de_uso")).toEqual(["modulo:vacio"]);
  });

  it("tablas y migraciones: sin escritor, sin lector, retirada y migración cuyas tablas nadie escribe", () => {
    expect(ids("tabla_sin_escritor_en_el_codigo")).toEqual([
      "tabla:t_semilla",
      "tabla:t_sin_escritor",
      "tabla:t_sin_uso",
    ]);
    expect(ids("tabla_sin_lector_en_el_codigo")).toEqual(["tabla:t_sin_lector", "tabla:t_sin_uso"]);
    expect(ids("tabla_retirada")).toEqual(["tabla:t_retirada"]);
    expect(ids("migracion_sin_tabla_escrita")).toEqual(["migracion:0002"]);
  });

  it("briefs contra el código: con código, parcial, sin código y sin enlace (un nombre de archivo no cuenta como acción)", () => {
    const estado = Object.fromEntries(informe.briefsContraElCodigo.map((b) => [b.id, b.estado]));
    expect(estado).toEqual({
      "con-codigo": "CON_CODIGO",
      parcial: "PARCIAL",
      "sin-codigo": "SIN_CODIGO",
      "sin-enlace": "SIN_ENLACE",
      "solo-un-archivo": "SIN_ENLACE",
      "por-funcion": "CON_CODIGO",
    });
    const sinCodigo = informe.briefsContraElCodigo.find((b) => b.id === "sin-codigo");
    expect(sinCodigo?.faltantes).toEqual(["accion:caja.nueva", "ruta:/compras/lista"]);
    expect(ids("brief_con_codigo")).toEqual(["brief:con-codigo", "brief:por-funcion"]);
    expect(ids("brief_parcial")).toEqual(["brief:parcial"]);
    expect(ids("brief_sin_codigo")).toEqual(["brief:sin-codigo"]);
    expect(ids("brief_sin_enlace")).toEqual(["brief:sin-enlace", "brief:solo-un-archivo"]);
    expect(informe.briefsPorPack["p"]).toEqual({
      CON_CODIGO: 2,
      PARCIAL: 1,
      SIN_CODIGO: 1,
      SIN_ENLACE: 2,
    });
  });

  it("código sin brief: casos, tablas y pantallas que ningún brief nombra", () => {
    // Un brief que cita la acción `caja.ver` respalda a los casos que esa acción protege; el nombre de función respalda solo a ese caso.
    expect(ids("caso_sin_brief_por_nombre")).toEqual([
      "caso_de_uso:caja.cerrar",
      "caso_de_uso:caja.interno",
      "caso_de_uso:caja.listar",
      "caso_de_uso:stock.cerrar",
      "caso_de_uso:stock.listarExistencias",
      "caso_de_uso:suelto.suelto",
    ]);
    expect(ids("caso_sin_brief")).toEqual([
      "caso_de_uso:caja.interno",
      "caso_de_uso:stock.cerrar",
      "caso_de_uso:stock.listarExistencias",
      "caso_de_uso:suelto.suelto",
    ]);
    expect(ids("tabla_sin_brief")).toEqual([
      "tabla:t_semilla",
      "tabla:t_sin_escritor",
      "tabla:t_sin_lector",
      "tabla:t_sin_uso",
    ]);
    expect(ids("pantalla_sin_brief")).toEqual([
      "pantalla:plataforma:/planes",
      "pantalla:web:/stock/lista",
    ]);
    expect(ids("pantalla_sin_brief_ni_maqueta")).toEqual(["pantalla:plataforma:/planes"]);
  });

  it("toda categoría declarada existe en el informe (no se pierde una al agregar otra)", () => {
    expect(Object.keys(informe.categorias).sort()).toEqual([...CATEGORIAS].sort());
  });
});

describe("el grafo: un mundo sano no inventa defectos", () => {
  const SANO: EntradaDelGrafo = {
    modulos: [
      {
        clave: "caja",
        estado: "disponible",
        acciones: ["caja.ver"],
        implementadoPor: ["modulos/caja"],
      },
    ],
    casos: [
      {
        nombre: "listar",
        carpeta: "caja",
        clase: "consulta",
        accion: "caja.ver",
        tambien: [],
        sinGuard: null,
      },
    ],
    rutas: [
      {
        id: "web:/caja",
        app: "web",
        ruta: "/caja",
        archivo: "apps/web/app/s/app/(operacion)/caja/page.tsx",
      },
    ],
    nombresAlcanzadosPorRuta: new Map([["web:/caja", new Set(["listar"])]]),
    fichas: [
      {
        id: "caja",
        archivo: "f.ts",
        rutas: ["/caja"],
        acceso: "caja.ver",
        acciones: ["caja.ver"],
        maquetasCitadas: ["caja.html"],
      },
    ],
    accionesExigidasDentroDeUnCaso: new Set(),
    migraciones: [{ id: "0001", tablasCreadas: ["caja"] }],
    tablas: [
      {
        nombre: "caja",
        migracion: "0001",
        retiradaEn: null,
        escritores: ["modulos/caja"],
        lectores: ["modulos/caja"],
        escritaEnMigracion: false,
      },
    ],
    maquetas: [{ id: "g/caja.html", nombre: "caja.html", carpeta: "g" }],
    briefs: [
      brief("b", {
        acciones: ["caja.ver"],
        rutas: ["/caja"],
        funciones: ["listar"],
        tablas: ["caja"],
        maquetas: ["caja.html"],
      }),
    ],
  };
  const sano = analizarGrafo(construirGrafo(SANO), SANO);

  it("ninguna categoría de defecto cuenta algo", () => {
    const defectos = CATEGORIAS.filter(
      (c) =>
        !["accion_con_pantalla", "brief_con_codigo"].includes(c) && sano.categorias[c].cuenta > 0,
    );
    expect(defectos).toEqual([]);
    expect(sano.categorias.accion_con_pantalla.ids).toEqual(["accion:caja.ver"]);
    expect(sano.categorias.brief_con_codigo.ids).toEqual(["brief:b"]);
  });

  it("es determinista: el mismo mundo con las listas al revés da el mismo grafo y el mismo informe", () => {
    const alReves: EntradaDelGrafo = {
      ...MUNDO,
      modulos: [...MUNDO.modulos].reverse(),
      casos: [...MUNDO.casos].reverse(),
      rutas: [...MUNDO.rutas].reverse(),
      fichas: [...MUNDO.fichas].reverse(),
      tablas: [...MUNDO.tablas].reverse(),
      maquetas: [...MUNDO.maquetas].reverse(),
      briefs: [...MUNDO.briefs].reverse(),
    };
    expect(JSON.stringify(construirGrafo(alReves))).toBe(JSON.stringify(construirGrafo(MUNDO)));
    expect(JSON.stringify(analizarGrafo(construirGrafo(alReves), alReves))).toBe(
      JSON.stringify(informe),
    );
  });
});

describe("los lectores", () => {
  it("normalizarRuta trata [id], :id y {id} como el mismo parámetro", () => {
    expect(normalizarRuta("/caja/[id]")).toBe("/caja/*");
    expect(normalizarRuta("/caja/:id/")).toBe("/caja/*");
    expect(normalizarRuta("/caja/{id}?x=1")).toBe("/caja/*");
    expect(normalizarRuta("/")).toBe("/");
  });

  it("rutaDePagina saca la ruta del archivo: sin grupos, sin el prefijo de la operación, con el parámetro", () => {
    expect(rutaDePagina("apps/web/app/s/app/(operacion)/caja/cajas/[id]/page.tsx")?.id).toBe(
      "web:/caja/cajas/[id]",
    );
    expect(rutaDePagina("apps/web/app/s/app/(entrada)/ingreso/page.tsx")?.id).toBe("web:/ingreso");
    expect(rutaDePagina("apps/web/app/s/carta/[codigo]/page.tsx")?.id).toBe(
      "web:/s/carta/[codigo]",
    );
    expect(rutaDePagina("apps/plataforma/app/planes/[id]/page.tsx")?.id).toBe(
      "plataforma:/planes/[id]",
    );
    expect(rutaDePagina("apps/plataforma/app/page.tsx")?.id).toBe("plataforma:/");
    expect(rutaDePagina("apps/web/app/layout.tsx")).toBeNull();
    expect(rutaDePagina("apps/web/servidor/cajas.ts")).toBeNull();
  });

  it("el alcance es por símbolo: la página llega a lo que importa, no a todo el archivo, y no entra en los módulos", () => {
    const pagina = "apps/web/app/s/app/(operacion)/caja/page.tsx";
    const fuentes = new Map<string, string>([
      [
        pagina,
        `import { cargar } from "../../../../../servidor/indice";\nimport * as todo from "../../../../../servidor/todo";\nimport { enModulo } from "../../../../../../src/modulos/caja/publico";\nexport default function Pagina() { cargar(); enModulo(); todo.unaDeTodo(); }`,
      ],
      ["apps/web/servidor/indice.ts", `export { cargar } from "./x";`],
      [
        "apps/web/servidor/x.ts",
        `import { local } from "./y";\nexport function cargar() { return d.casosDeUso().listarX(local); }\nexport function otra() { return d.casosDeUso().nuncaUsada(); }`,
      ],
      [
        "apps/web/servidor/y.ts",
        `export const local = () => llamaA();\nexport const otraLocal = () => nuncaLlamada();`,
      ],
      ["apps/web/servidor/todo.ts", `export function unaDeTodo() { return deNamespace(); }`],
      ["src/modulos/caja/publico.ts", `export function enModulo() { return dentroDelModulo(); }`],
    ]);
    const rutas = [{ id: "web:/caja", app: "web" as const, ruta: "/caja", archivo: pagina }];
    const nombres =
      nombresAlcanzadosPorPagina(fuentes, rutas).get("web:/caja") ?? new Set<string>();
    expect(nombres.has("listarX")).toBe(true);
    expect(nombres.has("llamaA")).toBe(true);
    expect(nombres.has("deNamespace")).toBe(true);
    expect(nombres.has("enModulo")).toBe(true);
    expect(nombres.has("nuncaUsada")).toBe(false);
    expect(nombres.has("nuncaLlamada")).toBe(false);
    expect(nombres.has("dentroDelModulo")).toBe(false);
  });

  it("sinComentarios quita comentarios de SQL y de código pero no una dirección https", () => {
    const limpio = sinComentarios("a -- sql\nb // js\nc /* x */ d\nhttps://ej.com e");
    expect(limpio).not.toContain("sql");
    expect(limpio).not.toContain("js");
    expect(limpio).not.toContain("x");
    expect(limpio).toContain("https://ej.com");
  });

  it("el uso de tablas separa escritores y lectores, mira el SQL a mano y no cuenta lo comentado ni lo que no es tabla", () => {
    const lectura: LecturaDeMigraciones = {
      migraciones: [],
      tablas: new Map([
        ["caja", { migracion: "0001", retiradaEn: null }],
        ["arqueo", { migracion: "0001", retiradaEn: null }],
        ["comentada", { migracion: "0001", retiradaEn: null }],
        ["semilla", { migracion: "0001", retiradaEn: null }],
        ["semillita", { migracion: "0001", retiradaEn: null }],
      ]),
      texto: new Map([["0001", "INSERT INTO semilla (a) VALUES (1);"]]),
    };
    const fuentes = new Map<string, string>([
      [
        "src/modulos/caja/persistencia/r.ts",
        `db.insertInto("caja").values(x); db.selectFrom("arqueo as a").selectAll(); db.updateTable("semillita as s"); // db.insertInto("comentada")`,
      ],
      ["src/plataforma/p.ts", "sql`update arqueo set a = 1 where id = ${x}`"],
    ]);
    const uso = new Map(usoDeTablas(fuentes, lectura).map((t) => [t.nombre, t]));
    expect(uso.get("caja")?.escritores).toEqual(["modulos/caja"]);
    expect(uso.get("caja")?.lectores).toEqual([]);
    expect(uso.get("arqueo")?.escritores).toEqual(["plataforma"]);
    expect(uso.get("arqueo")?.lectores).toEqual(["modulos/caja"]);
    expect(uso.get("comentada")?.escritores).toEqual([]);
    expect(uso.get("semilla")?.escritores).toEqual([]);
    expect(uso.get("semilla")?.escritaEnMigracion).toBe(true);
    // Kysely admite un alias dentro del texto (`"tabla as t"`): sin verlo, una tabla leída o escrita con alias figuraría sin uso.
    expect(uso.get("semillita")?.escritores).toEqual(["modulos/caja"]);
  });

  it("las acciones que un caso exige por dentro se leen del código del caso, no de las declaraciones ni de los comentarios", () => {
    const fuentes = new Map<string, string>([
      [
        "src/modulos/catalogo/casos-de-uso/guardar.ts",
        `exigirAcciones(["vidrieras.crear"]); // "vidrieras.retirar"`,
      ],
      ["src/modulos/catalogo/casos-de-uso/declaraciones.ts", `{ accion: "vidrieras.publicar" }`],
      ["src/modulos/catalogo/dominio/x.ts", `"vidrieras.ocultar"`],
    ]);
    const halladas = accionesExigidasDentroDeUnCaso(fuentes, [
      "vidrieras.crear",
      "vidrieras.retirar",
      "vidrieras.publicar",
      "vidrieras.ocultar",
    ]);
    expect([...halladas]).toEqual(["vidrieras.crear"]);
  });

  it("las declaraciones se leen con su acción, las acciones de otros módulos y el motivo de no pasar por el guard", () => {
    const casos = casosDeDeclaraciones("salon", "caso", {
      a: { accion: "cuentas.abrir", tambien: ["mesas.ver"] },
      b: { sinGuard: "lo llama el sistema" },
    });
    expect(casos).toEqual([
      {
        nombre: "a",
        carpeta: "salon",
        clase: "caso",
        accion: "cuentas.abrir",
        tambien: ["mesas.ver"],
        sinGuard: null,
      },
      {
        nombre: "b",
        carpeta: "salon",
        clase: "caso",
        accion: null,
        tambien: [],
        sinGuard: "lo llama el sistema",
      },
    ]);
  });

  it("las maquetas que cita un texto se leen por su nombre", () => {
    expect(maquetasCitadas("ver `caja.html`, medios.html y otra.png; caja.html de nuevo")).toEqual([
      "caja.html",
      "medios.html",
    ]);
  });
});
