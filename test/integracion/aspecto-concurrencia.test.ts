import { readdir } from "node:fs/promises";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { adminPlataformaId } from "../../src/primitivas/identificadores/marca";
import { ADMIN_DE_PRUEBA } from "./admins-de-prueba";
import { comoPlataforma, crearBarrera } from "./entorno";
import type { BaseDePruebas } from "./global";
import {
  ACTOR_DE_PRUEBA,
  CARPETA_DE_MIGRACIONES,
  baseConMigraciones,
  crearBorradorDeMarca,
  crearMarca,
} from "./marcas-apoyo";
import { SesionDePrueba, esperarBloqueo, type Intento } from "./sesiones";

/**
 * El aspecto de la marca (M7a), migración 0014: CONCURRENCIA con los roles reales y barrera sobre lo que
 * la base garantiza cuando dos acciones tocan el aspecto de un borrador a la vez, en `READ COMMITTED` y en
 * `SERIALIZABLE`:
 *  - dos ediciones del mismo borrador con el candado optimista (`version`): gana UNA, la otra se entera
 *    (0 filas o 40001) y nadie pierde trabajo en silencio;
 *  - el aspecto se reemplaza ENTERO: nunca queda una mezcla de dos ediciones (cada edición cambia los cinco
 *    tokens, así que una mezcla se vería);
 *  - repetir la misma edición no duplica nada ni cambia el resultado;
 *  - dos confirmaciones del mismo borrador: una sola, y la versión confirmada conserva el aspecto ENTERO;
 *  - confirmar mientras otro edita: o se confirma lo viejo entero (y la edición llega tarde y no toca la
 *    versión congelada) o lo nuevo entero.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

type Aislamiento = "read committed" | "serializable";
type Sentencia = readonly [string, readonly unknown[]];
const AISLAMIENTOS: readonly Aislamiento[] = ["read committed", "serializable"];
const VUELTAS = 10;

/** Cinco ediciones que difieren en TODOS los tokens entre sí: una mezcla de dos de ellas se notaría. */
const EDICIONES = [
  {
    estilo: "CLARO_CON_BORDES",
    superficie: "NEUTRA",
    esquinas: "RECTA",
    titulos: "SANS",
    ingreso: "DIVIDIDO",
  },
  {
    estilo: "MODERNO",
    superficie: "CALIDA",
    esquinas: "SUAVE",
    titulos: "SERIF",
    ingreso: "CENTRADO",
  },
  {
    estilo: "CLASICO",
    superficie: "FRIA",
    esquinas: "REDONDEADA",
    titulos: "SANS",
    ingreso: "CON_IMAGEN",
  },
  {
    estilo: "LUDICO",
    superficie: "NEUTRA",
    esquinas: "RECTA",
    titulos: "SERIF",
    ingreso: "DIVIDIDO",
  },
  {
    estilo: "MODERNO",
    superficie: "FRIA",
    esquinas: "SUAVE",
    titulos: "SANS",
    ingreso: "CENTRADO",
  },
] as const;
const texto = (edicion: object): string => JSON.stringify(edicion);

const archivos = async () => (await readdir(CARPETA_DE_MIGRACIONES)).sort();
const todasLasMigraciones = async (): Promise<string[]> =>
  (await archivos()).filter((n) => /^\d{4}_[a-z0-9_]+\.sql$/.test(n));

