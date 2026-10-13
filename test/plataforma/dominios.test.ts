import { describe, expect, it } from "vitest";
import { REGLAS_DE_PLATAFORMA } from "../../src/capacidades/permisos/plataforma";
import { empresaId } from "../../src/primitivas/identificadores/marca";
import {
  OPERACION_AGREGAR_DOMINIO,
  type EntradaDeAgregarDominio,
} from "../../src/plataforma/casos-de-uso/agregar-dominio";
import {
  OPERACION_ACTIVAR_DOMINIO,
  OPERACION_DESACTIVAR_DOMINIO,
  OPERACION_RETIRAR_DOMINIO,
  OPERACION_VERIFICAR_DOMINIO,
} from "../../src/plataforma/casos-de-uso/cambiar-estado-de-dominio";
import { crearCasosDeUsoDeDominios } from "../../src/plataforma/casos-de-uso/dominios";
import { repetirSiHuboChoqueDeUnicidad } from "../../src/plataforma/casos-de-uso/dominios-comun";
import { err, ok, type Resultado } from "../../src/primitivas/resultado/resultado";
import { comoAdministrador, uuid } from "./apoyo-de-soporte";
import {
  CLAVE_DE_DOMINIOS,
  MARCA_DE_PRUEBA,
  armarDominios,
  dominioDePrueba,
} from "./apoyo-de-dominios";

/**
 * Los casos de uso de dominios (M4a) sin base de datos: el orden de los pasos, qué escriben, qué
 * devuelven y qué errores tienen. La atomicidad, la idempotencia y la concurrencia contra Postgres están en
 * `test/integracion/dominios-*.test.ts`.
 */

const alta = (cambios: Partial<EntradaDeAgregarDominio> = {}): EntradaDeAgregarDominio => ({
  claveDeIdempotencia: CLAVE_DE_DOMINIOS,
  host: "Carta.Ejemplo.com.ar",
  superficie: "CARTA",
  titular: "CLIENTE",
  esCanonico: false,
  duenio: { tipo: "MARCA", marcaId: MARCA_DE_PRUEBA },
  ...cambios,
});

const ID = dominioDePrueba().id;
const sobre = (cambios: object = {}) => ({
  claveDeIdempotencia: CLAVE_DE_DOMINIOS,
  dominioId: ID,
  motivo: "motivo de prueba",
  ...cambios,
});
const VERIFICADO_EN = new Date("2026-10-11T11:00:00Z");

