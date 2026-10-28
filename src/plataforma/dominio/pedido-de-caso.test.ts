import { describe, expect, it } from "vitest";
import { LARGO_MAXIMO_DEL_MOTIVO } from "./formas-de-entrada";
import {
  CASOS_DE_PLATAFORMA,
  OPCION_DEL_EMAIL_DEL_ADMIN,
  armarEntradaDelCaso,
  esCasoDeLaLista,
  leerJson,
  leerLineaDeComandos,
  type NombreDeCaso,
  type ProblemaDeForma,
} from "./pedido-de-caso";

const CLAVE = "clave-0123456789abcdef";
const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";
const CUIT = "20-12345678-6";

/** Un archivo válido por caso (lo mínimo y, en los que lo tienen, también lo opcional). */
const VALIDOS: Record<NombreDeCaso, { json: unknown; entrada: unknown }> = {
  crearMarca: {
    json: { claveDeIdempotencia: CLAVE, codigo: "zulu", marcaPadreId: null },
    entrada: { claveDeIdempotencia: CLAVE, codigo: "zulu", marcaPadreId: null },
  },
  guardarBorradorDeMarca: {
    json: {
      claveDeIdempotencia: CLAVE,
      marcaId: ID_A,
      versionEsperada: 3,
      nombreVisible: "Zulu",
      tema: { primary: "#112233" },
      aspecto: { estilo: "plano" },
      logo: null,
      vocabulario: { cliente: "socio" },
      modulosIniciales: ["administracion"],
      planPorDefectoId: ID_B,
    },
    entrada: {
      claveDeIdempotencia: CLAVE,
      marcaId: ID_A,
      versionEsperada: 3,
      nombreVisible: "Zulu",
      tema: { primary: "#112233" },
      aspecto: { estilo: "plano" },
      logo: null,
      vocabulario: { cliente: "socio" },
      modulosIniciales: ["administracion"],
      planPorDefectoId: ID_B,
    },
  },
  confirmarVersionDeMarca: {
    json: {
      claveDeIdempotencia: CLAVE,
      marcaId: ID_A,
      versionEsperada: 3,
      vigenteDesde: "2026-10-20T12:30:00Z",
      motivo: "Primera versión",
      reemplazaProgramada: false,
    },
    entrada: {
      claveDeIdempotencia: CLAVE,
      marcaId: ID_A,
      versionEsperada: 3,
      vigenteDesde: new Date("2026-10-20T12:30:00Z"),
      motivo: "Primera versión",
      reemplazaProgramada: false,
    },
  },
  agregarDominio: {
    json: {
      claveDeIdempotencia: CLAVE,
      host: "app.ejemplo.test",
      superficie: "APP",
      titular: "OPERADOR",
      esCanonico: true,
      duenio: { tipo: "MARCA", marcaId: ID_A },
    },
    entrada: {
      claveDeIdempotencia: CLAVE,
      host: "app.ejemplo.test",
      superficie: "APP",
      titular: "OPERADOR",
      esCanonico: true,
      duenio: { tipo: "MARCA", marcaId: ID_A },
    },
  },
  crearPlan: {
    json: { claveDeIdempotencia: CLAVE, codigo: "base" },
    entrada: { claveDeIdempotencia: CLAVE, codigo: "base" },
  },
  guardarBorradorDePlan: {
    json: {
      claveDeIdempotencia: CLAVE,
      planId: ID_A,
      versionEsperada: null,
      nombreComercial: "Base",
      modulos: ["administracion"],
      perillas: { empresas_por_tenant: { tipo: "LIMITE", limite: 3 } },
    },
    entrada: {
      claveDeIdempotencia: CLAVE,
      planId: ID_A,
      versionEsperada: null,
      nombreComercial: "Base",
      modulos: ["administracion"],
      perillas: { empresas_por_tenant: { tipo: "LIMITE", limite: 3 } },
    },
  },
  publicarVersionDePlan: {
    json: { claveDeIdempotencia: CLAVE, planId: ID_A, motivo: "Versión inicial" },
    entrada: { claveDeIdempotencia: CLAVE, planId: ID_A, motivo: "Versión inicial" },
  },
  asignarPlan: {
    json: {
      claveDeIdempotencia: CLAVE,
      tenantId: ID_A,
      versionDePlanId: ID_B,
      vigenteDesde: "2026-10-20T09:30:15.250-03:00",
      motivo: "Alta comercial",
      numeroEsperado: 2,
      reemplazaProgramada: true,
    },
    entrada: {
      claveDeIdempotencia: CLAVE,
      tenantId: ID_A,
      versionDePlanId: ID_B,
      vigenteDesde: new Date("2026-10-20T12:30:15.250Z"),
      motivo: "Alta comercial",
      numeroEsperado: 2,
      reemplazaProgramada: true,
    },
  },
  altaDeEmpresa: {
    json: {
      claveDeIdempotencia: CLAVE,
      nombreDeTenant: "Grupo de prueba",
      marcaId: ID_A,
      cuit: CUIT,
      razonSocial: "Razón de prueba SA",
      zonaHoraria: "America/Argentina/Buenos_Aires",
      moneda: "ARS",
      emailGerente: "gerente@ejemplo.test",
    },
    entrada: {
      claveDeIdempotencia: CLAVE,
      nombreDeTenant: "Grupo de prueba",
      marcaId: ID_A,
      cuit: CUIT,
      razonSocial: "Razón de prueba SA",
      zonaHoraria: "America/Argentina/Buenos_Aires",
      moneda: "ARS",
      emailGerente: "gerente@ejemplo.test",
    },
  },
  activarModuloDeEmpresa: {
    json: { claveDeIdempotencia: CLAVE, empresaId: ID_A, modulo: "facturacion" },
    entrada: { claveDeIdempotencia: CLAVE, empresaId: ID_A, modulo: "facturacion" },
  },
  desactivarModuloDeEmpresa: {
    json: { claveDeIdempotencia: CLAVE, empresaId: ID_B, modulo: "facturacion" },
    entrada: { claveDeIdempotencia: CLAVE, empresaId: ID_B, modulo: "facturacion" },
  },
};

