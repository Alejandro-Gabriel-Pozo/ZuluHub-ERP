import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  sonPartesValidas,
  type PartesDeDireccion,
} from "../../src/capacidades/activos/direccion-externa";
import { CARAS_DE_VIDRIERA } from "../../src/capacidades/experiencia/vidriera/caras";
import { CATALOGO_DE_MODELOS_DE_VIDRIERA } from "../../src/capacidades/experiencia/vidriera/modelos";
import { CATALOGO_DE_PERILLAS } from "../../src/capacidades/planes/perillas";
import { COLOR_RRGGBB } from "../../src/primitivas/color/contraste";
import { deLaMarca } from "../utilidades/alcance-del-host";
import { cartaDeBase } from "./carta-publica-apoyo";
import { MARCA_DEL_HOST, adaptadorReal, montarEnsayo } from "./carta-publica-lectura-apoyo";
import { montarCatalogo, valorDe, type EscenarioDeCatalogo } from "./catalogo-apoyo";
import { agotadaEnElResultado, perdedorAceptable, repetirSiAgotada } from "./concurrencia-apoyo";
import { crearBaseAparte } from "./entorno";
import type { BaseDePruebas } from "./global";

/**
 * 0077 (identidad de la carta: modelo, cara, color propio, logo por dirección externa y color de la empresa) contra una base real y por los casos de uso de verdad:
 * forma y espejo con el código, privilegios, el guardado (validación, auditoría, idempotencia, versión, concurrencia, aislamiento, permiso), la lectura pública y
 * la reversión. Plan §11.3 de `carta-identidad-y-portal-datos-diseno.md`.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });
const REVERSION = join(
  import.meta.dirname,
  "../../migraciones/reversiones/0077_revertir_identidad_de_la_carta.sql",
);

const MIGRACION = join(import.meta.dirname, "../../migraciones/0077_identidad_de_la_carta.sql");
/** 0078 (el portal) y 0083 (su plan) dependen de 0077: se revierten antes que ella. */
const REVERSION_DEL_PORTAL = join(
  import.meta.dirname,
  "../../migraciones/reversiones/0078_revertir_portal_de_la_empresa.sql",
);
const REVERSION_DEL_PORTAL_POR_PLAN = join(
  import.meta.dirname,
  "../../migraciones/reversiones/0083_revertir_portal_por_plan.sql",
);

const LOGO = {
  proveedor: "CLOUDINARY",
  cuenta: "mi-cuenta_1",
  idPublico: "logos/casa-central",
  version: "1731700000",
  extension: "png",
} as const;