describe("agregar un dominio", () => {
  it("pide la transacción SERIALIZABLE (la de por defecto), con el contexto", async () => {
    const { casos, transacciones } = armarDominios();
    await casos.agregarDominio(comoAdministrador, alta());
    expect(transacciones.pedidas).toEqual([{ contexto: comoAdministrador }]);
  });

  it("registra el host normalizado, devuelve su id, deja la constancia y guarda la clave", async () => {
    const { casos, dominios, auditoria, idempotencia } = armarDominios();
    const r = await casos.agregarDominio(comoAdministrador, alta());
    expect(r).toEqual({ ok: true, valor: { dominioId: uuid(600), yaExistia: false } });
    expect(dominios.filas.get(uuid(600))?.host).toBe("carta.ejemplo.com.ar");
    expect(auditoria.registros).toEqual([
      {
        accion: "DOMINIO_AGREGADO",
        entidad: "dominio",
        entidadId: uuid(600),
        antes: null,
        despues: {
          host: "carta.ejemplo.com.ar",
          superficie: "CARTA",
          estado: "PENDIENTE_VERIFICACION",
          verificadoEn: null,
          motivo: null,
          titular: "CLIENTE",
          esCanonico: false,
          duenioTipo: "MARCA",
          duenioId: MARCA_DE_PRUEBA,
          marcaId: MARCA_DE_PRUEBA,
        },
      },
    ]);
    expect(idempotencia.guardadas.get(CLAVE_DE_DOMINIOS)).toMatchObject({
      operacion: OPERACION_AGREGAR_DOMINIO,
      resultado: { dominioId: uuid(600), yaExistia: false },
    });
  });

  it("un host de empresa lleva a la empresa como dueña", async () => {
    const { casos, dominios } = armarDominios();
    const r = await casos.agregarDominio(
      comoAdministrador,
      alta({ duenio: { tipo: "EMPRESA", empresaId: uuid(80) } }),
    );
    expect(r.ok).toBe(true);
    expect(dominios.filas.get(uuid(600))?.duenio).toEqual({
      tipo: "EMPRESA",
      empresaId: empresaId(uuid(80)),
    });
  });

  it("repetir con la misma clave y el mismo pedido (aunque el host venga escrito distinto) devuelve el mismo dominio, ya existente, sin escribir nada más", async () => {
    const { casos, dominios, auditoria, idempotencia } = armarDominios();
    await casos.agregarDominio(comoAdministrador, alta());
    const llamadas = dominios.llamadas.length;
    const otra = await casos.agregarDominio(
      comoAdministrador,
      alta({ host: "CARTA.ejemplo.com.ar." }),
    );
    expect(otra).toEqual({ ok: true, valor: { dominioId: uuid(600), yaExistia: true } });
    expect(dominios.llamadas).toHaveLength(llamadas);
    expect(auditoria.registros).toHaveLength(1);
    expect(idempotencia.guardadas.size).toBe(1);
  });

  it("la misma clave con otro pedido es CLAVE_REUTILIZADA y no escribe", async () => {
    const { casos, dominios, auditoria } = armarDominios();
    await casos.agregarDominio(comoAdministrador, alta());
    const llamadas = dominios.llamadas.length;
    for (const otro of [
      alta({ host: "otra.ejemplo.com.ar" }),
      alta({ superficie: "APP" }),
      alta({ titular: "OPERADOR" }),
      alta({ esCanonico: true }),
      alta({ duenio: { tipo: "MARCA", marcaId: uuid(71) } }),
      alta({ duenio: { tipo: "EMPRESA", empresaId: uuid(70) } }),
    ]) {
      expect(await casos.agregarDominio(comoAdministrador, otro)).toEqual({
        ok: false,
        error: "CLAVE_REUTILIZADA",
      });
    }
    expect(dominios.llamadas).toHaveLength(llamadas);
    expect(auditoria.registros).toHaveLength(1);
  });

  it("valida la forma DESPUÉS del guard y sin tocar nada: clave, host, superficie, titular, ids y combinaciones", async () => {
    const { casos, dominios, auditoria, idempotencia } = armarDominios();
    const rechazos: Array<[Partial<EntradaDeAgregarDominio>, string]> = [
      [{ claveDeIdempotencia: "corta" }, "CLAVE_DE_IDEMPOTENCIA_INVALIDA"],
      [{ claveDeIdempotencia: "con espacios y más de 16" }, "CLAVE_DE_IDEMPOTENCIA_INVALIDA"],
      [{ host: "http://x.com" }, "HOST_INVALIDO"],
      [{ superficie: "app" }, "SUPERFICIE_INVALIDA"],
      [{ titular: "yo" }, "TITULAR_INVALIDO"],
      [{ duenio: { tipo: "MARCA", marcaId: "no-es-un-uuid" } }, "ID_INVALIDO"],
      [{ duenio: { tipo: "EMPRESA", empresaId: "no-es-un-uuid" } }, "ID_INVALIDO"],
      [
        { duenio: { tipo: "EMPRESA", empresaId: uuid(1) }, superficie: "LANDING" },
        "SUPERFICIE_NO_ADMITIDA_PARA_EMPRESA",
      ],
      [
        { duenio: { tipo: "EMPRESA", empresaId: uuid(1) }, esCanonico: true },
        "CANONICO_SOLO_DE_MARCA",
      ],
    ];
    for (const [cambios, error] of rechazos) {
      expect(await casos.agregarDominio(comoAdministrador, alta(cambios)), error).toEqual({
        ok: false,
        error,
      });
    }
    expect(dominios.llamadas).toEqual([]);
    expect(auditoria.registros).toEqual([]);
    expect(idempotencia.guardadas.size).toBe(0);
  });

  it("un id de marca en mayúsculas se normaliza: es el mismo pedido", async () => {
    const { casos, dominios } = armarDominios();
    const mayusculas = uuid(70).replace(/[a-f]/g, (c) => c.toUpperCase());
    await casos.agregarDominio(
      comoAdministrador,
      alta({ duenio: { tipo: "MARCA", marcaId: mayusculas } }),
    );
    expect(dominios.filas.get(uuid(600))?.duenio).toEqual({
      tipo: "MARCA",
      marcaId: MARCA_DE_PRUEBA,
    });
  });

  it("los choques de la base salen como su motivo tipado (host, canónico, marca retirada o inexistente, empresa inexistente)", async () => {
    const casosConChoque = (restriccion: string, tipo: "Unicidad" | "Check" | "Referencia") =>
      crearCasosDeUsoDeDominios({
        transacciones: {
          ejecutar: () => Promise.resolve(err({ tipo, restriccion })),
        },
        reglas: REGLAS_DE_PLATAFORMA,
      });
    const esperado = [
      ["dominio_host_uk", "Unicidad", "HOST_DUPLICADO"],
      ["dominio_canonico_uk", "Unicidad", "YA_TIENE_CANONICO"],
      ["dominio_marca_retirada", "Check", "MARCA_RETIRADA"],
      ["dominio_duenio_marca_id_fkey", "Referencia", "MARCA_NO_ENCONTRADA"],
      ["dominio_duenio_empresa_id_fkey", "Referencia", "EMPRESA_NO_ENCONTRADA"],
    ] as const;
    for (const [restriccion, tipo, motivo] of esperado) {
      const r = await casosConChoque(restriccion, tipo).agregarDominio(comoAdministrador, alta());
      expect(r, restriccion).toEqual({ ok: false, error: motivo });
    }
    // Una restricción que este caso no declara sale tal cual, tipada.
    const otra = await casosConChoque("dominio_pkey", "Unicidad").agregarDominio(
      comoAdministrador,
      alta(),
    );
    expect(otra).toEqual({ ok: false, error: { tipo: "Unicidad", restriccion: "dominio_pkey" } });
  });
});

