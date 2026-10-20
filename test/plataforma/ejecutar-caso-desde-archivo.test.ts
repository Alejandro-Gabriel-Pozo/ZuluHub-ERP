import { describe, expect, it, vi } from "vitest";
import {
  armarCasosDeLaLista,
  ejecutarCasoDePlataforma,
  type CasosDeLaLista,
  type EntradaDeEjecucion,
} from "../../scripts/ejecutar-caso-desde-archivo";
import {
  lineasDeResultado,
  textoDeMotivo,
  textoDeProblema,
  textoDeRechazo,
} from "../../scripts/mensajes-de-plataforma";
import {
  CASOS_DE_PLATAFORMA,
  type NombreDeCaso,
} from "../../src/plataforma/dominio/pedido-de-caso";
import { adminPlataformaId } from "../../src/primitivas/identificadores/marca";
import { err, ok } from "../../src/primitivas/resultado/resultado";

/**
 * El despachador de `ejecutar-caso-de-plataforma` con todo inyectado (sin base): la lista cerrada, el orden
 * de los pasos (la forma del archivo se revisa ANTES de buscar al administrador), qué hace cuando el
 * administrador no sirve, cómo cuenta un rechazo y que nada sensible llega a la salida.
 */

const ID_ADMIN = adminPlataformaId("aaaaaaaa-0000-4000-8000-000000000001");
const AHORA = new Date("2026-10-20T12:00:00.000Z");
const CLAVE = "clave-0123456789abcdef";
const EMAIL = "dueno@ejemplo.test";

// Valores inventados y reconocibles: ninguno puede aparecer en lo que se imprime. Los secretos son CORTOS a propósito: los largos los taparía además `textoDeErrorSeguro` por su forma y la prueba no distinguiría quién los tapó.
const SECRETOS = {
  PEDERNAL_DB_PLATAFORMA:
    "postgres://usuario-centinela:contrasena-centinela@host-centinela.test/base",
  PEDERNAL_CLAVE_CONTEXTO: "1:clave-centinela-corta",
  PEDERNAL_SECRETO_INVITACIONES: "invitaciones-centinela",
};
const PROHIBIDOS = [
  "usuario-centinela",
  "contrasena-centinela",
  "host-centinela",
  "clave-centinela-corta",
  "invitaciones-centinela",
  SECRETOS.PEDERNAL_DB_PLATAFORMA,
];

const JSON_DE_CREAR_PLAN = JSON.stringify({ claveDeIdempotencia: CLAVE, codigo: "base" });

function casosFalsos(
  respuesta: ReturnType<typeof ok> | ReturnType<typeof err> = ok({
    planId: "p-1",
    yaExistia: false,
  }),
) {
  const llamadas: Array<{ caso: string; contexto: unknown; entrada: unknown }> = [];
  const casos = Object.fromEntries(
    CASOS_DE_PLATAFORMA.map((caso) => [
      caso,
      (contexto: unknown, entrada: unknown) => {
        llamadas.push({ caso, contexto, entrada });
        return Promise.resolve(respuesta);
      },
    ]),
  ) as unknown as CasosDeLaLista;
  return { casos, llamadas };
}

function armar(cambios: Partial<EntradaDeEjecucion> = {}) {
  const salida: string[] = [];
  const errores: string[] = [];
  const buscarAdmin = vi.fn<EntradaDeEjecucion["buscarAdmin"]>(() =>
    Promise.resolve({ id: ID_ADMIN, rol: "ADMIN" as const, activo: true }),
  );
  const leerArchivo = vi.fn<EntradaDeEjecucion["leerArchivo"]>(() =>
    Promise.resolve(JSON_DE_CREAR_PLAN),
  );
  const { casos, llamadas } = casosFalsos();
  const entrada: EntradaDeEjecucion = {
    argumentos: ["crearPlan", "plan.json", "--admin-email", EMAIL],
    entorno: SECRETOS,
    leerArchivo,
    ahora: () => AHORA,
    buscarAdmin,
    casos,
    info: (l) => salida.push(l),
    error: (l) => errores.push(l),
    ...cambios,
  };
  return {
    entrada,
    salida,
    errores,
    buscarAdmin,
    leerArchivo,
    llamadas,
    texto: () => [...salida, ...errores].join("\n"),
  };
}