describe.skipIf(base === null)("identidad de la carta (0077)", () => {
  let c: Awaited<ReturnType<typeof montarCatalogo>>;
  beforeAll(async () => {
    if (base !== null) c = await montarCatalogo(base);
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  const nueva = (e: EscenarioDeCatalogo, extra: Record<string, unknown> = {}) => ({
    id: randomUUID(),
    sucursalId: e.sucursal,
    nombre: "Parador El Ensayo",
    estado: "FUERA_DE_LINEA" as const,
    ...extra,
  });
  const fila = async (id: string) =>
    (
      await c.dueno.query<Record<string, string | null>>(
        `select modelo, cara, color_propio, logo_proveedor, logo_cuenta, logo_id_publico, logo_version, logo_extension, version::text from carta_publica where id = $1`,
        [id],
      )
    ).rows[0];
  const sql = async (texto: string, p: unknown[] = []): Promise<Record<string, unknown>[]> =>
    (await c.dueno.query<Record<string, unknown>>(texto, p)).rows;

  describe("forma y espejo con el código", () => {
    it("el CHECK de modelo y el de cara copian EXACTAMENTE las listas del código (ni una clave más ni una menos)", async () => {
      const defs = await sql(
        `select conname, pg_get_constraintdef(oid) as def from pg_constraint where conrelid = 'carta_publica'::regclass and conname in ('carta_publica_modelo_ck', 'carta_publica_cara_ck')`,
      );
      const claves = (def: string) => [...def.matchAll(/'([A-Z_]+)'::text/g)].map((m) => m[1]);
      const de = (n: string) => String(defs.find((d) => d.conname === n)?.def);
      expect(claves(de("carta_publica_modelo_ck")).sort()).toEqual(
        Object.keys(CATALOGO_DE_MODELOS_DE_VIDRIERA).sort(),
      );
      expect(claves(de("carta_publica_cara_ck")).sort()).toEqual([...CARAS_DE_VIDRIERA].sort());
    });

    it("color_de_carta_valido coincide con COLOR_RRGGBB, carácter por carácter", async () => {
      for (const t of [
        "#1f4e79",
        "#abc",
        "#ABCDEF",
        "#12345g",
        "1f4e79",
        "#1f4e790",
        "#1f4e79\n",
        "",
        " #1f4e79",
        "rgb(0,0,0)",
        "#０１２３４５",
      ]) {
        const [r] = await sql("select color_de_carta_valido($1) as ok", [t]);
        expect(r?.ok, JSON.stringify(t)).toBe(COLOR_RRGGBB.test(t));
      }
      expect((await sql("select color_de_carta_valido(null) as ok"))[0]?.ok).toBe(false);
    });

    it("imagen_externa_valida coincide con sonPartesValidas en los bordes (cuenta 64/65, id 200/201, versión 12/13, cero inicial, extensiones, proveedor) y exige las cinco partes o ninguna", async () => {
      const tramo = (n: number) => "a".repeat(n);
      const casos = [
        LOGO,
        { ...LOGO, cuenta: tramo(64) },
        { ...LOGO, cuenta: tramo(65) },
        { ...LOGO, cuenta: "" },
        { ...LOGO, cuenta: "Mayuscula" },
        { ...LOGO, idPublico: tramo(200) },
        { ...LOGO, idPublico: tramo(201) },
        { ...LOGO, idPublico: "a//b" },
        { ...LOGO, idPublico: "a/b/" },
        { ...LOGO, idPublico: "a b" },
        { ...LOGO, idPublico: "../x" },
        { ...LOGO, version: "9".repeat(12) },
        { ...LOGO, version: "9".repeat(13) },
        { ...LOGO, version: "0123" },
        { ...LOGO, version: "0" },
        { ...LOGO, extension: "jpg" },
        { ...LOGO, extension: "jpeg" },
        { ...LOGO, extension: "webp" },
        { ...LOGO, extension: "svg" },
        { ...LOGO, extension: "gif" },
        { ...LOGO, extension: "PNG" },
        { ...LOGO, proveedor: "OTRO" },
      ];
      for (const partes of casos) {
        const [r] = await sql("select imagen_externa_valida($1, $2, $3, $4, $5) as ok", [
          partes.proveedor,
          partes.cuenta,
          partes.idPublico,
          partes.version,
          partes.extension,
        ]);
        expect(r?.ok, JSON.stringify(partes)).toBe(sonPartesValidas(partes as PartesDeDireccion));
      }
      expect(
        (await sql("select imagen_externa_valida(null, null, null, null, null) as ok"))[0]?.ok,
      ).toBe(true);
      expect(
        (await sql("select imagen_externa_valida('CLOUDINARY', 'c', 'i', '1', null) as ok"))[0]?.ok,
      ).toBe(false);
    });

    it("una carta que ya existía queda en LISTA y sin nada elegido; la base rechaza lo que no es de la lista aunque el código se olvide", async () => {
      const e = await c.escenario();
      const { id } = await cartaDeBase(c.dueno, e.empresa, e.sucursal);
      expect(await fila(id)).toMatchObject({
        modelo: "LISTA",
        cara: null,
        color_propio: null,
        logo_proveedor: null,
      });
      for (const [columna, valor] of [
        ["modelo", "TABLERO"],
        ["modelo", "lista"],
        ["cara", "dia"],
        ["color_propio", "#ABCDEF"],
        ["logo_proveedor", "CLOUDINARY"],
      ] as const) {
        await expect(
          c.dueno.query(`update carta_publica set ${columna} = $1 where id = $2`, [valor, id]),
          `${columna}=${valor}`,
        ).rejects.toMatchObject({ code: "23514" });
      }
    });
  });

  describe("privilegios y aislamiento en la base", () => {
    it("nadie tiene DELETE ni TRUNCATE sobre la identidad de la empresa y el disparador frena el borrado aun al dueño", async () => {
      const e = await c.escenario();
      await c.dueno.query(
        "insert into identidad_de_carta_empresa (empresa_id, color_principal) values ($1, '#0e7490')",
        [e.empresa],
      );
      for (const rol of ["pedernal_app", "pedernal_publico"]) {
        for (const privilegio of ["DELETE", "TRUNCATE"]) {
          const [r] = await sql(
            "select has_table_privilege($1, 'identidad_de_carta_empresa', $2) as p",
            [rol, privilegio],
          );
          expect(r?.p, `${rol} ${privilegio}`).toBe(false);
        }
      }
      await expect(
        c.dueno.query("delete from identidad_de_carta_empresa where empresa_id = $1", [e.empresa]),
      ).rejects.toThrow();
    });

    it("el color de la empresa: una sola fila por empresa, solo #rrggbb, y la empresa no cambia", async () => {
      const e = await c.escenario();
      await c.dueno.query(
        "insert into identidad_de_carta_empresa (empresa_id, color_principal) values ($1, '#0e7490')",
        [e.empresa],
      );
      await expect(
        c.dueno.query("insert into identidad_de_carta_empresa (empresa_id) values ($1)", [
          e.empresa,
        ]),
      ).rejects.toMatchObject({ code: "23505" });
      await expect(
        c.dueno.query(
          "update identidad_de_carta_empresa set color_principal = '#0E7490' where empresa_id = $1",
          [e.empresa],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      const otra = await c.escenario();
      await expect(
        c.dueno.query(
          "update identidad_de_carta_empresa set empresa_id = $1 where empresa_id = $2",
          [otra.empresa, e.empresa],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    });
  });

  describe("guardarCartaPublica con identidad", () => {
    it("guarda modelo, cara, color propio y logo; audita antes y después; y repetirlo es yaExistia sin escribir ni auditar (idempotencia)", async () => {
      const e = await c.escenario();
      const pedido = nueva(e, {
        modelo: "LISTA",
        cara: "BOLICHE",
        colorPropio: "#0e7490",
        logo: LOGO,
      });
      const primera = valorDe(await c.casos.guardarCartaPublica(e.gerente, pedido));
      expect(primera).toMatchObject({ version: 1, yaExistia: false });
      expect(await fila(pedido.id)).toEqual({
        modelo: "LISTA",
        cara: "BOLICHE",
        color_propio: "#0e7490",
        logo_proveedor: "CLOUDINARY",
        logo_cuenta: "mi-cuenta_1",
        logo_id_publico: "logos/casa-central",
        logo_version: "1731700000",
        logo_extension: "png",
        version: "1",
      });
      const segunda = valorDe(await c.casos.guardarCartaPublica(e.gerente, pedido));
      expect(segunda).toEqual({ ...primera, yaExistia: true });
      expect((await c.auditoria(e.empresa, "CARTA_PUBLICA_CREADA")).length).toBe(1);

      // Editar la cara: una versión nueva y una auditoría con el antes y el después.
      const editada = valorDe(
        await c.casos.guardarCartaPublica(e.gerente, {
          ...pedido,
          cara: "NOCHE",
          versionEsperada: 1,
        }),
      );
      expect(editada).toMatchObject({ version: 2, yaExistia: false });
      const [editada1] = await c.auditoria(e.empresa, "CARTA_PUBLICA_EDITADA");
      expect(editada1).toMatchObject({
        antes: { cara: "BOLICHE", modelo: "LISTA", colorPropio: "#0e7490", logo: LOGO },
        despues: { cara: "NOCHE", modelo: "LISTA", colorPropio: "#0e7490", logo: LOGO },
      });
      // La misma edición otra vez (clic doble con la versión vieja): no escribe, no audita.
      const repetida = valorDe(
        await c.casos.guardarCartaPublica(e.gerente, {
          ...pedido,
          cara: "NOCHE",
          versionEsperada: 1,
        }),
      );
      expect(repetida).toMatchObject({ version: 2, yaExistia: true });
      expect((await c.auditoria(e.empresa, "CARTA_PUBLICA_EDITADA")).length).toBe(1);
      // Con otra versión y otro contenido, VERSION_DESACTUALIZADA.
      expect(
        await c.casos.guardarCartaPublica(e.gerente, {
          ...pedido,
          cara: "DIA",
          versionEsperada: 1,
        }),
      ).toEqual({ ok: false, error: "VERSION_DESACTUALIZADA" });
    });

    it("ausente o vacío es «sin elegir»: LISTA, sin cara, sin color y sin logo (NULL), y se puede volver a ese estado", async () => {
      const e = await c.escenario();
      const pedido = nueva(e, { cara: "NOCHE", colorPropio: "#0e7490", logo: LOGO });
      valorDe(await c.casos.guardarCartaPublica(e.gerente, pedido));
      valorDe(
        await c.casos.guardarCartaPublica(e.gerente, {
          ...pedido,
          modelo: "  ",
          cara: "",
          colorPropio: "   ",
          logo: null,
          versionEsperada: 1,
        }),
      );
      expect(await fila(pedido.id)).toMatchObject({
        modelo: "LISTA",
        cara: null,
        color_propio: null,
        logo_proveedor: null,
        logo_extension: null,
      });
    });

    it("lista de permitidos: modelo, cara, color y logo fuera de lo permitido se rechazan con su error y no guardan nada", async () => {
      const e = await c.escenario();
      const t = (n: number) => "a".repeat(n);
      const casos: readonly [Record<string, unknown>, string][] = [
        [{ modelo: "TABLERO" }, "MODELO_DE_CARTA_INVALIDO"],
        [{ modelo: "lista" }, "MODELO_DE_CARTA_INVALIDO"],
        [{ modelo: " LISTA" }, "MODELO_DE_CARTA_INVALIDO"],
        [{ modelo: 7 }, "MODELO_DE_CARTA_INVALIDO"],
        [{ cara: "dia" }, "CARA_DE_CARTA_INVALIDA"],
        [{ cara: "PASTELERIA" }, "CARA_DE_CARTA_INVALIDA"],
        [{ colorPropio: "#abc" }, "COLOR_DE_CARTA_INVALIDO"],
        [{ colorPropio: "#ABCDEF" }, "COLOR_DE_CARTA_INVALIDO"],
        [{ colorPropio: "#12345g" }, "COLOR_DE_CARTA_INVALIDO"],
        [{ colorPropio: "rgb(0,0,0)" }, "COLOR_DE_CARTA_INVALIDO"],
        [{ colorPropio: "#1f4e79 " }, "COLOR_DE_CARTA_INVALIDO"],
        [{ colorPropio: 123 }, "COLOR_DE_CARTA_INVALIDO"],
        [{ logo: { ...LOGO, proveedor: "OTRO" } }, "LOGO_DE_CARTA_INVALIDO"],
        [{ logo: { ...LOGO, cuenta: t(65) } }, "LOGO_DE_CARTA_INVALIDO"],
        [{ logo: { ...LOGO, idPublico: t(201) } }, "LOGO_DE_CARTA_INVALIDO"],
        [{ logo: { ...LOGO, version: "9".repeat(13) } }, "LOGO_DE_CARTA_INVALIDO"],
        [{ logo: { ...LOGO, version: "0123" } }, "LOGO_DE_CARTA_INVALIDO"],
        [{ logo: { ...LOGO, extension: "svg" } }, "LOGO_DE_CARTA_INVALIDO"],
        [
          { logo: { proveedor: "CLOUDINARY", cuenta: "c", idPublico: "i", version: "1" } },
          "LOGO_DE_CARTA_INVALIDO",
        ],
        [{ logo: "https://res.cloudinary.com/c/image/upload/v1/i.png" }, "LOGO_DE_CARTA_INVALIDO"],
      ];
      for (const [extra, error] of casos) {
        expect(
          await c.casos.guardarCartaPublica(e.gerente, nueva(e, extra)),
          JSON.stringify(extra),
        ).toEqual({ ok: false, error });
      }
      // Los bordes que sí valen.
      valorDe(
        await c.casos.guardarCartaPublica(
          e.gerente,
          nueva(e, {
            logo: { ...LOGO, cuenta: t(64), idPublico: t(200), version: "9".repeat(12) },
            colorPropio: "#000000",
          }),
        ),
      );
      expect(
        await c.contar("select count(*) as n from carta_publica where empresa_id = $1", [
          e.empresa,
        ]),
      ).toBe(1);
    });

    it("LIBRO y CUADRICULA exigen su perilla (hoy sin declarar en esta rama: se cierran); volver a LISTA no la pide", async () => {
      const e = await c.escenario();
      expect(await c.casos.guardarCartaPublica(e.gerente, nueva(e, { modelo: "LIBRO" }))).toEqual({
        ok: false,
        error: "MODELO_DE_CARTA_INVALIDO",
      });
      // CUADRICULA también cierra mientras su perilla no esté declarada (todo nace cerrado).
      expect(
        await c.casos.guardarCartaPublica(e.gerente, nueva(e, { modelo: "CUADRICULA" })),
      ).toEqual({ ok: false, error: "MODELO_DE_CARTA_INVALIDO" });
      // Volver a LISTA no pide nada: con la carta ya existente se acepta.
      const pedido = nueva(e);
      valorDe(await c.casos.guardarCartaPublica(e.gerente, pedido));
      await c.dueno.query("update carta_publica set modelo = 'CUADRICULA' where id = $1", [
        pedido.id,
      ]);
      valorDe(
        await c.casos.guardarCartaPublica(e.gerente, {
          ...pedido,
          modelo: "LISTA",
          versionEsperada: 2,
        }),
      );
      expect((await fila(pedido.id))?.modelo).toBe("LISTA");
    });

    // Se activa sola cuando la rama del Libro declare `vidriera_modelo_libro` en el catálogo de perillas (dependencia de integración).
    it.skipIf(!Object.hasOwn(CATALOGO_DE_PERILLAS, "vidriera_modelo_libro"))(
      "con la perilla `vidriera_modelo_libro` declarada y apagada, LIBRO es FUNCION_NO_INCLUIDA; volver a LISTA se acepta",
      async () => {
        const e = await c.escenario();
        expect(await c.casos.guardarCartaPublica(e.gerente, nueva(e, { modelo: "LIBRO" }))).toEqual(
          {
            ok: false,
            error: { codigo: "FUNCION_NO_INCLUIDA", perilla: "vidriera_modelo_libro" },
          },
        );
        valorDe(await c.casos.guardarCartaPublica(e.gerente, nueva(e, { modelo: "LISTA" })));
      },
    );

    it.skipIf(!Object.hasOwn(CATALOGO_DE_PERILLAS, "vidriera_modelo_cuadricula"))(
      "con la perilla `vidriera_modelo_cuadricula` declarada y apagada, CUADRICULA es FUNCION_NO_INCLUIDA",
      async () => {
        const e = await c.escenario();
        expect(
          await c.casos.guardarCartaPublica(e.gerente, nueva(e, { modelo: "CUADRICULA" })),
        ).toEqual({
          ok: false,
          error: { codigo: "FUNCION_NO_INCLUIDA", perilla: "vidriera_modelo_cuadricula" },
        });
      },
    );

    it("sin permiso `vidrieras.editar` no se guarda nada; y la carta de otra empresa no se toca por su id (aislamiento)", async () => {
      const e = await c.escenario();
      const pedido = nueva(e, { cara: "NOCHE" });
      expect((await c.casos.guardarCartaPublica(e.operador, pedido)).ok).toBe(false);
      valorDe(await c.casos.guardarCartaPublica(e.gerente, pedido));

      const otra = await c.escenario();
      const ajeno = await c.casos.guardarCartaPublica(otra.gerente, {
        ...pedido,
        sucursalId: otra.sucursal,
        cara: "BOLICHE",
        colorPropio: "#ff0000",
        versionEsperada: 1,
      });
      expect(ajeno.ok).toBe(false);
      expect(await fila(pedido.id)).toMatchObject({
        cara: "NOCHE",
        color_propio: null,
        version: "1",
      });
    });

    it("concurrencia: dos ediciones de la identidad con la misma versión, una gana y la otra recibe VERSION_DESACTUALIZADA", async () => {
      for (let ronda = 0; ronda < 6; ronda++) {
        const e = await c.escenario();
        const pedido = nueva(e);
        valorDe(await c.casos.guardarCartaPublica(e.gerente, pedido));
        const firme = <R extends { readonly ok: boolean }>(trabajo: () => Promise<R>) =>
          repetirSiAgotada(trabajo, { esAgotada: (r) => agotadaEnElResultado(r as never) });
        c.armarBarrera(2);
        let resultados;
        try {
          resultados = await Promise.all([
            firme(() =>
              c.casos.guardarCartaPublica(e.gerente, {
                ...pedido,
                cara: "BOLICHE",
                colorPropio: "#0e7490",
                versionEsperada: 1,
              }),
            ),
            firme(() =>
              c.casos.guardarCartaPublica(e.administrador, {
                ...pedido,
                cara: "NOCHE",
                colorPropio: "#7c2d12",
                versionEsperada: 1,
              }),
            ),
          ]);
        } finally {
          c.soltarBarrera();
        }
        perdedorAceptable(resultados, {
          esperados: ["VERSION_DESACTUALIZADA"],
          contexto: `ronda ${ronda}`,
        });
        expect(resultados.filter((r) => r.ok)).toHaveLength(1);
        const final = await fila(pedido.id);
        expect(final?.version).toBe("2");
        // Quien ganó dejó SU identidad completa, no una mezcla de las dos.
        expect([final?.cara, final?.color_propio]).toSatisfy(
          (v: unknown) =>
            JSON.stringify(v) === JSON.stringify(["BOLICHE", "#0e7490"]) ||
            JSON.stringify(v) === JSON.stringify(["NOCHE", "#7c2d12"]),
        );
      }
    });
  });

  describe("lectura pública (rol real)", () => {
    it("entrega la identidad ELEGIDA (sin ajustar), el color de la empresa y solo con el código de una carta en línea; una empresa no ve el color de la otra", async () => {
      const en = await montarEnsayo(c);
      const { vidriera, publicas } = adaptadorReal(c);
      try {
        const leer = async (codigo: string) =>
          await vidriera.porCodigo(deLaMarca(MARCA_DEL_HOST), codigo);
        // Sin nada elegido.
        expect((await leer(en.carta1.codigo))?.identidad).toEqual({
          modelo: "LISTA",
          cara: null,
          colorPropio: null,
          colorDeLaEmpresa: null,
          logo: null,
        });
        // Con identidad en la carta y color de la empresa.
        await c.dueno.query(
          `update carta_publica set cara = 'BOLICHE', color_propio = '#0e7490', modelo = 'CUADRICULA', logo_proveedor = 'CLOUDINARY', logo_cuenta = 'mi-cuenta_1',
                  logo_id_publico = 'logos/casa-central', logo_version = '1731700000', logo_extension = 'png' where id = $1`,
          [en.carta1.id],
        );
        await c.dueno.query(
          "insert into identidad_de_carta_empresa (empresa_id, color_principal) values ($1, '#1f4e79')",
          [en.e.empresa],
        );
        expect((await leer(en.carta1.codigo))?.identidad).toEqual({
          modelo: "CUADRICULA",
          cara: "BOLICHE",
          colorPropio: "#0e7490",
          colorDeLaEmpresa: "#1f4e79",
          logo: LOGO,
        });
        // La carta 2 es de la misma empresa: hereda el color de la empresa; la otra empresa no tiene ninguno.
        expect((await leer(en.carta2.codigo))?.identidad.colorDeLaEmpresa).toBe("#1f4e79");
        const ajena = await c.escenario();
        const cartaAjena = await cartaDeBase(c.dueno, ajena.empresa, ajena.sucursal);
        await c.dueno.query(
          "insert into identidad_de_carta_empresa (empresa_id, color_principal) values ($1, '#ff0000')",
          [ajena.empresa],
        );
        expect(await leer(cartaAjena.codigo)).toBeNull(); // sin plan de carta: no disponible, y su color no se filtra
        // Retirada: nada de identidad (la misma respuesta que un código inventado).
        await c.dueno.query("update carta_publica set estado = 'FUERA_DE_LINEA' where id = $1", [
          en.carta1.id,
        ]);
        expect(await leer(en.carta1.codigo)).toBeNull();
      } finally {
        await publicas.cerrar();
      }
    });
  });

  describe("la reversión", () => {
    it("sin datos borra todo y se puede repetir; con identidad cargada frena salvo confirmación; con 0078 aplicada frena por dependencia", async () => {
      const otra = await crearBaseAparte(base as BaseDePruebas);
      const cl = new pg.Client({ connectionString: otra.base.dueno });
      await cl.connect();
      try {
        const script = await readFile(REVERSION, "utf8");
        const correr = async (confirmar = false) => {
          await cl.query("begin");
          try {
            if (confirmar) await cl.query("set local pedernal.confirmar_reversion = 'SI'");
            await cl.query(script);
            await cl.query("commit");
          } catch (error) {
            await cl.query("rollback");
            throw error;
          }
        };
        const existe = async (tabla: string) =>
          (await cl.query<{ t: string | null }>("select to_regclass($1)::text as t", [tabla]))
            .rows[0]?.t !== null;
        const columnas = async () =>
          (
            await cl.query<{ n: number }>(
              `select count(*)::int as n from information_schema.columns where table_name = 'carta_publica' and column_name in ('modelo', 'cara', 'color_propio', 'logo_proveedor')`,
            )
          ).rows[0]?.n as number;

        // 0078 y 0083 (el portal) usan las funciones de 0077: se revierten antes (sin datos, no frenan).
        await cl.query("begin");
        await cl.query(await readFile(REVERSION_DEL_PORTAL_POR_PLAN, "utf8"));
        await cl.query(await readFile(REVERSION_DEL_PORTAL, "utf8"));
        await cl.query("commit");
        // Con una carta que eligió una cara: frena y no deja nada a medias.
        const e = await (
          await import("./carta-publica-apoyo")
        ).empresaDeCarta((await import("./entorno")).crearEntornoDePrueba(otra.base, 3), cl);
        const { id } = await cartaDeBase(cl, e.empresa, e.s1);
        await cl.query("update carta_publica set cara = 'NOCHE' where id = $1", [id]);
        await expect(correr()).rejects.toMatchObject({ code: "55000" });
        expect(await columnas()).toBe(4);
        expect(await existe("identidad_de_carta_empresa")).toBe(true);
        // Una sola cara cargada no es lo único que cuenta: el color de la empresa también frena.
        await cl.query("update carta_publica set cara = null where id = $1", [id]);
        await cl.query(
          "insert into identidad_de_carta_empresa (empresa_id, color_principal) values ($1, '#0e7490')",
          [e.empresa],
        );
        await expect(correr()).rejects.toMatchObject({ code: "55000" });
        expect(await existe("identidad_de_carta_empresa")).toBe(true);
        // Confirmada la pérdida: se aplica (la tabla y las columnas se van), y repetirla no cambia nada.
        const registrada = async () =>
          (
            await cl.query(
              "select 1 from migracion where nombre = '0077_identidad_de_la_carta.sql'",
            )
          ).rowCount;
        expect(await registrada()).toBe(1);
        await correr(true);
        await correr();
        // El registro de migraciones queda sin la fila: el ejecutor volvería a correrla.
        expect(await registrada()).toBe(0);
        expect(await existe("identidad_de_carta_empresa")).toBe(false);
        expect(await columnas()).toBe(0);
        expect(
          (
            await cl.query<{ f: string | null }>(
              "select to_regprocedure('color_de_carta_valido(text)')::text as f",
            )
          ).rows[0]?.f,
        ).toBeNull();
        // Re-aplicar 0077 sobre la base revertida funciona, y aplicarla dos veces seguidas no cambia nada (idempotente).
        const aplicar = await readFile(MIGRACION, "utf8");
        for (let vez = 0; vez < 2; vez++) {
          await cl.query("begin");
          await cl.query(aplicar);
          await cl.query("commit");
        }
        expect(await columnas()).toBe(4);
        expect(await existe("identidad_de_carta_empresa")).toBe(true);
        // La carta sigue ahí, intacta.
        expect((await cl.query("select 1 from carta_publica where id = $1", [id])).rowCount).toBe(
          1,
        );
      } finally {
        await cl.end();
        await otra.destruir();
      }
    });
  });
});