describe("verificar, activar, desactivar y retirar", () => {
  const verificar = (c: ReturnType<typeof armarDominios>["casos"], extra: object = {}) =>
    c.verificarDominio(comoAdministrador, { ...sobre(), verificadoEn: VERIFICADO_EN, ...extra });

  it("verificar un pendiente lo verifica con la fecha dada y deja la constancia con el antes y el después", async () => {
    const { casos, auditoria, idempotencia, dominios } = armarDominios([dominioDePrueba()]);
    expect(await verificar(casos)).toEqual({
      ok: true,
      valor: { dominioId: ID, estado: "VERIFICADO", yaEstaba: false },
    });
    expect(dominios.filas.get(ID)).toMatchObject({
      estado: "VERIFICADO",
      verificadoEn: VERIFICADO_EN,
    });
    expect(auditoria.registros).toEqual([
      {
        accion: "DOMINIO_VERIFICADO",
        entidad: "dominio",
        entidadId: ID,
        antes: {
          host: "carta.ejemplo.com.ar",
          superficie: "CARTA",
          estado: "PENDIENTE_VERIFICACION",
          verificadoEn: null,
          motivo: null,
        },
        despues: {
          host: "carta.ejemplo.com.ar",
          superficie: "CARTA",
          estado: "VERIFICADO",
          verificadoEn: VERIFICADO_EN.toISOString(),
          motivo: null,
        },
      },
    ]);
    expect(idempotencia.guardadas.get(CLAVE_DE_DOMINIOS)).toMatchObject({
      operacion: OPERACION_VERIFICAR_DOMINIO,
    });
  });

  it("activar, desactivar y retirar dejan su constancia y usan su operación de idempotencia", async () => {
    const { casos, auditoria, idempotencia } = armarDominios([
      dominioDePrueba({ estado: "VERIFICADO", verificadoEn: VERIFICADO_EN }),
    ]);
    const clave = (n: number) => `clave-de-dominios-00${n}`;
    expect(
      (await casos.activarDominio(comoAdministrador, sobre({ claveDeIdempotencia: clave(1) }))).ok,
    ).toBe(true);
    expect(
      (await casos.desactivarDominio(comoAdministrador, sobre({ claveDeIdempotencia: clave(2) })))
        .ok,
    ).toBe(true);
    expect(
      (
        await casos.retirarDominio(
          comoAdministrador,
          sobre({ claveDeIdempotencia: clave(3), motivo: "  se fue  " }),
        )
      ).ok,
    ).toBe(true);
    expect(auditoria.registros.map((r) => r.accion)).toEqual([
      "DOMINIO_ACTIVADO",
      "DOMINIO_DESACTIVADO",
      "DOMINIO_RETIRADO",
    ]);
    expect(auditoria.registros[2]?.despues).toMatchObject({ estado: "RETIRADO", motivo: "se fue" });
    expect(auditoria.registros[1]?.despues).toMatchObject({
      estado: "PENDIENTE_VERIFICACION",
      verificadoEn: null,
    });
    expect([...idempotencia.guardadas.values()].map((f) => f.operacion)).toEqual([
      OPERACION_ACTIVAR_DOMINIO,
      OPERACION_DESACTIVAR_DOMINIO,
      OPERACION_RETIRAR_DOMINIO,
    ]);
  });

  it("lo que ya estaba así es éxito sin escribir ni auditar, pero guarda la clave", async () => {
    const { casos, dominios, auditoria, idempotencia } = armarDominios([
      dominioDePrueba({ estado: "ACTIVO", verificadoEn: VERIFICADO_EN }),
      dominioDePrueba({ id: dominioId2(), estado: "RETIRADO", motivo: "x", verificadoEn: null }),
    ]);
    expect(await casos.activarDominio(comoAdministrador, sobre())).toEqual({
      ok: true,
      valor: { dominioId: ID, estado: "ACTIVO", yaEstaba: true },
    });
    expect(
      await casos.retirarDominio(
        comoAdministrador,
        sobre({
          claveDeIdempotencia: "clave-de-dominios-0002",
          dominioId: dominioId2(),
          motivo: "otro motivo",
        }),
      ),
    ).toEqual({ ok: true, valor: { dominioId: dominioId2(), estado: "RETIRADO", yaEstaba: true } });
    expect(dominios.llamadas.filter((l) => l.startsWith("cambiarEstado"))).toEqual([]);
    expect(auditoria.registros).toEqual([]);
    expect(idempotencia.guardadas.size).toBe(2);
  });

  it("repetir con la misma clave devuelve el mismo resultado marcado yaEstaba, sin releer ni escribir", async () => {
    const { casos, dominios, auditoria } = armarDominios([dominioDePrueba()]);
    await verificar(casos);
    const llamadas = dominios.llamadas.length;
    expect(await verificar(casos)).toEqual({
      ok: true,
      valor: { dominioId: ID, estado: "VERIFICADO", yaEstaba: true },
    });
    expect(dominios.llamadas).toHaveLength(llamadas);
    expect(auditoria.registros).toHaveLength(1);
  });

  it("la misma clave con otro dominio, otra fecha u otro motivo es CLAVE_REUTILIZADA", async () => {
    const { casos } = armarDominios([dominioDePrueba()]);
    await verificar(casos);
    expect(await verificar(casos, { dominioId: uuid(501) })).toEqual({
      ok: false,
      error: "CLAVE_REUTILIZADA",
    });
    expect(await verificar(casos, { verificadoEn: new Date(VERIFICADO_EN.getTime() + 1) })).toEqual(
      {
        ok: false,
        error: "CLAVE_REUTILIZADA",
      },
    );
    // otra operación con la misma clave
    expect(await casos.activarDominio(comoAdministrador, sobre())).toEqual({
      ok: false,
      error: "CLAVE_REUTILIZADA",
    });
  });

  it("retirar con el motivo escrito distinto (espacios) es el mismo pedido", async () => {
    const { casos } = armarDominios([dominioDePrueba()]);
    await casos.retirarDominio(comoAdministrador, sobre({ motivo: "se fue" }));
    expect(
      await casos.retirarDominio(comoAdministrador, sobre({ motivo: "  se fue " })),
    ).toMatchObject({
      ok: true,
      valor: { yaEstaba: true },
    });
  });

  it("errores de negocio: no existe, retirado, sin verificar, canónico, motivo; ninguno escribe ni deja clave", async () => {
    const { casos, dominios, auditoria, idempotencia } = armarDominios([
      dominioDePrueba(),
      dominioDePrueba({ id: dominioId2(), estado: "RETIRADO", motivo: "x" }),
      dominioDePrueba({
        id: dominioId3(),
        esCanonico: true,
        estado: "ACTIVO",
        verificadoEn: VERIFICADO_EN,
      }),
    ]);
    const casosYErrores = [
      [
        () => casos.activarDominio(comoAdministrador, sobre({ dominioId: uuid(999) })),
        "DOMINIO_NO_ENCONTRADO",
      ],
      [() => casos.activarDominio(comoAdministrador, sobre()), "DOMINIO_SIN_VERIFICAR"],
      [
        () => casos.activarDominio(comoAdministrador, sobre({ dominioId: dominioId2() })),
        "DOMINIO_RETIRADO",
      ],
      [
        () => casos.desactivarDominio(comoAdministrador, sobre({ dominioId: dominioId2() })),
        "DOMINIO_RETIRADO",
      ],
      [() => verificar(casos, { dominioId: dominioId2() }), "DOMINIO_RETIRADO"],
      [
        () =>
          casos.retirarDominio(comoAdministrador, sobre({ dominioId: dominioId3(), motivo: "x" })),
        "DOMINIO_CANONICO",
      ],
      [
        () => casos.retirarDominio(comoAdministrador, sobre({ motivo: "   " })),
        "MOTIVO_OBLIGATORIO",
      ],
      [
        () => casos.retirarDominio(comoAdministrador, sobre({ motivo: "x".repeat(501) })),
        "MOTIVO_DEMASIADO_LARGO",
      ],
      [
        () => verificar(casos, { verificadoEn: new Date("2027-01-01T00:00:00Z") }),
        "FECHA_DE_VERIFICACION_INVALIDA",
      ],
      [() => verificar(casos, { verificadoEn: new Date("no") }), "FECHA_DE_VERIFICACION_INVALIDA"],
      [() => verificar(casos, { dominioId: "no-es-un-uuid" }), "ID_INVALIDO"],
      [() => verificar(casos, { claveDeIdempotencia: "corta" }), "CLAVE_DE_IDEMPOTENCIA_INVALIDA"],
    ] as const;
    for (const [llamar, error] of casosYErrores) {
      expect(await llamar(), error).toEqual({ ok: false, error });
    }
    expect(dominios.llamadas.filter((l) => l.startsWith("cambiarEstado"))).toEqual([]);
    expect(auditoria.registros).toEqual([]);
    expect(idempotencia.guardadas.size).toBe(0);
  });

  it("sin la versión (otro cambió antes, con un aislamiento menor) devuelve ConcurrenciaAgotada y no deja constancia ni clave", async () => {
    const { casos, dominios, auditoria, idempotencia } = armarDominios([dominioDePrueba()]);
    dominios.perderLaVersion = true;
    expect(await verificar(casos)).toEqual({ ok: false, error: { tipo: "ConcurrenciaAgotada" } });
    expect(auditoria.registros).toEqual([]);
    expect(idempotencia.guardadas.size).toBe(0);
  });

  it("los choques de la base salen como su motivo tipado (transición, fecha, retirado, canónico)", async () => {
    const conChoque = (restriccion: string) =>
      crearCasosDeUsoDeDominios({
        transacciones: {
          ejecutar: () => Promise.resolve(err({ tipo: "Check", restriccion } as const)),
        },
        reglas: REGLAS_DE_PLATAFORMA,
      });
    const esperado = [
      ["dominio_transicion_invalida", "TRANSICION_DE_DOMINIO_INVALIDA"],
      ["dominio_verificacion_inmutable", "FECHA_DE_VERIFICACION_INMUTABLE"],
      ["dominio_retirado_inmutable", "DOMINIO_RETIRADO"],
      ["dominio_canonico_no_se_retira", "DOMINIO_CANONICO"],
    ] as const;
    for (const [restriccion, motivo] of esperado) {
      expect(
        await conChoque(restriccion).activarDominio(comoAdministrador, sobre()),
        restriccion,
      ).toEqual({
        ok: false,
        error: motivo,
      });
    }
    // las que estos casos no declaran (por ejemplo las del alta) salen tal cual
    expect(await conChoque("dominio_host_uk").activarDominio(comoAdministrador, sobre())).toEqual({
      ok: false,
      error: { tipo: "Check", restriccion: "dominio_host_uk" },
    });
  });
});

