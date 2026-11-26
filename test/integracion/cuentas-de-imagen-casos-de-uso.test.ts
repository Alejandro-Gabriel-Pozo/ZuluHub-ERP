import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { ok } from "../../src/primitivas/resultado/resultado";
import { montarCatalogo, valorDe, type EscenarioDeCatalogo } from "./catalogo-apoyo";
import { cuentaDeImagenDeBase } from "./carta-publica-apoyo";
import { agotadaEnElResultado, repetirSiAgotada } from "./concurrencia-apoyo";

/**
 * Las cuentas de imagen declaradas por empresa (0102) por los casos de uso de verdad (guard, transacción, auditoría): declarar y retirar (permiso, validación, idempotencia, tope,
 * aislamiento entre empresas, concurrencia) y la validación del logo al guardar la carta. Dos empresas: lo de una nunca se ve ni se mezcla con lo de la otra.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });
const RONDAS = 3;

const LOGO = {
  proveedor: "CLOUDINARY",
  cuenta: "mi-cuenta_1",
  idPublico: "logos/casa-central",
  version: "1731700000",
  extension: "png",
} as const;

describe.skipIf(base === null)("cuentas de imagen declaradas: casos de uso", () => {
  let c: Awaited<ReturnType<typeof montarCatalogo>>;
  beforeAll(async () => {
    if (base !== null) c = await montarCatalogo(base);
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  const clave = (): string => randomBytes(16).toString("hex");
  const declarar = (e: EscenarioDeCatalogo, cuenta: string, claveDeIdempotencia = clave()) =>
    c.casos.declararCuentaDeImagen(e.gerente, {
      claveDeIdempotencia,
      proveedor: "CLOUDINARY",
      cuenta,
    });
  const filas = async (e: EscenarioDeCatalogo, estado?: string): Promise<number> =>
    c.contar(
      `select count(*) as n from cuenta_de_imagen_declarada where empresa_id = $1 ${estado === undefined ? "" : "and estado = $2"}`,
      estado === undefined ? [e.empresa] : [e.empresa, estado],
    );
  const auditorias = async (e: EscenarioDeCatalogo, accion: string) =>
    (await c.auditoria(e.empresa, accion)).length;
  const nueva = (e: EscenarioDeCatalogo, extra: Record<string, unknown> = {}) => ({
    id: randomUUID(),
    sucursalId: e.sucursal,
    nombre: "Parador El Ensayo",
    estado: "FUERA_DE_LINEA" as const,
    ...extra,
  });
  const logoGuardado = async (cartaId: string): Promise<string | null> =>
    (
      await c.dueno.query<{ logo_cuenta: string | null }>(
        "select logo_cuenta from carta_publica where id = $1",
        [cartaId],
      )
    ).rows[0]?.logo_cuenta ?? null;

  describe("declarar", () => {
    it("I-1: declarar con la misma clave dos veces deja UNA cuenta y una auditoría; la segunda es yaExistia; con la misma clave y otra cuenta, CLAVE_REUTILIZADA", async () => {
      const e = await c.escenario();
      const k = clave();
      const primera = valorDe(await declarar(e, "mi-cuenta", k));
      expect(primera.yaExistia).toBe(false);
      expect(primera.cuenta).toMatchObject({
        proveedor: "CLOUDINARY",
        cuenta: "mi-cuenta",
        estado: "ACTIVA",
        declaradaPor: e.personaDelGerente,
        version: 1,
      });
      const segunda = valorDe(await declarar(e, "mi-cuenta", k));
      expect(segunda).toMatchObject({ yaExistia: true });
      expect(segunda.cuenta.id).toBe(primera.cuenta.id);
      expect(await filas(e)).toBe(1);
      expect(await auditorias(e, "CUENTA_DE_IMAGEN_DECLARADA")).toBe(1);
      expect(await declarar(e, "otra-cuenta", k)).toEqual({
        ok: false,
        error: "CLAVE_REUTILIZADA",
      });
      expect(await filas(e)).toBe(1);
      const [entrada] = await c.auditoria(e.empresa, "CUENTA_DE_IMAGEN_DECLARADA");
      expect(entrada).toMatchObject({
        actor_persona_id: e.personaDelGerente,
        entidad: "cuenta_de_imagen_declarada",
        entidad_id: primera.cuenta.id,
      });
    });

    it("quien no tiene el permiso no declara (el operador), ni quien tiene alcance de una sola sucursal; no se escribe ni se audita nada", async () => {
      const e = await c.escenario();
      const pedido = {
        claveDeIdempotencia: clave(),
        proveedor: "CLOUDINARY",
        cuenta: "sin-permiso",
      };
      expect(await c.casos.declararCuentaDeImagen(e.operador, pedido)).toMatchObject({ ok: false });
      expect(await c.casos.declararCuentaDeImagen(e.administradorDeUnaSucursal, pedido)).toEqual({
        ok: false,
        error: "SUCURSAL_FUERA_DE_ALCANCE",
      });
      expect(await filas(e)).toBe(0);
      expect(await auditorias(e, "CUENTA_DE_IMAGEN_DECLARADA")).toBe(0);
      // El administrador con todas las sucursales sí puede (gerente y administrador, por defecto).
      valorDe(await c.casos.declararCuentaDeImagen(e.administrador, pedido));
      expect(await filas(e)).toBe(1);
    });

    it("lista de permitidos: solo CLOUDINARY y una cuenta con la forma del proveedor; la clave con su forma; nada se guarda", async () => {
      const e = await c.escenario();
      const casos: readonly [Record<string, unknown>, string][] = [
        [{ proveedor: "IMAGEKIT" }, "CUENTA_DE_IMAGEN_INVALIDA"],
        [{ proveedor: "cloudinary" }, "CUENTA_DE_IMAGEN_INVALIDA"],
        [{ proveedor: 7 }, "CUENTA_DE_IMAGEN_INVALIDA"],
        [{ cuenta: "" }, "CUENTA_DE_IMAGEN_INVALIDA"],
        [{ cuenta: "Mayuscula" }, "CUENTA_DE_IMAGEN_INVALIDA"],
        [{ cuenta: "con espacio" }, "CUENTA_DE_IMAGEN_INVALIDA"],
        [{ cuenta: "a".repeat(65) }, "CUENTA_DE_IMAGEN_INVALIDA"],
        [{ cuenta: "a/b" }, "CUENTA_DE_IMAGEN_INVALIDA"],
        [{ cuenta: "res.cloudinary.com" }, "CUENTA_DE_IMAGEN_INVALIDA"],
        [{ cuenta: null }, "CUENTA_DE_IMAGEN_INVALIDA"],
        [{ claveDeIdempotencia: "corta" }, "IDENTIFICADOR_INVALIDO"],
        [{ claveDeIdempotencia: "con espacios en la clave" }, "IDENTIFICADOR_INVALIDO"],
        [{ claveDeIdempotencia: undefined }, "IDENTIFICADOR_INVALIDO"],
      ];
      for (const [extra, error] of casos) {
        const pedido = {
          claveDeIdempotencia: clave(),
          proveedor: "CLOUDINARY",
          cuenta: "valida",
          ...extra,
        };
        expect(
          await c.casos.declararCuentaDeImagen(e.gerente, pedido as never),
          JSON.stringify(extra),
        ).toEqual({ ok: false, error });
      }
      expect(await filas(e)).toBe(0);
      // El borde que sí vale: 64 caracteres.
      valorDe(await declarar(e, "a".repeat(64)));
    });

    it("hasta 2 activas por empresa: la tercera es CUENTA_DE_IMAGEN_TOPE; repetir una activa es YA_DECLARADA aun con el tope lleno; retirar libera el cupo", async () => {
      const e = await c.escenario();
      const uno = valorDe(await declarar(e, "uno"));
      valorDe(await declarar(e, "dos"));
      expect(await declarar(e, "tres")).toEqual({ ok: false, error: "CUENTA_DE_IMAGEN_TOPE" });
      expect(await declarar(e, "uno")).toEqual({
        ok: false,
        error: "CUENTA_DE_IMAGEN_YA_DECLARADA",
      });
      expect(await filas(e)).toBe(2);
      valorDe(
        await c.casos.retirarCuentaDeImagen(e.gerente, {
          id: uno.cuenta.id,
          motivo: "Cerramos la cuenta",
          versionEsperada: uno.cuenta.version,
        }),
      );
      valorDe(await declarar(e, "tres"));
      // Volver a declarar la retirada es una fila NUEVA (queda el rastro de la anterior).
      expect(await declarar(e, "uno")).toEqual({ ok: false, error: "CUENTA_DE_IMAGEN_TOPE" });
      expect(await filas(e)).toBe(3);
      expect(await filas(e, "ACTIVA")).toBe(2);
    });

    it("aislamiento: la misma cuenta la pueden declarar dos empresas (una agencia); lo de una no se ve ni se cuenta en la otra", async () => {
      const a = await c.escenario();
      const b = await c.escenario();
      valorDe(await declarar(a, "agencia"));
      valorDe(await declarar(b, "agencia"));
      valorDe(await declarar(a, "solo-de-a"));
      expect(await filas(a, "ACTIVA")).toBe(2);
      expect(await filas(b, "ACTIVA")).toBe(1);
      // El tope de A no toca a B.
      valorDe(await declarar(b, "otra-de-b"));
      // La auditoría de cada empresa es suya.
      expect(await auditorias(a, "CUENTA_DE_IMAGEN_DECLARADA")).toBe(2);
      expect(await auditorias(b, "CUENTA_DE_IMAGEN_DECLARADA")).toBe(2);
    });
  });

  describe("retirar", () => {
    it("R-1: retirar dos veces es ok; la segunda es yaEstaba y no escribe ni audita", async () => {
      const e = await c.escenario();
      const { cuenta } = valorDe(await declarar(e, "a-retirar"));
      const retirada = valorDe(
        await c.casos.retirarCuentaDeImagen(e.gerente, {
          id: cuenta.id,
          motivo: "Ya no usamos esta cuenta",
          versionEsperada: cuenta.version,
        }),
      );
      expect(retirada.yaEstaba).toBe(false);
      expect(retirada.cuenta).toMatchObject({
        estado: "RETIRADA",
        retiradaPor: e.personaDelGerente,
        motivoDeRetiro: "Ya no usamos esta cuenta",
        version: 2,
      });
      expect(retirada.cuenta.retiradaEn).toBeInstanceOf(Date);
      const otra = valorDe(
        await c.casos.retirarCuentaDeImagen(e.gerente, {
          id: cuenta.id,
          motivo: "Otro motivo cualquiera",
          versionEsperada: cuenta.version,
        }),
      );
      expect(otra.yaEstaba).toBe(true);
      expect(otra.cuenta.motivoDeRetiro).toBe("Ya no usamos esta cuenta");
      expect(await auditorias(e, "CUENTA_DE_IMAGEN_RETIRADA")).toBe(1);
      expect(await filas(e)).toBe(1);
      expect(await filas(e, "ACTIVA")).toBe(0);
    });

    it("sin permiso no retira; la de otra empresa es «no encontrada»; el motivo y la versión se validan", async () => {
      const a = await c.escenario();
      const b = await c.escenario();
      const { cuenta } = valorDe(await declarar(a, "de-a"));
      const pedido = { id: cuenta.id, motivo: "Motivo valido", versionEsperada: cuenta.version };
      expect(await c.casos.retirarCuentaDeImagen(a.operador, pedido)).toMatchObject({ ok: false });
      expect(await c.casos.retirarCuentaDeImagen(b.gerente, pedido)).toEqual({
        ok: false,
        error: "CUENTA_DE_IMAGEN_NO_ENCONTRADA",
      });
      expect(
        await c.casos.retirarCuentaDeImagen(a.gerente, { ...pedido, id: "no-es-un-uuid" }),
      ).toEqual({ ok: false, error: "CUENTA_DE_IMAGEN_NO_ENCONTRADA" });
      for (const motivo of ["", "   ", "x".repeat(301), "con <etiqueta>", "línea\ndos"]) {
        expect(
          await c.casos.retirarCuentaDeImagen(a.gerente, { ...pedido, motivo }),
          motivo,
        ).toEqual({
          ok: false,
          error: "MOTIVO_DE_RETIRO_INVALIDO",
        });
      }
      expect(
        await c.casos.retirarCuentaDeImagen(a.gerente, { ...pedido, versionEsperada: 7 }),
      ).toEqual({ ok: false, error: "VERSION_DESACTUALIZADA" });
      expect(await filas(a, "ACTIVA")).toBe(1);
      expect(await filas(b)).toBe(0);
      expect(await auditorias(a, "CUENTA_DE_IMAGEN_RETIRADA")).toBe(0);
    });
  });

  describe("el logo de la carta al guardar", () => {
    it("un logo de una cuenta NO declarada se rechaza y no guarda nada; con la cuenta declarada se guarda; un logo de la cuenta de OTRA empresa no vale", async () => {
      const a = await c.escenario();
      const b = await c.escenario();
      const pedido = nueva(a, { logo: LOGO });
      expect(await c.casos.guardarCartaPublica(a.gerente, pedido)).toEqual({
        ok: false,
        error: "LOGO_DE_CARTA_CUENTA_NO_DECLARADA",
      });
      expect(
        await c.contar("select count(*) as n from carta_publica where empresa_id = $1", [
          a.empresa,
        ]),
      ).toBe(0);
      // La declara B: a A no le sirve.
      valorDe(await declarar(b, LOGO.cuenta));
      expect(await c.casos.guardarCartaPublica(a.gerente, pedido)).toEqual({
        ok: false,
        error: "LOGO_DE_CARTA_CUENTA_NO_DECLARADA",
      });
      // La declara A: ahora sí, y también B puede usar la suya.
      valorDe(await declarar(a, LOGO.cuenta));
      const guardada = valorDe(await c.casos.guardarCartaPublica(a.gerente, pedido));
      expect(await logoGuardado(guardada.cartaId)).toBe(LOGO.cuenta);
      valorDe(await c.casos.guardarCartaPublica(b.gerente, nueva(b, { logo: LOGO })));
    });

    it("cambiar el logo a otra cuenta no declarada se rechaza; un logo que NO cambia (de una cuenta retirada) no traba la edición de lo demás; quitar el logo siempre se puede", async () => {
      const e = await c.escenario();
      const { cuenta } = valorDe(await declarar(e, LOGO.cuenta));
      const creada = valorDe(
        await c.casos.guardarCartaPublica(e.gerente, nueva(e, { logo: LOGO })),
      );
      valorDe(
        await c.casos.retirarCuentaDeImagen(e.gerente, {
          id: cuenta.id,
          motivo: "Cerramos la cuenta",
          versionEsperada: cuenta.version,
        }),
      );
      const base2 = {
        id: creada.cartaId,
        sucursalId: e.sucursal,
        estado: "FUERA_DE_LINEA" as const,
      };
      // Cambiar el nombre con el MISMO logo (cuenta ya retirada) se puede: ese logo no se muestra, pero la carta se sigue editando.
      const editada = valorDe(
        await c.casos.guardarCartaPublica(e.gerente, {
          ...base2,
          nombre: "Otro nombre",
          logo: LOGO,
          versionEsperada: creada.version,
        }),
      );
      expect(editada.version).toBe(creada.version + 1);
      // Otra versión del logo de la cuenta retirada, o de una cuenta nunca declarada: no.
      for (const logo of [
        { ...LOGO, version: "1800000000" },
        { ...LOGO, cuenta: "nunca-declarada" },
      ]) {
        expect(
          await c.casos.guardarCartaPublica(e.gerente, {
            ...base2,
            nombre: "Otro nombre",
            logo,
            versionEsperada: editada.version,
          }),
        ).toEqual({ ok: false, error: "LOGO_DE_CARTA_CUENTA_NO_DECLARADA" });
      }
      expect(await logoGuardado(creada.cartaId)).toBe(LOGO.cuenta);
      // Quitar el logo siempre se puede.
      valorDe(
        await c.casos.guardarCartaPublica(e.gerente, {
          ...base2,
          nombre: "Otro nombre",
          logo: null,
          versionEsperada: editada.version,
        }),
      );
      expect(await logoGuardado(creada.cartaId)).toBeNull();
    });

    it("la base lo repite aunque el servidor se olvide: un UPDATE directo de la aplicación con una cuenta no declarada falla", async () => {
      const e = await c.escenario();
      valorDe(await declarar(e, LOGO.cuenta));
      const creada = valorDe(
        await c.casos.guardarCartaPublica(e.gerente, nueva(e, { logo: LOGO })),
      );
      // El repositorio solo (sin el caso de uso, que ya lo rechazaría): lo frena la base.
      const directo = await c.entorno.ejecutar({ contexto: e.gerente }, async (tx) =>
        ok(
          await tx.cartasPublicas.actualizar(e.empresaId, creada.cartaId, creada.version, {
            nombre: "Parador El Ensayo",
            rubro: null,
            lugar: null,
            mensajeDePortada: null,
            estado: "FUERA_DE_LINEA",
            modelo: "LISTA",
            cara: null,
            colorPropio: null,
            logo: { ...LOGO, cuenta: "fantasma" },
          }),
        ),
      );
      expect(directo).toMatchObject({
        ok: false,
        error: { tipo: "Check", restriccion: "carta_publica_logo_cuenta_declarada" },
      });
      expect(await logoGuardado(creada.cartaId)).toBe(LOGO.cuenta);
    });
  });

  describe("concurrencia", () => {
    const firme = <R extends { readonly ok: boolean }>(trabajo: () => Promise<R>) =>
      repetirSiAgotada(trabajo, { esAgotada: (r) => agotadaEnElResultado(r as never) });
    const aLaVez = async <A, B>(
      pedidos: readonly [() => Promise<A>, () => Promise<B>],
      ronda: number,
    ): Promise<[A, B]> => {
      c.armarBarrera(2);
      try {
        const [a, b] = pedidos;
        if (ronda % 2 === 0) return await Promise.all([a(), b()]);
        const [y, x] = await Promise.all([b(), a()]);
        return [x, y];
      } finally {
        c.soltarBarrera();
      }
    };

    it("clic doble: la misma declaración a la vez deja UNA cuenta y UNA auditoría; la segunda es yaExistia", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda++) {
        const e = await c.escenario();
        const k = clave();
        const [a, b] = await aLaVez(
          [
            () => firme(() => declarar(e, "doble-clic", k)),
            () => firme(() => declarar(e, "doble-clic", k)),
          ],
          ronda,
        );
        const [x, y] = [valorDe(a), valorDe(b)];
        expect(
          [x.yaExistia, y.yaExistia].filter((v) => !v),
          `ronda ${ronda}`,
        ).toHaveLength(1);
        expect(x.cuenta.id).toBe(y.cuenta.id);
        expect(await filas(e)).toBe(1);
        expect(await auditorias(e, "CUENTA_DE_IMAGEN_DECLARADA")).toBe(1);
      }
    });

    it("tope: con una activa, dos altas DISTINTAS a la vez dejan exactamente dos; la otra es CUENTA_DE_IMAGEN_TOPE", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda++) {
        const e = await c.escenario();
        valorDe(await declarar(e, "previa"));
        const [a, b] = await aLaVez(
          [() => firme(() => declarar(e, "nueva-1")), () => firme(() => declarar(e, "nueva-2"))],
          ronda,
        );
        const resultados = [a, b];
        expect(
          resultados.filter((r) => r.ok),
          `ronda ${ronda}`,
        ).toHaveLength(1);
        const perdedor = resultados.find((r) => !r.ok);
        expect(perdedor).toEqual({ ok: false, error: "CUENTA_DE_IMAGEN_TOPE" });
        expect(await filas(e, "ACTIVA")).toBe(2);
        expect(await auditorias(e, "CUENTA_DE_IMAGEN_DECLARADA")).toBe(2);
      }
    });

    it("tope: con dos activas, ninguna de dos altas a la vez pasa", async () => {
      for (let ronda = 0; ronda < 3; ronda++) {
        const e = await c.escenario();
        valorDe(await declarar(e, "previa-1"));
        valorDe(await declarar(e, "previa-2"));
        const [a, b] = await aLaVez(
          [() => firme(() => declarar(e, "tercera")), () => firme(() => declarar(e, "cuarta"))],
          ronda,
        );
        for (const r of [a, b]) expect(r).toEqual({ ok: false, error: "CUENTA_DE_IMAGEN_TOPE" });
        expect(await filas(e, "ACTIVA")).toBe(2);
      }
    });

    it("la MISMA cuenta a la vez con claves distintas: una gana y la otra es YA_DECLARADA (nunca dos activas iguales)", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda++) {
        const e = await c.escenario();
        const [a, b] = await aLaVez(
          [() => firme(() => declarar(e, "misma")), () => firme(() => declarar(e, "misma"))],
          ronda,
        );
        const resultados = [a, b];
        expect(
          resultados.filter((r) => r.ok),
          `ronda ${ronda}`,
        ).toHaveLength(1);
        expect(resultados.find((r) => !r.ok)).toMatchObject({
          ok: false,
          error: expect.stringMatching(/^CUENTA_DE_IMAGEN_(YA_DECLARADA|TOPE)$/) as unknown,
        });
        expect(await filas(e, "ACTIVA")).toBe(1);
      }
    });

    it("dos retiros a la vez de la misma cuenta: se retira UNA vez y se audita UNA vez", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda++) {
        const e = await c.escenario();
        const { cuenta } = valorDe(await declarar(e, "a-retirar"));
        const retirar = (motivo: string) =>
          firme(() =>
            c.casos.retirarCuentaDeImagen(e.gerente, {
              id: cuenta.id,
              motivo,
              versionEsperada: cuenta.version,
            }),
          );
        const [a, b] = await aLaVez(
          [() => retirar("Primer motivo valido"), () => retirar("Segundo motivo valido")],
          ronda,
        );
        const [x, y] = [valorDe(a), valorDe(b)];
        expect(
          [x.yaEstaba, y.yaEstaba].filter((v) => !v),
          `ronda ${ronda}`,
        ).toHaveLength(1);
        expect(await filas(e, "RETIRADA")).toBe(1);
        expect(await auditorias(e, "CUENTA_DE_IMAGEN_RETIRADA")).toBe(1);
      }
    });

    it("declarar y guardar una carta con ese logo a la vez: la carta nunca queda con el logo de una cuenta que no está declarada", async () => {
      for (let ronda = 0; ronda < 3; ronda++) {
        const e = await c.escenario();
        const [a, b] = await aLaVez(
          [
            () => firme(() => declarar(e, LOGO.cuenta)),
            () => c.casos.guardarCartaPublica(e.gerente, nueva(e, { logo: LOGO })),
          ],
          ronda,
        );
        expect(a.ok, `ronda ${ronda}`).toBe(true);
        if (b.ok) {
          expect(await logoGuardado(b.valor.cartaId)).toBe(LOGO.cuenta);
        } else {
          // Si la carta llegó antes que la declaración, se rechaza con su error (nunca queda a medias).
          expect(b.error).toBe("LOGO_DE_CARTA_CUENTA_NO_DECLARADA");
        }
        const huerfanas = await c.contar(
          `select count(*) as n from carta_publica p where p.empresa_id = $1 and p.logo_cuenta is not null
             and not exists (select 1 from cuenta_de_imagen_declarada d where d.empresa_id = p.empresa_id and d.cuenta = p.logo_cuenta)`,
          [e.empresa],
        );
        expect(huerfanas).toBe(0);
      }
    });
  });

  it("el helper del dueño de la base declara una cuenta como la que declara la aplicación (para las pruebas de otras piezas)", async () => {
    const e = await c.escenario();
    const id = await cuentaDeImagenDeBase(c.dueno, e.empresa, e.personaDelGerente, "de-prueba");
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await declarar(e, "de-prueba")).toEqual({
      ok: false,
      error: "CUENTA_DE_IMAGEN_YA_DECLARADA",
    });
  });
});