describe.skipIf(base === null)("aspecto de la marca: concurrencia", () => {
  let previa: Awaited<ReturnType<typeof baseConMigraciones>>;
  let dueno: pg.Client;
  let b: BaseDePruebas;

  beforeAll(async () => {
    if (base === null) return;
    previa = await baseConMigraciones(base, await todasLasMigraciones());
    dueno = previa.cliente;
    b = previa.aparte.base;
  });
  afterAll(async () => {
    await previa?.cerrar();
  });

  const abrirAdmin = (aislamiento: Aislamiento) =>
    SesionDePrueba.abrir(
      b,
      "zuluhub_plataforma",
      comoPlataforma({ tipo: "ADMIN", id: adminPlataformaId(ADMIN_DE_PRUEBA) }),
      aislamiento,
    );

  /**
   * Corre varias sentencias a la vez: cada una en su propia sesión y transacción, todas arrancan juntas
   * (barrera) y cada una confirma si le fue bien y deshace si no. Devuelve los resultados en orden.
   */
  async function carrera(
    sesiones: readonly SesionDePrueba[],
    sentencias: readonly Sentencia[],
  ): Promise<Intento[]> {
    const barrera = crearBarrera(sesiones.length);
    try {
      return await Promise.all(
        sesiones.map(async (s, i) => {
          await barrera();
          const [consulta, parametros] = sentencias[i] as Sentencia;
          const r = await s.directo(consulta, [...parametros]);
          if (!r.ok) {
            await s.deshacer();
            return r;
          }
          const c = await s.confirmar();
          return c.ok ? r : c;
        }),
      );
    } finally {
      await Promise.all(sesiones.map((s) => s.cerrar()));
    }
  }

  const filasDe = (r: Intento | undefined): number => (r?.ok === true ? r.filas : 0);
  /** Quien perdió la carrera: se enteró con 0 filas (el candado) o con una falla de serialización. */
  const sePerdio = (r: Intento | undefined): boolean =>
    r !== undefined && (r.ok ? r.filas === 0 : r.codigo === "40001");

  const borradorConAspecto = async (aspecto: object) => {
    const marca = await crearMarca(dueno);
    const id = await crearBorradorDeMarca(dueno, marca, {
      nombreVisible: "Marca",
      aspecto: aspecto as Record<string, unknown>,
    });
    return { marca, id };
  };
  const leerVersion = async (id: string) =>
    (
      await dueno.query<{
        aspecto: unknown;
        version: number;
        estado: string;
        numero: number | null;
      }>("select aspecto, version, estado, numero from version_de_marca where id = $1", [id])
    ).rows[0];

  const CONFIRMAR = `update version_de_marca set estado = 'CONFIRMADA',
            numero = (select coalesce(max(numero), 0) + 1 from version_de_marca where marca_id = $2),
            vigente_desde = now() - interval '30 seconds', motivo = 'x', confirmada_en = now(), confirmada_por = $3
          where id = $1`;

  describe.each(AISLAMIENTOS)("ediciones del aspecto de un borrador (%s)", (aislamiento) => {
    it.each([2, 5])(
      "%i ediciones con el MISMO candado de versión a la vez, en varias vueltas: gana UNA, las otras se enteran, y el aspecto queda ENTERO de la ganadora",
      async (competidores) => {
        for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
          const { id } = await borradorConAspecto({ estilo: "CLASICO" });
          const sesiones = await Promise.all(
            Array.from({ length: competidores }, () => abrirAdmin(aislamiento)),
          );
          const ediciones = EDICIONES.slice(0, competidores);
          const rs = await carrera(
            sesiones,
            ediciones.map(
              (e) =>
                [
                  "update version_de_marca set aspecto = $2::jsonb where id = $1 and version = 1",
                  [id, texto(e)],
                ] as const,
            ),
          );
          const ganadoras = rs.flatMap((r, i) => (filasDe(r) === 1 ? [i] : []));
          expect(ganadoras, `vuelta ${vuelta}`).toHaveLength(1);
          const perdedoras = rs.filter((_, i) => !ganadoras.includes(i));
          expect(perdedoras.every(sePerdio), JSON.stringify(rs)).toBe(true);
          const v = await leerVersion(id);
          // La edición ganadora entera, sin un token de otra; y el candado avanzó UNA sola vez.
          expect(v?.aspecto).toEqual(ediciones[ganadoras[0] as number]);
          expect(v?.version).toBe(2);
        }
      },
    );

    it("dos ediciones SIN candado a la vez: ambas se aplican una tras otra y el aspecto es el de UNA entera, nunca una mezcla", async () => {
      for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
        const { id } = await borradorConAspecto({});
        const sesiones = await Promise.all([abrirAdmin(aislamiento), abrirAdmin(aislamiento)]);
        const rs = await carrera(
          sesiones,
          EDICIONES.slice(0, 2).map(
            (e) =>
              [
                "update version_de_marca set aspecto = $2::jsonb where id = $1",
                [id, texto(e)],
              ] as const,
          ),
        );
        // En READ COMMITTED las dos se aplican; en SERIALIZABLE la segunda puede abortar por serialización.
        expect(rs.some((r) => filasDe(r) === 1)).toBe(true);
        for (const r of rs) expect(r.ok || r.codigo === "40001", JSON.stringify(r)).toBe(true);
        const v = await leerVersion(id);
        expect(EDICIONES.slice(0, 2)).toContainEqual(v?.aspecto);
        const ok = rs.filter((r) => filasDe(r) === 1).length;
        expect(v?.version).toBe(1 + ok);
      }
    });

    it("repetir la misma edición no duplica nada: con la versión vieja no hace nada, con la nueva deja el mismo aspecto", async () => {
      const { id } = await borradorConAspecto({});
      const s1 = await abrirAdmin(aislamiento);
      const [primera] = await carrera(
        [s1],
        [
          [
            "update version_de_marca set aspecto = $2::jsonb where id = $1 and version = 1",
            [id, texto(EDICIONES[1])],
          ],
        ],
      );
      expect(filasDe(primera)).toBe(1);
      // La misma edición con la misma versión esperada: ya no hay nada que aplicar (VERSION_DESACTUALIZADA).
      const s2 = await abrirAdmin(aislamiento);
      const [repetida] = await carrera(
        [s2],
        [
          [
            "update version_de_marca set aspecto = $2::jsonb where id = $1 and version = 1",
            [id, texto(EDICIONES[1])],
          ],
        ],
      );
      expect(filasDe(repetida)).toBe(0);
      expect(await leerVersion(id)).toMatchObject({ aspecto: EDICIONES[1], version: 2 });
      // Con la versión que ahora sí vio, la misma edición se aplica y el aspecto sigue siendo el mismo.
      const s3 = await abrirAdmin(aislamiento);
      const [otra] = await carrera(
        [s3],
        [
          [
            "update version_de_marca set aspecto = $2::jsonb where id = $1 and version = 2",
            [id, texto(EDICIONES[1])],
          ],
        ],
      );
      expect(filasDe(otra)).toBe(1);
      expect(await leerVersion(id)).toMatchObject({ aspecto: EDICIONES[1], version: 3 });
      const { rows } = await dueno.query("select 1 from version_de_marca where id = $1", [id]);
      expect(rows).toHaveLength(1);
    });

    it("ediciones de borradores de marcas DISTINTAS a la vez no se estorban: todas ganan, cada una con lo suyo", async () => {
      const borradores = await Promise.all(EDICIONES.map(() => borradorConAspecto({})));
      let sesiones = await Promise.all(EDICIONES.map(() => abrirAdmin(aislamiento)));
      const sentencias = borradores.map(
        ({ id }, i) =>
          [
            "update version_de_marca set aspecto = $2::jsonb where id = $1 and version = 1",
            [id, texto(EDICIONES[i] as object)],
          ] as const,
      );
      let rs = await carrera(sesiones, sentencias);
      // En SERIALIZABLE Postgres puede abortar alguna por un falso conflicto de lectura/escritura: se reintenta.
      for (const [i, r] of rs.entries()) {
        if (r.ok) continue;
        expect(r.codigo).toBe("40001");
        sesiones = [await abrirAdmin(aislamiento)];
        rs = await carrera(sesiones, [sentencias[i] as Sentencia]);
        expect(filasDe(rs[0]), `reintento ${i}`).toBe(1);
      }
      for (const [i, { id }] of borradores.entries()) {
        expect((await leerVersion(id))?.aspecto).toEqual(EDICIONES[i]);
      }
    });
  });

  describe.each(AISLAMIENTOS)("confirmaciones con aspecto (%s)", (aislamiento) => {
    it("dos confirmaciones del MISMO borrador a la vez: se confirma una vez y la versión conserva el aspecto ENTERO", async () => {
      for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
        const { marca, id } = await borradorConAspecto(EDICIONES[2]);
        const sesiones = await Promise.all([abrirAdmin(aislamiento), abrirAdmin(aislamiento)]);
        const rs = await carrera(
          sesiones,
          sesiones.map(() => [CONFIRMAR, [id, marca, ACTOR_DE_PRUEBA]] as const),
        );
        expect(
          rs.filter((r) => filasDe(r) === 1),
          `vuelta ${vuelta}`,
        ).toHaveLength(1);
        expect(rs.filter((r) => filasDe(r) !== 1).every(sePerdio), JSON.stringify(rs)).toBe(true);
        expect(await leerVersion(id)).toMatchObject({
          estado: "CONFIRMADA",
          numero: 1,
          aspecto: EDICIONES[2],
        });
        const { rows } = await dueno.query("select 1 from version_de_marca where marca_id = $1", [
          marca,
        ]);
        expect(rows).toHaveLength(1);
      }
    });

    it("confirma una mientras otra edita el aspecto: la edición llega tarde, no toca la versión congelada y esta conserva el aspecto de antes ENTERO", async () => {
      for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
        const { marca, id } = await borradorConAspecto(EDICIONES[0]);
        const confirma = await abrirAdmin(aislamiento);
        const edita = await abrirAdmin(aislamiento);
        // La confirmación ya escribió (sin cerrar la transacción)...
        expect((await confirma.directo(CONFIRMAR, [id, marca, ACTOR_DE_PRUEBA])).ok).toBe(true);
        // ...y la edición espera la fila.
        const edicion = edita.directo(
          "update version_de_marca set aspecto = $2::jsonb where id = $1 and version = 1",
          [id, texto(EDICIONES[3])],
        );
        expect(await esperarBloqueo(dueno, edita.pid), "la edición espera a la confirmación").toBe(
          true,
        );
        expect((await confirma.confirmar()).ok).toBe(true);
        const r = await edicion;
        // Con la fila ya congelada, la edición no encuentra su borrador (0 filas) o no puede serializarse.
        expect(sePerdio(r), JSON.stringify(r)).toBe(true);
        await Promise.all([confirma.cerrar(), edita.cerrar()]);
        expect(await leerVersion(id)).toMatchObject({
          estado: "CONFIRMADA",
          numero: 1,
          aspecto: EDICIONES[0],
        });
      }
    });

    it("edita una (sin cerrar) mientras otra confirma: la confirmación espera y congela lo ya editado, ENTERO", async () => {
      for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
        const { marca, id } = await borradorConAspecto(EDICIONES[0]);
        const edita = await abrirAdmin(aislamiento);
        const confirma = await abrirAdmin(aislamiento);
        expect(
          (
            await edita.directo(
              "update version_de_marca set aspecto = $2::jsonb where id = $1 and version = 1",
              [id, texto(EDICIONES[4])],
            )
          ).ok,
        ).toBe(true);
        const confirmacion = confirma.directo(CONFIRMAR, [id, marca, ACTOR_DE_PRUEBA]);
        expect(
          await esperarBloqueo(dueno, confirma.pid),
          "la confirmación espera a la edición",
        ).toBe(true);
        expect((await edita.confirmar()).ok).toBe(true);
        const r = await confirmacion;
        if (aislamiento === "read committed") {
          // Vuelve a leer la fila ya editada y la congela: nunca la versión vieja ni una mezcla.
          expect(filasDe(r), JSON.stringify(r)).toBe(1);
          expect((await confirma.confirmar()).ok).toBe(true);
          expect(await leerVersion(id)).toMatchObject({
            estado: "CONFIRMADA",
            numero: 1,
            aspecto: EDICIONES[4],
          });
        } else {
          // En SERIALIZABLE la confirmación se aborta (40001) y quien la pidió reintenta y ve lo nuevo.
          expect(!r.ok && r.codigo).toBe("40001");
          await confirma.deshacer();
          expect(await leerVersion(id)).toMatchObject({
            estado: "BORRADOR",
            aspecto: EDICIONES[4],
          });
        }
        await Promise.all([confirma.cerrar(), edita.cerrar()]);
      }
    });
  });
});