describe("ejecutarCasoDePlataforma: el camino feliz", () => {
  it("busca al administrador, arma su contexto y ejecuta el caso con la entrada del archivo", async () => {
    const t = armar();
    expect(await ejecutarCasoDePlataforma(t.entrada)).toBe(0);
    expect(t.leerArchivo).toHaveBeenCalledWith("plan.json");
    expect(t.buscarAdmin).toHaveBeenCalledWith(EMAIL, AHORA);
    expect(t.llamadas).toEqual([
      {
        caso: "crearPlan",
        contexto: {
          tipo: "PLATAFORMA",
          actor: { tipo: "ADMIN", id: ID_ADMIN },
          ahora: AHORA,
        },
        entrada: { claveDeIdempotencia: CLAVE, codigo: "base" },
      },
    ]);
    expect(t.salida).toEqual([
      "RESULTADO: OK. Se ejecutó «crearPlan».",
      "  planId: p-1",
      "  yaExistia: no",
    ]);
    expect(t.errores).toEqual([]);
  });

  it("el email del administrador se normaliza antes de buscarlo", async () => {
    const t = armar({
      argumentos: ["crearPlan", "plan.json", "--admin-email", "  Dueno@Ejemplo.TEST "],
    });
    await ejecutarCasoDePlataforma(t.entrada);
    expect(t.buscarAdmin).toHaveBeenCalledWith(EMAIL, AHORA);
  });

  it("la hora se toma una vez y es la misma para buscar y para el contexto", async () => {
    const ahora = vi.fn(() => AHORA);
    const t = armar({ ahora });
    await ejecutarCasoDePlataforma(t.entrada);
    expect(ahora).toHaveBeenCalledTimes(1);
  });

  it("un resultado «ya estaba» lo dice y sale con 0", async () => {
    const { casos } = casosFalsos(ok({ planId: "p-1", yaExistia: true }));
    const t = armar({ casos });
    expect(await ejecutarCasoDePlataforma(t.entrada)).toBe(0);
    expect(t.salida).toContain("  yaExistia: sí");
    expect(t.salida.at(-1)).toBe(
      "Nada cambió: este pedido ya se había hecho (o ya estaba en ese estado).",
    );
  });

  it("no imprime el email del administrador ni los datos del archivo", async () => {
    const t = armar();
    await ejecutarCasoDePlataforma(t.entrada);
    expect(t.texto()).not.toContain(EMAIL);
    expect(t.texto()).not.toContain(CLAVE);
  });
});

describe("ejecutarCasoDePlataforma: la lista cerrada y la línea de comandos", () => {
  it.each([
    "suspenderTenant",
    "cancelarAlta",
    "cancelarAltasVencidas",
    "constructor",
    "__proto__",
    "",
  ])(
    "el caso «%s» fuera de la lista no ejecuta nada ni toca el archivo ni la base",
    async (caso) => {
      const t = armar({ argumentos: [caso, "plan.json", "--admin-email", EMAIL] });
      expect(await ejecutarCasoDePlataforma(t.entrada)).toBe(2);
      expect(t.leerArchivo).not.toHaveBeenCalled();
      expect(t.buscarAdmin).not.toHaveBeenCalled();
      expect(t.llamadas).toEqual([]);
      expect(t.errores.join("\n")).toContain(
        "no es un caso que se pueda ejecutar desde un archivo",
      );
      expect(t.errores.join("\n")).toContain(CASOS_DE_PLATAFORMA.join(", "));
    },
  );

  it.each([
    ["sin argumentos", [], "Falta el nombre del caso."],
    ["sin archivo", ["crearPlan"], "Falta el archivo .json"],
    ["sin email", ["crearPlan", "plan.json"], "Falta --admin-email"],
    [
      "con argumentos de más",
      ["crearPlan", "plan.json", "x", "--admin-email", EMAIL],
      "Sobran argumentos",
    ],
    [
      "con una opción que no existe",
      ["crearPlan", "plan.json", "--ver"],
      "una opción que no existe",
    ],
    [
      "con la opción repetida",
      ["crearPlan", "plan.json", "--admin-email", EMAIL, "--admin-email", EMAIL],
      "está repetida",
    ],
  ])(
    "%s: muestra el motivo y el uso, sale con 2 y no toca nada",
    async (_cual, argumentos, texto) => {
      const t = armar({ argumentos });
      expect(await ejecutarCasoDePlataforma(t.entrada)).toBe(2);
      expect(t.errores.join("\n")).toContain(texto);
      expect(t.errores.at(-1)).toMatch(
        /^Uso: npm run plataforma:caso -- <caso> <archivo\.json> --admin-email/,
      );
      expect(t.leerArchivo).not.toHaveBeenCalled();
      expect(t.buscarAdmin).not.toHaveBeenCalled();
      expect(t.llamadas).toEqual([]);
    },
  );

  it("un email del administrador mal formado sale con 2 antes de leer el archivo", async () => {
    const t = armar({ argumentos: ["crearPlan", "plan.json", "--admin-email", "no-es-un-email"] });
    expect(await ejecutarCasoDePlataforma(t.entrada)).toBe(2);
    expect(t.errores.join("\n")).toContain("--admin-email no tiene forma de email");
    expect(t.errores.join("\n")).not.toContain("no-es-un-email");
    expect(t.leerArchivo).not.toHaveBeenCalled();
    expect(t.buscarAdmin).not.toHaveBeenCalled();
  });
});