const problemasDe = (caso: NombreDeCaso, json: unknown): readonly ProblemaDeForma[] => {
  const r = armarEntradaDelCaso(caso, json);
  if (r.ok) throw new Error("tenía que rechazarse");
  return r.error;
};

/** El mismo archivo válido con un campo cambiado (o quitado con `undefined`). */
const con = (caso: NombreDeCaso, cambios: Record<string, unknown>): Record<string, unknown> => {
  const base = { ...(VALIDOS[caso].json as Record<string, unknown>) };
  for (const [campo, valor] of Object.entries(cambios)) {
    if (valor === undefined) delete base[campo];
    else base[campo] = valor;
  }
  return base;
};

describe("la lista cerrada de casos", () => {
  it("son exactamente estos, en este orden", () => {
    expect(CASOS_DE_PLATAFORMA).toEqual([
      "crearMarca",
      "guardarBorradorDeMarca",
      "confirmarVersionDeMarca",
      "agregarDominio",
      "crearPlan",
      "guardarBorradorDePlan",
      "publicarVersionDePlan",
      "asignarPlan",
      "altaDeEmpresa",
      "activarModuloDeEmpresa",
      "desactivarModuloDeEmpresa",
    ]);
  });

  it.each(CASOS_DE_PLATAFORMA)("%s está en la lista", (caso) => {
    expect(esCasoDeLaLista(caso)).toBe(true);
  });

  it.each([
    "suspenderTenant",
    "cancelarAlta",
    "ajustarPerilla",
    "CREARMARCA",
    "crearMarca ",
    "",
    "constructor",
    "toString",
    "__proto__",
    "hasOwnProperty",
  ])("«%s» no es un caso de la lista", (nombre) => {
    expect(esCasoDeLaLista(nombre)).toBe(false);
  });
});