describe("el guard es el primer paso de cada caso", () => {
  it("SOPORTE y un administrador inexistente o de baja reciben SIN_PERMISO sin que se toque nada", async () => {
    for (const rol of ["SOPORTE", null] as const) {
      const { casos, dominios, auditoria, idempotencia } = armarDominios([dominioDePrueba()], rol);
      const llamadas = [
        casos.agregarDominio(comoAdministrador, alta()),
        casos.verificarDominio(comoAdministrador, { ...sobre(), verificadoEn: VERIFICADO_EN }),
        casos.activarDominio(comoAdministrador, sobre()),
        casos.desactivarDominio(comoAdministrador, sobre()),
        casos.retirarDominio(comoAdministrador, sobre({ motivo: "x" })),
      ];
      for (const r of await Promise.all(llamadas)) {
        expect(r, String(rol)).toEqual({ ok: false, error: "SIN_PERMISO" });
      }
      expect(dominios.llamadas).toEqual([]);
      expect(auditoria.registros).toEqual([]);
      expect(idempotencia.guardadas.size).toBe(0);
    }
  });

  it("el guard va antes que la validación: una entrada inválida de quien no puede sigue siendo SIN_PERMISO", async () => {
    const { casos } = armarDominios([], "SOPORTE");
    expect(
      await casos.agregarDominio(
        comoAdministrador,
        alta({ host: "no valido", claveDeIdempotencia: "x" }),
      ),
    ).toEqual({
      ok: false,
      error: "SIN_PERMISO",
    });
  });
});