describe("ejecutarCasoDePlataforma: el archivo se revisa ANTES de buscar al administrador", () => {
  it("un archivo que no se puede leer sale con 2 y nombra la ruta", async () => {
    const t = armar({
      leerArchivo: () => Promise.reject(new Error(`ENOENT ${SECRETOS.PEDERNAL_DB_PLATAFORMA}`)),
    });
    expect(await ejecutarCasoDePlataforma(t.entrada)).toBe(2);
    expect(t.errores.join("\n")).toContain("no se pudo leer el archivo «plan.json»");
    expect(t.texto()).not.toContain("ENOENT");
    expect(t.buscarAdmin).not.toHaveBeenCalled();
  });

  it("un archivo que no es JSON sale con 2 sin repetir su contenido", async () => {
    const t = armar({ leerArchivo: () => Promise.resolve('{"cuit": "20-12345678-6", roto') });
    expect(await ejecutarCasoDePlataforma(t.entrada)).toBe(2);
    expect(t.errores.join("\n")).toContain("no es un JSON válido");
    expect(t.texto()).not.toContain("20-12345678-6");
    expect(t.buscarAdmin).not.toHaveBeenCalled();
    expect(t.llamadas).toEqual([]);
  });

  it("un archivo con la forma mal lista TODOS los problemas, sin repetir los valores, y no busca al administrador", async () => {
    const t = armar({
      leerArchivo: () =>
        Promise.resolve(
          JSON.stringify({
            claveDeIdempotencia: "corta",
            codigo: 5,
            sobra: "valor-secreto-del-archivo",
          }),
        ),
    });
    expect(await ejecutarCasoDePlataforma(t.entrada)).toBe(2);
    const texto = t.errores.join("\n");
    expect(texto).toContain("el archivo no sirve para «crearPlan»");
    expect(texto).toContain("En el campo «claveDeIdempotencia»: La clave de idempotencia no sirve");
    expect(texto).toContain("En el campo «codigo»: tiene que ser un texto.");
    expect(texto).toContain("En el campo «sobra»: este caso no tiene ese campo.");
    expect(texto).not.toContain("valor-secreto-del-archivo");
    expect(t.buscarAdmin).not.toHaveBeenCalled();
    expect(t.llamadas).toEqual([]);
  });

  it("un control del conjunto (código de marca con mayúsculas) también corta antes de la base", async () => {
    const t = armar({
      argumentos: ["crearMarca", "marca.json", "--admin-email", EMAIL],
      leerArchivo: () =>
        Promise.resolve(
          JSON.stringify({ claveDeIdempotencia: CLAVE, codigo: "Mi Marca", marcaPadreId: null }),
        ),
    });
    expect(await ejecutarCasoDePlataforma(t.entrada)).toBe(2);
    expect(t.errores.join("\n")).toContain("El código de la marca no sirve");
    expect(t.buscarAdmin).not.toHaveBeenCalled();
  });
});