describe("la forma del archivo de cada caso", () => {
  it.each(CASOS_DE_PLATAFORMA)(
    "%s: un archivo válido da la entrada con los tipos del caso",
    (caso) => {
      expect(armarEntradaDelCaso(caso, VALIDOS[caso].json)).toEqual({
        ok: true,
        valor: VALIDOS[caso].entrada,
      });
    },
  );

  it("la fecha se entrega como Date (el caso la exige así) y respeta la zona del archivo", () => {
    const r = armarEntradaDelCaso("confirmarVersionDeMarca", VALIDOS.confirmarVersionDeMarca.json);
    expect(r.ok && r.valor.vigenteDesde).toBeInstanceOf(Date);
    const otra = armarEntradaDelCaso(
      "confirmarVersionDeMarca",
      con("confirmarVersionDeMarca", { vigenteDesde: "2026-10-20T09:30-03:00" }),
    );
    expect(otra.ok && otra.valor.vigenteDesde.toISOString()).toBe("2026-10-20T12:30:00.000Z");
  });

  it.each(CASOS_DE_PLATAFORMA)(
    "%s: una entrada vacía dice qué campos faltan, en el orden del caso",
    (caso) => {
      const problemas = problemasDe(caso, {});
      const requeridos = Object.keys(VALIDOS[caso].entrada as object);
      expect(problemas.every((p) => p.motivo === "FALTA" && p.esperado !== null)).toBe(true);
      // Todos los requeridos faltan; los opcionales no.
      const faltan = problemas.map((p) => p.campo);
      for (const campo of faltan) expect(requeridos).toContain(campo);
      expect(faltan.length).toBeGreaterThan(0);
    },
  );

  it("los campos que faltan, con el tipo que esperan, en el orden en que el caso los declara", () => {
    expect(problemasDe("asignarPlan", {})).toEqual([
      { campo: "claveDeIdempotencia", motivo: "FALTA", esperado: "clave" },
      { campo: "tenantId", motivo: "FALTA", esperado: "id" },
      { campo: "versionDePlanId", motivo: "FALTA", esperado: "id" },
      { campo: "vigenteDesde", motivo: "FALTA", esperado: "vigencia" },
      { campo: "motivo", motivo: "FALTA", esperado: "motivo" },
      { campo: "numeroEsperado", motivo: "FALTA", esperado: "numeroONulo" },
      { campo: "reemplazaProgramada", motivo: "FALTA", esperado: "booleano" },
    ]);
  });

  it("los campos opcionales pueden faltar; los obligatorios no, aunque valgan null", () => {
    const sinOpcionales = con("guardarBorradorDeMarca", {
      nombreVisible: undefined,
      tema: undefined,
      aspecto: undefined,
      logo: undefined,
      vocabulario: undefined,
      modulosIniciales: undefined,
      planPorDefectoId: undefined,
    });
    expect(armarEntradaDelCaso("guardarBorradorDeMarca", sinOpcionales)).toEqual({
      ok: true,
      valor: { claveDeIdempotencia: CLAVE, marcaId: ID_A, versionEsperada: 3 },
    });
    // Un opcional que se manda como null no desaparece: null significa «borrar» en el caso.
    const conNulos = armarEntradaDelCaso(
      "guardarBorradorDeMarca",
      con("guardarBorradorDeMarca", {
        nombreVisible: null,
        modulosIniciales: null,
        planPorDefectoId: null,
      }),
    );
    expect(conNulos.ok && conNulos.valor).toMatchObject({
      nombreVisible: null,
      modulosIniciales: null,
      planPorDefectoId: null,
    });
    expect(problemasDe("crearMarca", { claveDeIdempotencia: CLAVE, codigo: "zulu" })).toEqual([
      { campo: "marcaPadreId", motivo: "FALTA", esperado: "idONulo" },
    ]);
  });

  it("un campo que el caso no tiene se rechaza con su nombre (un error de tipeo no se pierde)", () => {
    expect(
      problemasDe("crearPlan", { ...(VALIDOS.crearPlan.json as object), codgio: "x", otro: 1 }),
    ).toEqual([
      { campo: "codgio", motivo: "NO_SE_ESPERABA", esperado: null },
      { campo: "otro", motivo: "NO_SE_ESPERABA", esperado: null },
    ]);
    // El nombre de un campo de otro caso tampoco vale.
    expect(
      problemasDe("crearPlan", { ...(VALIDOS.crearPlan.json as object), planId: ID_A }),
    ).toEqual([{ campo: "planId", motivo: "NO_SE_ESPERABA", esperado: null }]);
  });

  it("los nombres heredados del prototipo no cuentan como campos del archivo", () => {
    expect(problemasDe("crearPlan", {})).toEqual([
      { campo: "claveDeIdempotencia", motivo: "FALTA", esperado: "clave" },
      { campo: "codigo", motivo: "FALTA", esperado: "texto" },
    ]);
    const conProto = JSON.parse(
      `{"claveDeIdempotencia":"${CLAVE}","codigo":"base","__proto__":{"x":1}}`,
    ) as unknown;
    expect(problemasDe("crearPlan", conProto)).toEqual([
      { campo: "__proto__", motivo: "NO_SE_ESPERABA", esperado: null },
    ]);
  });

  it("junta todos los problemas: primero los campos del caso en su orden, después los que sobran", () => {
    expect(
      problemasDe("publicarVersionDePlan", { sobra: true, motivo: 5, planId: "no", z: 1 }),
    ).toEqual([
      { campo: "claveDeIdempotencia", motivo: "FALTA", esperado: "clave" },
      { campo: "planId", motivo: "ID_INVALIDO", esperado: null },
      { campo: "motivo", motivo: "FORMA_INVALIDA", esperado: "motivo" },
      { campo: "sobra", motivo: "NO_SE_ESPERABA", esperado: null },
      { campo: "z", motivo: "NO_SE_ESPERABA", esperado: null },
    ]);
  });

  it.each([
    ["null", null],
    ["una lista", []],
    ["un texto", "crearPlan"],
    ["un número", 3],
    ["verdadero", true],
  ])("un archivo que es %s no es un objeto", (_cual, json) => {
    expect(problemasDe("crearPlan", json)).toEqual([
      { campo: null, motivo: "NO_ES_UN_OBJETO", esperado: null },
    ]);
  });

  describe("clave de idempotencia", () => {
    it.each([
      ["corta", "a".repeat(15)],
      ["con espacio", "clave con espacio 123"],
      ["con acento", "clavé-0123456789abcdef"],
      ["vacía", ""],
      ["muy larga", "a".repeat(129)],
    ])("%s: CLAVE_DE_IDEMPOTENCIA_INVALIDA", (_cual, clave) => {
      expect(problemasDe("crearPlan", con("crearPlan", { claveDeIdempotencia: clave }))).toEqual([
        { campo: "claveDeIdempotencia", motivo: "CLAVE_DE_IDEMPOTENCIA_INVALIDA", esperado: null },
      ]);
    });

    it("los límites 16 y 128 valen", () => {
      for (const largo of [16, 128]) {
        const r = armarEntradaDelCaso(
          "crearPlan",
          con("crearPlan", { claveDeIdempotencia: "a".repeat(largo) }),
        );
        expect(r.ok).toBe(true);
      }
    });

    it.each([[null], [12], [{}], [["a"]]])("%j no es un texto: FORMA_INVALIDA", (clave) => {
      expect(problemasDe("crearPlan", con("crearPlan", { claveDeIdempotencia: clave }))).toEqual([
        { campo: "claveDeIdempotencia", motivo: "FORMA_INVALIDA", esperado: "clave" },
      ]);
    });
  });

  describe("texto", () => {
    it.each([[null], [1], [true], [{}], [["x"]]])("%j no es un texto", (valor) => {
      expect(problemasDe("crearPlan", con("crearPlan", { codigo: valor }))[0]).toEqual({
        campo: "codigo",
        motivo: "FORMA_INVALIDA",
        esperado: "texto",
      });
    });
  });

  describe("identificadores", () => {
    it("un uuid en mayúsculas se entrega en minúsculas (como lo guarda la base)", () => {
      const r = armarEntradaDelCaso(
        "publicarVersionDePlan",
        con("publicarVersionDePlan", { planId: ID_A.toUpperCase() }),
      );
      expect(r.ok && r.valor.planId).toBe(ID_A);
    });

    it.each([["x"], [""], ["11111111-1111-4111-8111-11111111111"], [`${ID_A} `]])(
      "«%s» no es un uuid: ID_INVALIDO",
      (valor) => {
        expect(
          problemasDe("publicarVersionDePlan", con("publicarVersionDePlan", { planId: valor })),
        ).toEqual([{ campo: "planId", motivo: "ID_INVALIDO", esperado: null }]);
      },
    );

    it.each([[null], [7], [{}]])("%j no es un texto: FORMA_INVALIDA", (valor) => {
      expect(
        problemasDe("publicarVersionDePlan", con("publicarVersionDePlan", { planId: valor })),
      ).toEqual([{ campo: "planId", motivo: "FORMA_INVALIDA", esperado: "id" }]);
    });

    it("idONulo: null vale, un uuid vale, otra cosa no", () => {
      for (const valor of [null, ID_B]) {
        expect(
          armarEntradaDelCaso("crearMarca", con("crearMarca", { marcaPadreId: valor })).ok,
        ).toBe(true);
      }
      expect(problemasDe("crearMarca", con("crearMarca", { marcaPadreId: "x" }))).toEqual([
        { campo: "marcaPadreId", motivo: "ID_INVALIDO", esperado: null },
      ]);
      expect(problemasDe("crearMarca", con("crearMarca", { marcaPadreId: 4 }))).toEqual([
        { campo: "marcaPadreId", motivo: "FORMA_INVALIDA", esperado: "idONulo" },
      ]);
    });
  });

  describe("versión y número esperados", () => {
    it.each([[null], [1], [2_147_483_647]])("versionEsperada %j vale", (valor) => {
      const r = armarEntradaDelCaso(
        "guardarBorradorDePlan",
        con("guardarBorradorDePlan", { versionEsperada: valor }),
      );
      expect(r.ok && r.valor.versionEsperada).toBe(valor);
    });

    it.each([[0], [-1], [1.5], [2_147_483_648], [Number.MAX_SAFE_INTEGER]])(
      "versionEsperada %j: VERSION_ESPERADA_INVALIDA",
      (valor) => {
        expect(
          problemasDe(
            "guardarBorradorDePlan",
            con("guardarBorradorDePlan", { versionEsperada: valor }),
          ),
        ).toEqual([
          { campo: "versionEsperada", motivo: "VERSION_ESPERADA_INVALIDA", esperado: null },
        ]);
      },
    );

    it.each([["3"], [true], [{}], [[3]]])("versionEsperada %j: FORMA_INVALIDA", (valor) => {
      expect(
        problemasDe(
          "guardarBorradorDePlan",
          con("guardarBorradorDePlan", { versionEsperada: valor }),
        ),
      ).toEqual([{ campo: "versionEsperada", motivo: "FORMA_INVALIDA", esperado: "versionONula" }]);
    });

    it.each([[1], [3], [2_147_483_647]])(
      "confirmarVersionDeMarca: versionEsperada %j vale",
      (valor) => {
        const r = armarEntradaDelCaso(
          "confirmarVersionDeMarca",
          con("confirmarVersionDeMarca", { versionEsperada: valor }),
        );
        expect(r.ok && r.valor.versionEsperada).toBe(valor);
      },
    );

    it.each([[0], [-1], [1.5], [2_147_483_648]])(
      "confirmarVersionDeMarca: versionEsperada %j: VERSION_ESPERADA_INVALIDA",
      (valor) => {
        expect(
          problemasDe(
            "confirmarVersionDeMarca",
            con("confirmarVersionDeMarca", { versionEsperada: valor }),
          ),
        ).toEqual([
          { campo: "versionEsperada", motivo: "VERSION_ESPERADA_INVALIDA", esperado: null },
        ]);
      },
    );

    // Confirmar exige un borrador: `null` («no había») no es una versión que se pueda haber visto.
    it.each([[null], ["3"], [true], [{}], [[3]]])(
      "confirmarVersionDeMarca: versionEsperada %j: FORMA_INVALIDA",
      (valor) => {
        expect(
          problemasDe(
            "confirmarVersionDeMarca",
            con("confirmarVersionDeMarca", { versionEsperada: valor }),
          ),
        ).toEqual([{ campo: "versionEsperada", motivo: "FORMA_INVALIDA", esperado: "version" }]);
      },
    );

    it("confirmarVersionDeMarca: sin versionEsperada, FALTA", () => {
      const json = con("confirmarVersionDeMarca", { versionEsperada: undefined });
      expect(problemasDe("confirmarVersionDeMarca", json)).toEqual([
        { campo: "versionEsperada", motivo: "FALTA", esperado: "version" },
      ]);
    });

    it.each([[null], [1], [2_147_483_647]])("numeroEsperado %j vale", (valor) => {
      const r = armarEntradaDelCaso("asignarPlan", con("asignarPlan", { numeroEsperado: valor }));
      expect(r.ok && r.valor.numeroEsperado).toBe(valor);
    });

    it.each([[0], [-3], [0.5], [2_147_483_648]])(
      "numeroEsperado %j: NUMERO_ESPERADO_INVALIDO",
      (valor) => {
        expect(problemasDe("asignarPlan", con("asignarPlan", { numeroEsperado: valor }))).toEqual([
          { campo: "numeroEsperado", motivo: "NUMERO_ESPERADO_INVALIDO", esperado: null },
        ]);
      },
    );

    it.each([["2"], [false], [{}]])("numeroEsperado %j: FORMA_INVALIDA", (valor) => {
      expect(problemasDe("asignarPlan", con("asignarPlan", { numeroEsperado: valor }))).toEqual([
        { campo: "numeroEsperado", motivo: "FORMA_INVALIDA", esperado: "numeroONulo" },
      ]);
    });
  });

  describe("booleano", () => {
    it.each([["true"], [1], [0], [null], ["false"]])("%j no es un booleano", (valor) => {
      expect(
        problemasDe("asignarPlan", con("asignarPlan", { reemplazaProgramada: valor })),
      ).toEqual([{ campo: "reemplazaProgramada", motivo: "FORMA_INVALIDA", esperado: "booleano" }]);
    });

    it("false y true valen", () => {
      for (const valor of [true, false]) {
        const r = armarEntradaDelCaso(
          "asignarPlan",
          con("asignarPlan", { reemplazaProgramada: valor }),
        );
        expect(r.ok && r.valor.reemplazaProgramada).toBe(valor);
      }
    });
  });

  describe("vigencia", () => {
    it.each([
      ["2026-10-20T12:30Z"],
      ["2026-10-20T12:30:45Z"],
      ["2026-10-20T12:30:45.5Z"],
      ["2026-10-20T12:30:45.123+05:30"],
      ["2026-10-20T12:30:45-03:00"],
    ])("%s vale", (fecha) => {
      expect(
        armarEntradaDelCaso("asignarPlan", con("asignarPlan", { vigenteDesde: fecha })).ok,
      ).toBe(true);
    });

    it.each([
      ["sin zona", "2026-10-20T12:30:45"],
      ["solo la fecha", "2026-10-20"],
      ["con espacio en vez de T", "2026-10-20 12:30:45Z"],
      ["con la zona sin dos puntos", "2026-10-20T12:30:45-0300"],
      ["sin minutos", "2026-10-20T12Z"],
      ["con fracción de cuatro dígitos", "2026-10-20T12:30:45.1234Z"],
      ["con texto de más al final", "2026-10-20T12:30:45Z "],
      ["con texto de más al principio", " 2026-10-20T12:30:45Z"],
      ["con año de dos dígitos", "26-10-20T12:30:45Z"],
      ["que no es una fecha", "mañana"],
      ["vacía", ""],
      ["con mes inexistente", "2026-13-20T12:30:45Z"],
      ["con hora inexistente", "2026-10-20T25:30:45Z"],
    ])("%s: VIGENCIA_INVALIDA", (_cual, fecha) => {
      expect(problemasDe("asignarPlan", con("asignarPlan", { vigenteDesde: fecha }))).toEqual([
        { campo: "vigenteDesde", motivo: "VIGENCIA_INVALIDA", esperado: null },
      ]);
    });

    it.each([[null], [1_760_000_000_000], [{}], [true]])(
      "%j no es un texto: FORMA_INVALIDA",
      (valor) => {
        expect(problemasDe("asignarPlan", con("asignarPlan", { vigenteDesde: valor }))).toEqual([
          { campo: "vigenteDesde", motivo: "FORMA_INVALIDA", esperado: "vigencia" },
        ]);
      },
    );
  });

  describe("motivo", () => {
    it("el límite vale y un carácter más no", () => {
      const justo = "m".repeat(LARGO_MAXIMO_DEL_MOTIVO);
      expect(
        armarEntradaDelCaso(
          "publicarVersionDePlan",
          con("publicarVersionDePlan", { motivo: justo }),
        ).ok,
      ).toBe(true);
      expect(
        problemasDe("publicarVersionDePlan", con("publicarVersionDePlan", { motivo: `${justo}m` })),
      ).toEqual([{ campo: "motivo", motivo: "MOTIVO_DEMASIADO_LARGO", esperado: null }]);
    });

    it("un motivo vacío pasa la forma: que sea obligatorio lo decide el caso", () => {
      expect(
        armarEntradaDelCaso("publicarVersionDePlan", con("publicarVersionDePlan", { motivo: "" }))
          .ok,
      ).toBe(true);
    });

    it.each([[null], [4], [{}]])("%j no es un texto", (valor) => {
      expect(
        problemasDe("publicarVersionDePlan", con("publicarVersionDePlan", { motivo: valor })),
      ).toEqual([{ campo: "motivo", motivo: "FORMA_INVALIDA", esperado: "motivo" }]);
    });
  });

  describe("textos opcionales, objetos y listas", () => {
    const marca = (cambios: Record<string, unknown>) => con("guardarBorradorDeMarca", cambios);

    it.each([
      ["nombreVisible", "textoONulo"],
      ["logo", "textoONulo"],
    ])("%s: un número no es texto", (campo, esperado) => {
      expect(problemasDe("guardarBorradorDeMarca", marca({ [campo]: 3 }))).toEqual([
        { campo, motivo: "FORMA_INVALIDA", esperado },
      ]);
    });

    it.each([["tema"], ["aspecto"]])("%s: tiene que ser un objeto", (campo) => {
      for (const valor of [null, [], "x", 3, true]) {
        expect(problemasDe("guardarBorradorDeMarca", marca({ [campo]: valor }))).toEqual([
          { campo, motivo: "FORMA_INVALIDA", esperado: "objeto" },
        ]);
      }
      expect(armarEntradaDelCaso("guardarBorradorDeMarca", marca({ [campo]: {} })).ok).toBe(true);
    });

    it("las perillas del plan son un objeto", () => {
      for (const valor of [null, [], "x"]) {
        expect(
          problemasDe("guardarBorradorDePlan", con("guardarBorradorDePlan", { perillas: valor })),
        ).toEqual([{ campo: "perillas", motivo: "FORMA_INVALIDA", esperado: "objeto" }]);
      }
    });

    it("el vocabulario es un objeto de textos", () => {
      expect(armarEntradaDelCaso("guardarBorradorDeMarca", marca({ vocabulario: {} })).ok).toBe(
        true,
      );
      for (const valor of [null, [], "x", { a: 1 }, { a: "b", c: null }, { a: ["b"] }]) {
        expect(problemasDe("guardarBorradorDeMarca", marca({ vocabulario: valor }))).toEqual([
          { campo: "vocabulario", motivo: "FORMA_INVALIDA", esperado: "mapaDeTextos" },
        ]);
      }
    });

    it("modulosIniciales: lista de textos o null", () => {
      for (const valor of [[], ["a", "b"], null]) {
        expect(
          armarEntradaDelCaso("guardarBorradorDeMarca", marca({ modulosIniciales: valor })).ok,
        ).toBe(true);
      }
      for (const valor of ["a", {}, ["a", 1], [null], 3]) {
        expect(problemasDe("guardarBorradorDeMarca", marca({ modulosIniciales: valor }))).toEqual([
          { campo: "modulosIniciales", motivo: "FORMA_INVALIDA", esperado: "listaDeTextosONula" },
        ]);
      }
    });

    it("modulos del plan: lista de textos, y null no vale", () => {
      for (const valor of [null, "a", {}, ["a", 1]]) {
        expect(
          problemasDe("guardarBorradorDePlan", con("guardarBorradorDePlan", { modulos: valor })),
        ).toEqual([{ campo: "modulos", motivo: "FORMA_INVALIDA", esperado: "listaDeTextos" }]);
      }
      expect(
        armarEntradaDelCaso("guardarBorradorDePlan", con("guardarBorradorDePlan", { modulos: [] }))
          .ok,
      ).toBe(true);
    });
  });

  describe("dueño de un dominio", () => {
    const dominio = (duenio: unknown) => con("agregarDominio", { duenio });

    it("una marca o una empresa, con su identificador en minúsculas", () => {
      const marca = armarEntradaDelCaso(
        "agregarDominio",
        dominio({ tipo: "MARCA", marcaId: ID_A.toUpperCase() }),
      );
      expect(marca.ok && marca.valor.duenio).toEqual({ tipo: "MARCA", marcaId: ID_A });
      const empresa = armarEntradaDelCaso(
        "agregarDominio",
        dominio({ tipo: "EMPRESA", empresaId: ID_B }),
      );
      expect(empresa.ok && empresa.valor.duenio).toEqual({ tipo: "EMPRESA", empresaId: ID_B });
    });

    it.each([
      ["null", null],
      ["una lista", []],
      ["un texto", "MARCA"],
      ["sin tipo", { marcaId: ID_A }],
      ["con un tipo desconocido", { tipo: "TENANT", tenantId: ID_A }],
      ["una marca con el campo de empresa", { tipo: "MARCA", empresaId: ID_A }],
      ["una empresa con el campo de marca", { tipo: "EMPRESA", marcaId: ID_A }],
      ["una marca sin id", { tipo: "MARCA" }],
      ["con un campo de más", { tipo: "MARCA", marcaId: ID_A, empresaId: ID_B }],
      ["con un campo de más sin id", { tipo: "EMPRESA", empresaId: ID_A, extra: 1 }],
      ["con el id que no es un texto", { tipo: "MARCA", marcaId: 3 }],
    ])("%s: FORMA_INVALIDA", (_cual, duenio) => {
      expect(problemasDe("agregarDominio", dominio(duenio))).toEqual([
        { campo: "duenio", motivo: "FORMA_INVALIDA", esperado: "duenio" },
      ]);
    });

    it("un id que no es un uuid: ID_INVALIDO", () => {
      expect(problemasDe("agregarDominio", dominio({ tipo: "EMPRESA", empresaId: "x" }))).toEqual([
        { campo: "duenio", motivo: "ID_INVALIDO", esperado: null },
      ]);
    });
  });

  describe("controles del conjunto, con el motivo que daría el caso", () => {
    it("el código de marca inválido se rechaza antes de la transacción", () => {
      expect(problemasDe("crearMarca", con("crearMarca", { codigo: "Mi Marca" }))).toEqual([
        { campo: null, motivo: "CODIGO_DE_MARCA_INVALIDO", esperado: null },
      ]);
    });

    it("el alta con un CUIT mal formado, un email mal formado o una moneda desconocida", () => {
      expect(problemasDe("altaDeEmpresa", con("altaDeEmpresa", { cuit: "123" }))).toEqual([
        { campo: null, motivo: "CUIT_FORMATO_INVALIDO", esperado: null },
      ]);
      expect(
        problemasDe("altaDeEmpresa", con("altaDeEmpresa", { emailGerente: "sin-arroba" })),
      ).toEqual([{ campo: null, motivo: "EMAIL_INVALIDO", esperado: null }]);
      expect(problemasDe("altaDeEmpresa", con("altaDeEmpresa", { moneda: "XXX" }))).toEqual([
        { campo: null, motivo: "MONEDA_NO_SOPORTADA", esperado: null },
      ]);
    });

    it("el alta con tenant y nombre a la vez, o con ninguno, no cierra", () => {
      expect(problemasDe("altaDeEmpresa", con("altaDeEmpresa", { tenantId: ID_B }))).toEqual([
        { campo: null, motivo: "TENANT_AMBIGUO", esperado: null },
      ]);
      expect(
        problemasDe(
          "altaDeEmpresa",
          con("altaDeEmpresa", { nombreDeTenant: undefined, marcaId: undefined }),
        ),
      ).toEqual([{ campo: null, motivo: "TENANT_INDEFINIDO", esperado: null }]);
    });

    it("un alta sobre un tenant existente (sin marca ni plan) es válida", () => {
      const r = armarEntradaDelCaso(
        "altaDeEmpresa",
        con("altaDeEmpresa", { nombreDeTenant: undefined, marcaId: undefined, tenantId: ID_B }),
      );
      expect(r.ok).toBe(true);
    });

    it("los controles del conjunto solo corren si la forma está bien", () => {
      expect(
        problemasDe("crearMarca", con("crearMarca", { codigo: "Mi Marca", extra: 1 })),
      ).toEqual([{ campo: "extra", motivo: "NO_SE_ESPERABA", esperado: null }]);
    });

    it("el código de un plan no tiene control de forma acá (lo valida el caso): el de marca no se le aplica", () => {
      expect(armarEntradaDelCaso("crearPlan", con("crearPlan", { codigo: "Plan Base" })).ok).toBe(
        true,
      );
    });

    it("los demás casos no tienen control de conjunto: lo que pasa la forma, pasa", () => {
      for (const caso of [
        "publicarVersionDePlan",
        "activarModuloDeEmpresa",
        "asignarPlan",
      ] as const) {
        expect(armarEntradaDelCaso(caso, VALIDOS[caso].json).ok).toBe(true);
      }
    });
  });
});