describe("solo el contexto de plataforma llega a los casos de dominios", () => {
  const deEmpresa = {
    tipo: "OPERATIVO",
    empresaId: empresaId(uuid(3)),
    personaId: null,
    marcaDeEntrada: null,
    ahora: new Date("2026-10-11T12:00:00Z"),
  } as const;

  it("un contexto de empresa no compila", () => {
    const noSeEjecuta = () => {
      const { casos } = armarDominios();
      // @ts-expect-error el contexto de una empresa no es de plataforma
      return casos.agregarDominio(deEmpresa, alta());
    };
    expect(noSeEjecuta).toBeTypeOf("function");
  });

  it("si alguien se lo salta sin tipar, falla fuerte antes de abrir ninguna transacción", async () => {
    const { casos, transacciones, dominios } = armarDominios([dominioDePrueba()]);
    const sinTipar = deEmpresa as never;
    const llamadas = [
      casos.agregarDominio(sinTipar, alta()),
      casos.verificarDominio(sinTipar, { ...sobre(), verificadoEn: VERIFICADO_EN }),
      casos.activarDominio(sinTipar, sobre()),
      casos.desactivarDominio(sinTipar, sobre()),
      casos.retirarDominio(sinTipar, sobre()),
    ];
    for (const llamada of llamadas) {
      await expect(llamada).rejects.toThrow(RangeError);
      await expect(llamada).rejects.toThrow("no es de plataforma");
    }
    expect(transacciones.pedidas).toEqual([]);
    expect(dominios.llamadas).toEqual([]);
  });
});