describe("ejecutarCasoDePlataforma: quién actúa", () => {
  it("un administrador que no existe: error claro y no ejecuta nada", async () => {
    const t = armar({ buscarAdmin: () => Promise.resolve(null) });
    expect(await ejecutarCasoDePlataforma(t.entrada)).toBe(1);
    expect(t.errores).toEqual([
      "ERROR: no existe ningún administrador de plataforma con ese email. No se ejecutó nada.",
    ]);
    expect(t.llamadas).toEqual([]);
  });

  it("un administrador dado de baja: error claro y no ejecuta nada", async () => {
    const t = armar({
      buscarAdmin: () => Promise.resolve({ id: ID_ADMIN, rol: "ADMIN", activo: false }),
    });
    expect(await ejecutarCasoDePlataforma(t.entrada)).toBe(1);
    expect(t.errores).toEqual([
      "ERROR: ese administrador de plataforma está dado de baja. No se ejecutó nada.",
    ]);
    expect(t.llamadas).toEqual([]);
  });

  it("un SOPORTE: error claro y no ejecuta nada", async () => {
    const t = armar({
      buscarAdmin: () => Promise.resolve({ id: ID_ADMIN, rol: "SOPORTE", activo: true }),
    });
    expect(await ejecutarCasoDePlataforma(t.entrada)).toBe(1);
    expect(t.errores.join("\n")).toContain("no es ADMIN");
    expect(t.errores.join("\n")).toContain("No se ejecutó nada.");
    expect(t.llamadas).toEqual([]);
  });

  it("un SOPORTE dado de baja se explica por la baja (es lo primero que importa)", async () => {
    const t = armar({
      buscarAdmin: () => Promise.resolve({ id: ID_ADMIN, rol: "SOPORTE", activo: false }),
    });
    await ejecutarCasoDePlataforma(t.entrada);
    expect(t.errores.join("\n")).toContain("dado de baja");
  });
});

describe("ejecutarCasoDePlataforma: rechazos y fallas", () => {
  it("un rechazo del caso sale con 1, lo explica en castellano y dice que no cambió nada", async () => {
    const { casos } = casosFalsos(err("CODIGO_DE_PLAN_INVALIDO"));
    const t = armar({ casos });
    expect(await ejecutarCasoDePlataforma(t.entrada)).toBe(1);
    expect(t.errores).toEqual([
      "ERROR: El código del plan no sirve: minúsculas, dígitos y guion, de 2 a 40 caracteres, y empieza con letra.",
      "RESULTADO: RECHAZADO (no se cambió nada). Caso «crearPlan».",
    ]);
    expect(t.salida).toEqual([]);
  });

  it("una excepción (la base no responde) sale con 1, por describirFallaDeBase, sin la cadena", async () => {
    const t = armar({
      buscarAdmin: () =>
        Promise.reject(
          Object.assign(new Error(`connect ECONNREFUSED ${SECRETOS.PEDERNAL_DB_PLATAFORMA}`), {
            code: "ECONNREFUSED",
          }),
        ),
    });
    expect(await ejecutarCasoDePlataforma(t.entrada)).toBe(1);
    expect(t.errores[0]).toContain("no se pudo conectar con el servidor de la base (ECONNREFUSED)");
    expect(t.errores.at(-1)).toContain("RESULTADO: FALLA");
    expect(t.errores.at(-1)).toContain("es seguro repetirlo");
    for (const prohibido of PROHIBIDOS) expect(t.texto()).not.toContain(prohibido);
  });

  it("una falla del caso que repite todos los secretos se tapa", async () => {
    const todo = Object.values(SECRETOS).join(" | ");
    const casos = {
      ...casosFalsos().casos,
      crearPlan: () => Promise.reject(new Error(`falló con ${todo}`)),
    };
    const t = armar({ casos });
    expect(await ejecutarCasoDePlataforma(t.entrada)).toBe(1);
    for (const prohibido of PROHIBIDOS) expect(t.texto()).not.toContain(prohibido);
  });

  it("aun si el rechazo del caso trae un texto con secretos, no llegan a la salida", async () => {
    const { casos } = casosFalsos(
      err({ tipo: "Inesperado", sqlstate: null, mensaje: `x ${SECRETOS.PEDERNAL_DB_PLATAFORMA}` }),
    );
    const t = armar({ casos });
    expect(await ejecutarCasoDePlataforma(t.entrada)).toBe(1);
    for (const prohibido of PROHIBIDOS) expect(t.texto()).not.toContain(prohibido);
  });

  it("con el entorno sin ninguna de las variables sigue funcionando (no hay nada que tapar)", async () => {
    const t = armar({ entorno: {} });
    expect(await ejecutarCasoDePlataforma(t.entrada)).toBe(0);
  });

  it("una clave de contexto sin dos puntos no rompe el tapado", async () => {
    const t = armar({ entorno: { PEDERNAL_CLAVE_CONTEXTO: "sin-formato" } });
    expect(await ejecutarCasoDePlataforma(t.entrada)).toBe(0);
  });
});