describe("leerJson", () => {
  it.each([
    ["{}", {}],
    ['{"a":[1,"b",null]}', { a: [1, "b", null] }],
    ["[]", []],
    ["null", null],
    ["3", 3],
  ])("lee %s", (texto, valor) => {
    expect(leerJson(texto)).toEqual({ ok: true, valor });
  });

  it.each(["", "{", "{'a':1}", "undefined", '{"a":1,}', "[1,]", "// no\n{}", "{} {}"])(
    "«%s» no es JSON",
    (texto) => {
      expect(leerJson(texto)).toEqual({ ok: false, error: "JSON_INVALIDO" });
    },
  );

  it("el error no repite el texto del archivo", () => {
    const r = leerJson('{"cuit": "20-12345678-6", error de sintaxis');
    expect(JSON.stringify(r)).toBe('{"ok":false,"error":"JSON_INVALIDO"}');
  });
});

describe("leerLineaDeComandos", () => {
  const EMAIL = "admin@ejemplo.test";

  it("el nombre de la opción", () => {
    expect(OPCION_DEL_EMAIL_DEL_ADMIN).toBe("--admin-email");
  });

  it.each([
    ["la opción al final", ["crearPlan", "plan.json", "--admin-email", EMAIL]],
    ["la opción al principio", ["--admin-email", EMAIL, "crearPlan", "plan.json"]],
    ["la opción en el medio", ["crearPlan", "--admin-email", EMAIL, "plan.json"]],
    ["con signo igual", ["crearPlan", "plan.json", `--admin-email=${EMAIL}`]],
  ])("%s", (_cual, argumentos) => {
    expect(leerLineaDeComandos(argumentos)).toEqual({
      ok: true,
      valor: { caso: "crearPlan", archivo: "plan.json", emailDelAdmin: EMAIL },
    });
  });

  it("no decide si el caso está en la lista ni si el email sirve", () => {
    expect(leerLineaDeComandos(["cualquiera", "a.json", "--admin-email", "x"])).toEqual({
      ok: true,
      valor: { caso: "cualquiera", archivo: "a.json", emailDelAdmin: "x" },
    });
  });

  it("un email con signo igual adentro se conserva entero", () => {
    expect(leerLineaDeComandos(["c", "a.json", "--admin-email=a=b@x.test"])).toEqual({
      ok: true,
      valor: { caso: "c", archivo: "a.json", emailDelAdmin: "a=b@x.test" },
    });
  });

  it.each([
    ["sin nada", [], "FALTA_EL_CASO"],
    ["solo la opción", ["--admin-email", EMAIL], "FALTA_EL_CASO"],
    ["sin archivo", ["crearPlan", "--admin-email", EMAIL], "FALTA_EL_ARCHIVO"],
    ["sin email", ["crearPlan", "plan.json"], "FALTA_EL_EMAIL_DEL_ADMIN"],
    [
      "con la opción sin valor",
      ["crearPlan", "plan.json", "--admin-email"],
      "FALTA_EL_EMAIL_DEL_ADMIN",
    ],
    [
      "con el valor vacío",
      ["crearPlan", "plan.json", "--admin-email="],
      "FALTA_EL_EMAIL_DEL_ADMIN",
    ],
    [
      "con el valor en blanco",
      ["crearPlan", "plan.json", "--admin-email", "   "],
      "FALTA_EL_EMAIL_DEL_ADMIN",
    ],
    [
      "con un argumento de más",
      ["crearPlan", "plan.json", "otro", "--admin-email", EMAIL],
      "SOBRAN_ARGUMENTOS",
    ],
    [
      "con una opción desconocida",
      ["crearPlan", "plan.json", "--admin-email", EMAIL, "--ver"],
      "OPCION_DESCONOCIDA",
    ],
    [
      "con una opción parecida",
      ["crearPlan", "plan.json", "--admin-emails", EMAIL],
      "OPCION_DESCONOCIDA",
    ],
    [
      "con una opción parecida con igual",
      ["crearPlan", "plan.json", "--admin-emails=x"],
      "OPCION_DESCONOCIDA",
    ],
    [
      "con la opción repetida",
      ["crearPlan", "plan.json", "--admin-email", EMAIL, "--admin-email", EMAIL],
      "OPCION_REPETIDA",
    ],
    [
      "con la opción repetida con igual",
      ["crearPlan", "plan.json", `--admin-email=${EMAIL}`, `--admin-email=${EMAIL}`],
      "OPCION_REPETIDA",
    ],
  ])("%s: %s", (_cual, argumentos, error) => {
    expect(leerLineaDeComandos(argumentos)).toEqual({ ok: false, error });
  });

  it("una opción desconocida se avisa aunque el resto esté mal", () => {
    expect(leerLineaDeComandos(["--ver"])).toEqual({ ok: false, error: "OPCION_DESCONOCIDA" });
  });

  it("una opción repetida con el primero vacío también es repetida", () => {
    expect(
      leerLineaDeComandos(["crearPlan", "plan.json", "--admin-email=", "--admin-email", EMAIL]),
    ).toEqual({ ok: false, error: "OPCION_REPETIDA" });
  });

  it("el valor de la opción puede empezar con guiones (se lo trata como valor)", () => {
    expect(leerLineaDeComandos(["c", "a.json", "--admin-email", "--raro"])).toEqual({
      ok: true,
      valor: { caso: "c", archivo: "a.json", emailDelAdmin: "--raro" },
    });
  });
});