describe("repetirSiHuboChoqueDeUnicidad", () => {
  const choque = err({ tipo: "Unicidad", restriccion: "dominio_host_uk" } as const);

  it("un choque de unicidad se repite UNA vez, en una transacción nueva, y devuelve lo que dé la segunda", async () => {
    let intentos = 0;
    const r = await repetirSiHuboChoqueDeUnicidad(() => {
      intentos += 1;
      return Promise.resolve(intentos === 1 ? choque : ok("repetición vista"));
    });
    expect(r).toEqual(ok("repetición vista"));
    expect(intentos).toBe(2);
  });

  it("si la segunda vuelve a chocar, sale el choque (no se repite más)", async () => {
    let intentos = 0;
    const r = await repetirSiHuboChoqueDeUnicidad(() => {
      intentos += 1;
      return Promise.resolve(choque);
    });
    expect(r).toEqual(choque);
    expect(intentos).toBe(2);
  });

  it("lo que no es un choque de unicidad no se repite: éxitos, errores de negocio y otros errores de la base", async () => {
    const resultados: Array<Resultado<unknown, unknown>> = [
      ok(1),
      err("HOST_INVALIDO"),
      err({ tipo: "Check", restriccion: "x" }),
      err({ tipo: "Referencia", restriccion: "x" }),
      err({ tipo: "AccesoDenegado" }),
      err({ tipo: "ConcurrenciaAgotada" }),
      err(null),
      err({ sin: "tipo" }),
    ];
    for (const resultado of resultados) {
      let intentos = 0;
      const r = await repetirSiHuboChoqueDeUnicidad(() => {
        intentos += 1;
        return Promise.resolve(resultado);
      });
      expect(r).toBe(resultado);
      expect(intentos).toBe(1);
    }
  });
});

function dominioId2() {
  return dominioDePrueba({ id: uuid(501) as never }).id;
}
function dominioId3() {
  return dominioDePrueba({ id: uuid(502) as never }).id;
}