describe("armarCasosDeLaLista: cada nombre corre su caso", () => {
  const llamadas: string[] = [];
  const espia = (grupo: string, nombres: readonly string[]) =>
    Object.fromEntries(
      nombres.map((n) => [
        n,
        (...argumentos: unknown[]) => {
          llamadas.push(`${grupo}.${n}`);
          return Promise.resolve(ok(argumentos));
        },
      ]),
    );
  const plataforma = {
    casosDeUsoDeMarcasYPlanes: () =>
      espia("marcasYPlanes", [
        "crearMarca",
        "guardarBorradorDeMarca",
        "confirmarVersionDeMarca",
        "crearPlan",
        "guardarBorradorDePlan",
        "publicarVersionDePlan",
        "asignarPlan",
        "activarModuloDeEmpresa",
        "desactivarModuloDeEmpresa",
      ]),
    casosDeUsoDeDominios: () => espia("dominios", ["agregarDominio"]),
    casosDeUsoDeAltas: () => espia("altas", ["altaDeEmpresa"]),
  } as unknown as Parameters<typeof armarCasosDeLaLista>[0];

  const ESPERADO: Record<NombreDeCaso, string> = {
    crearMarca: "marcasYPlanes.crearMarca",
    guardarBorradorDeMarca: "marcasYPlanes.guardarBorradorDeMarca",
    confirmarVersionDeMarca: "marcasYPlanes.confirmarVersionDeMarca",
    agregarDominio: "dominios.agregarDominio",
    crearPlan: "marcasYPlanes.crearPlan",
    guardarBorradorDePlan: "marcasYPlanes.guardarBorradorDePlan",
    publicarVersionDePlan: "marcasYPlanes.publicarVersionDePlan",
    asignarPlan: "marcasYPlanes.asignarPlan",
    altaDeEmpresa: "altas.altaDeEmpresa",
    activarModuloDeEmpresa: "marcasYPlanes.activarModuloDeEmpresa",
    desactivarModuloDeEmpresa: "marcasYPlanes.desactivarModuloDeEmpresa",
  };

  it("tiene exactamente los casos de la lista cerrada", () => {
    expect(Object.keys(armarCasosDeLaLista(plataforma)).sort()).toEqual(
      [...CASOS_DE_PLATAFORMA].sort(),
    );
  });

  it.each(CASOS_DE_PLATAFORMA)(
    "%s corre el caso que dice y le pasa el contexto y la entrada",
    async (caso) => {
      llamadas.length = 0;
      const casos = armarCasosDeLaLista(plataforma);
      const contexto = { tipo: "PLATAFORMA" } as never;
      const entrada = { dato: caso } as never;
      const r = await (
        casos[caso] as (c: unknown, e: unknown) => Promise<{ ok: boolean; valor: unknown }>
      )(contexto, entrada);
      expect(llamadas).toEqual([ESPERADO[caso]]);
      expect(r.valor).toEqual([contexto, entrada]);
    },
  );

  it("no arma ningún grupo hasta que se ejecuta un caso (elegir uno no valida el entorno de los demás)", () => {
    const grupos = vi.fn(() => ({}));
    const perezosa = {
      casosDeUsoDeMarcasYPlanes: grupos,
      casosDeUsoDeDominios: grupos,
      casosDeUsoDeAltas: grupos,
    } as unknown as Parameters<typeof armarCasosDeLaLista>[0];
    armarCasosDeLaLista(perezosa);
    expect(grupos).not.toHaveBeenCalled();
  });
});

describe("los textos", () => {
  it("un código con texto propio se explica; uno sin texto se muestra tal cual", () => {
    expect(textoDeMotivo("SIN_PERMISO")).toBe(
      "Ese administrador no tiene permiso para hacer esto.",
    );
    expect(textoDeMotivo("CODIGO_NUEVO_DE_PRUEBA")).toBe(
      "No se hizo ningún cambio. Motivo: CODIGO_NUEVO_DE_PRUEBA.",
    );
    expect(textoDeMotivo("constructor")).toBe("No se hizo ningún cambio. Motivo: constructor.");
  });

  it("un rechazo con datos los muestra junto al texto", () => {
    expect(
      textoDeRechazo(
        { codigo: "LIMITE_DEL_PLAN", perilla: "empresas_por_tenant", limite: 1, usoActual: 1 },
        undefined,
      ),
    ).toBe(
      "Se llegó al tope que fija el plan del cliente. (perilla: empresas_por_tenant, limite: 1, usoActual: 1)",
    );
    expect(textoDeRechazo({ codigo: "MARCA_RETIRADA" }, undefined)).toBe(
      textoDeMotivo("MARCA_RETIRADA"),
    );
  });

  it.each([
    [{ tipo: "Unicidad", restriccion: "x_uk" }, "choca con una regla de datos (x_uk)"],
    [{ tipo: "Check", restriccion: null }, "choca con una regla de datos."],
    [{ tipo: "Referencia", restriccion: "r_fk" }, "(r_fk)"],
    [{ tipo: "Superposicion", restriccion: "s_ex" }, "(s_ex)"],
    [{ tipo: "AccesoDenegado" }, "La base negó el permiso"],
    [{ tipo: "ConcurrenciaAgotada" }, "demasiados cambios a la vez"],
  ])("el error de la base %j se explica", (error, fragmento) => {
    expect(textoDeRechazo(error, undefined)).toContain(fragmento);
  });

  it("una falla inesperada de la base pasa por describirFallaDeBase", () => {
    expect(
      textoDeRechazo({ tipo: "Inesperado", sqlstate: "ECONNRESET", mensaje: "x" }, undefined),
    ).toBe(
      "Falla inesperada de la base: no se pudo conectar con el servidor de la base (ECONNRESET): revisá que la cadena guardada como secreto sea la correcta y que la base esté activa",
    );
    expect(
      textoDeRechazo({ tipo: "Inesperado", sqlstate: null, mensaje: "se rompió" }, undefined),
    ).toContain("se rompió");
  });

  it.each([[undefined], [null], [7], [{ tipo: "Otro" }], [{}]])(
    "un rechazo ilegible (%j) no rompe",
    (error) => {
      expect(textoDeRechazo(error, undefined)).toBe(
        "El caso devolvió un rechazo que no se pudo leer.",
      );
    },
  );

  it("las líneas de un resultado: texto, sí/no y listas", () => {
    expect(
      lineasDeResultado({ numero: 2, nombre: "x", listo: true, otro: false, ids: ["a", "b"] }),
    ).toEqual(["  numero: 2", "  nombre: x", "  listo: sí", "  otro: no", '  ids: ["a","b"]']);
    expect(lineasDeResultado(5)).toEqual(["  resultado: 5"]);
    for (const campo of ["yaExistia", "yaEstabaActivo", "yaEstabaInactivo"]) {
      expect(lineasDeResultado({ [campo]: true }).at(-1)).toMatch(/^Nada cambió/);
      expect(lineasDeResultado({ [campo]: false }).join("\n")).not.toContain("Nada cambió");
    }
  });

  it("los problemas de forma, uno por uno y sin valores", () => {
    expect(textoDeProblema({ campo: "x", motivo: "FALTA", esperado: "id" })).toBe(
      "En el campo «x»: falta; tiene que ser un identificador (uuid) escrito entre comillas.",
    );
    expect(textoDeProblema({ campo: "x", motivo: "FORMA_INVALIDA", esperado: "booleano" })).toBe(
      "En el campo «x»: tiene que ser true o false.",
    );
    expect(textoDeProblema({ campo: null, motivo: "NO_ES_UN_OBJETO", esperado: null })).toBe(
      "El archivo tiene que ser un objeto JSON { ... } con los campos del caso.",
    );
    expect(
      textoDeProblema({ campo: null, motivo: "CODIGO_DE_MARCA_INVALIDO", esperado: null }),
    ).toContain("En el archivo: El código de la marca no sirve");
    expect(textoDeProblema({ campo: null, motivo: "JSON_INVALIDO", esperado: null })).toContain(
      "JSON",
    );
  });
});
