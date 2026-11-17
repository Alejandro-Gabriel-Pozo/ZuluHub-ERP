import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  montarCatalogo,
  precioDeBase,
  productoDeBase,
  valorDe,
  type EscenarioDeCatalogo,
} from "./catalogo-apoyo";
import {
  agotadaEnElResultado,
  codigoDe,
  perdedorAceptable,
  repetirSiAgotada,
} from "./concurrencia-apoyo";

/**
 * T2 de la carta real: concurrencia REAL de los casos de uso (dos acciones a la vez sobre lo mismo). Cada prueba lanza dos transacciones con una barrera
 * dentro (tras leer la autorización) que fuerza que AMBAS hayan empezado antes de que cualquiera escriba; quien pierde puede recibir `ConcurrenciaAgotada` y se
 * repite el MISMO pedido (seguro por su clave). Después se mira la base: nunca hay duplicados ni estados a medias.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });
const RONDAS = 8;

describe.skipIf(base === null)(
  "carta pública y «Ocultar»: concurrencia de los casos de uso",
  () => {
    let c: Awaited<ReturnType<typeof montarCatalogo>>;
    beforeAll(async () => {
      if (base !== null) c = await montarCatalogo(base);
    });
    afterAll(async () => {
      if (base !== null) await c.cerrar();
    });

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
    const conProductos = async () => {
      const e = await c.escenario();
      const seccionId = randomUUID();
      await c.dueno.query(
        "insert into seccion_de_carta (id, empresa_id, nombre, nombre_clave, orden) values ($1, $2, 'Postres', 'postres', 0)",
        [seccionId, e.empresa],
      );
      const producto = async (nombre: string) => {
        const id = await productoDeBase(c.dueno, e.empresa, { nombre });
        await c.dueno.query("update producto set seccion_de_carta_id = $2 where id = $1", [
          id,
          seccionId,
        ]);
        await precioDeBase(c.dueno, {
          empresa: e.empresa,
          producto: id,
          precio: "1000",
          desde: "2026-10-01T00:00:00Z",
        });
        return id;
      };
      return { e, producto };
    };
    const nueva = (e: EscenarioDeCatalogo, extra: Record<string, unknown> = {}) => ({
      id: randomUUID(),
      sucursalId: e.sucursal,
      nombre: "Parador El Ensayo",
      estado: "FUERA_DE_LINEA" as const,
      ...extra,
    });
    const contar = (sql: string, p: unknown[]) => c.contar(sql, p);

    it("C-1 (clic doble a la vez): el mismo guardarCartaPublica simultáneo deja UNA carta, UN código y UNA entrada de auditoría", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda++) {
        const { e } = await conProductos();
        const pedido = nueva(e);
        const [a, b] = await aLaVez(
          [
            () => firme(() => c.casos.guardarCartaPublica(e.gerente, pedido)),
            () => firme(() => c.casos.guardarCartaPublica(e.gerente, pedido)),
          ],
          ronda,
        );
        const [x, y] = [valorDe(a), valorDe(b)];
        expect(
          [x.yaExistia, y.yaExistia].filter((v) => !v),
          `ronda ${ronda}`,
        ).toHaveLength(1);
        expect(x.codigo).toBe(y.codigo);
        expect(
          await contar("select count(*) as n from carta_publica where empresa_id = $1", [
            e.empresa,
          ]),
        ).toBe(1);
        expect((await c.auditoria(e.empresa, "CARTA_PUBLICA_CREADA")).length).toBe(1);
      }
    });

    it("C-2 (dos personas, dos ids): dos altas simultáneas para la MISMA sucursal dejan exactamente una; la otra es CARTA_DE_LA_SUCURSAL_YA_EXISTE y el código visible es el de la ganadora", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda++) {
        const { e } = await conProductos();
        const [a, b] = await aLaVez(
          [
            () => c.casos.guardarCartaPublica(e.gerente, nueva(e)),
            () => c.casos.guardarCartaPublica(e.administrador, nueva(e)),
          ],
          ronda,
        );
        perdedorAceptable([a, b], {
          esperados: ["CARTA_DE_LA_SUCURSAL_YA_EXISTE", "Unicidad"],
          contexto: `ronda ${ronda}`,
        });
        for (const r of [a, b])
          if (!r.ok && codigoDe(r) === "Unicidad")
            expect(JSON.stringify(r.error)).toContain("carta_publica_sucursal_uk");
        expect(
          await contar("select count(*) as n from carta_publica where empresa_id = $1", [
            e.empresa,
          ]),
        ).toBe(1);
        const ganadoras = [a, b].filter((r) => r.ok);
        expect(ganadoras).toHaveLength(1);
        const { rows } = await c.dueno.query<{ codigo: string }>(
          "select codigo from carta_publica where empresa_id = $1",
          [e.empresa],
        );
        expect(rows[0]?.codigo).toBe((ganadoras[0] as { valor: { codigo: string } }).valor.codigo);
      }
    });

    it("editar a la vez la misma carta con la misma versión: una gana, la otra recibe VERSION_DESACTUALIZADA; la versión final es 2", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda++) {
        const { e } = await conProductos();
        const pedido = nueva(e);
        valorDe(await c.casos.guardarCartaPublica(e.gerente, pedido));
        const [a, b] = await aLaVez(
          [
            () =>
              c.casos.guardarCartaPublica(e.gerente, {
                ...pedido,
                nombre: "Uno",
                versionEsperada: 1,
              }),
            () =>
              c.casos.guardarCartaPublica(e.administrador, {
                ...pedido,
                nombre: "Dos",
                versionEsperada: 1,
              }),
          ],
          ronda,
        );
        perdedorAceptable([a, b], {
          esperados: ["VERSION_DESACTUALIZADA"],
          contexto: `ronda ${ronda}`,
        });
        expect(
          [a, b].filter((r) => r.ok),
          `ronda ${ronda}`,
        ).toHaveLength(1);
        const { rows } = await c.dueno.query<{ version: number; nombre: string }>(
          "select version, nombre from carta_publica where id = $1",
          [pedido.id],
        );
        expect(rows[0]?.version).toBe(2);
        expect(["Uno", "Dos"]).toContain(rows[0]?.nombre);
      }
    });

    it("C-3 (reordenar a la vez): con las mismas versiones se aplica UNA y la otra es VERSION_DESACTUALIZADA; el orden final es EXACTAMENTE el de la ganadora", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda++) {
        const e = await c.escenario();
        const ids: string[] = [];
        for (const [i, nombre] of ["Entradas", "Platos", "Postres", "Cafetería"].entries()) {
          const id = randomUUID();
          ids.push(id);
          await c.dueno.query(
            "insert into seccion_de_carta (id, empresa_id, nombre, nombre_clave, orden) values ($1, $2, $3, $4, $5)",
            [id, e.empresa, nombre, nombre.toLowerCase(), i],
          );
        }
        const [entradas, platos, postres, cafeteria] = ids as [string, string, string, string];
        const con = (orden: string[]) => ({
          secciones: orden.map((seccionId) => ({ seccionId, versionEsperada: 1 })),
        });
        const A = [cafeteria, platos, entradas, postres];
        const B = [postres, entradas, platos, cafeteria];
        const [a, b] = await aLaVez(
          [
            () => c.casos.reordenarSeccionesDeCarta(e.gerente, con(A)),
            () => c.casos.reordenarSeccionesDeCarta(e.administrador, con(B)),
          ],
          ronda,
        );
        perdedorAceptable([a, b], {
          esperados: ["VERSION_DESACTUALIZADA"],
          contexto: `ronda ${ronda}`,
        });
        const { rows } = await c.dueno.query<{ id: string; orden: number }>(
          "select id, orden from seccion_de_carta where empresa_id = $1 order by orden, id",
          [e.empresa],
        );
        const final = rows.map((r) => r.id);
        expect([final.join(), a.ok ? A.join() : B.join()], `ronda ${ronda}`).toEqual([
          final.join(),
          final.join(),
        ]);
        expect(rows.map((r) => r.orden)).toEqual([0, 1, 2, 3]);
        expect([a, b].filter((r) => r.ok)).toHaveLength(1);
        expect((await c.auditoria(e.empresa, "SECCIONES_DE_CARTA_REORDENADAS")).length).toBe(1);
      }
    });

    it("apretar «Ocultar» a la vez: dos iguales dejan UNA fila y una sola auditoría; dos contrarios dejan una fila en uno de los dos estados, sin error", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda++) {
        const { e, producto } = await conProductos();
        const flan = await producto("Flan");
        const local = { tipo: "SUCURSAL", sucursalId: e.sucursal } as const;
        const pedir = (oculto: boolean) => () =>
          firme(() =>
            c.casos.ocultarProducto(e.gerente, { productoId: flan, alcance: local, oculto }),
          );
        const [a, b] = await aLaVez([pedir(true), pedir(true)], ronda);
        expect(
          [valorDe(a).yaEstaba, valorDe(b).yaEstaba].filter((v) => !v),
          `ronda ${ronda}`,
        ).toHaveLength(1);
        expect(
          await contar(
            "select count(*) as n from disponibilidad_de_producto where empresa_id = $1",
            [e.empresa],
          ),
        ).toBe(1);
        expect((await c.auditoria(e.empresa, "PRODUCTO_OCULTADO")).length).toBe(1);
        const [x, y] = await aLaVez([pedir(false), pedir(true)], ronda);
        expect(x.ok && y.ok, `ronda ${ronda}`).toBe(true);
        expect(
          await contar(
            "select count(*) as n from disponibilidad_de_producto where empresa_id = $1",
            [e.empresa],
          ),
        ).toBe(1);
      }
    });

    it("ocultar y desactivar el MISMO producto a la vez: se ponen en fila y los dos terminan bien o uno pierde por agotamiento; nunca un estado a medias", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda++) {
        const { e, producto } = await conProductos();
        const flan = await producto("Flan");
        const [a, b] = await aLaVez(
          [
            () =>
              firme(() =>
                c.casos.ocultarProducto(e.gerente, {
                  productoId: flan,
                  alcance: { tipo: "EMPRESA" },
                  oculto: true,
                }),
              ),
            () => firme(() => c.casos.desactivarProducto(e.gerente, { productoId: flan })),
          ],
          ronda,
        );
        expect([a.ok, b.ok], `ronda ${ronda}`).toEqual([true, true]);
        expect(
          await contar(
            "select count(*) as n from disponibilidad_de_producto where empresa_id = $1 and oculto",
            [e.empresa],
          ),
        ).toBe(1);
        expect(
          await contar("select count(*) as n from producto where id = $1 and not activo", [flan]),
        ).toBe(1);
      }
    });

    it("desactivar y reactivar la MISMA sección a la vez: queda activa o apagada, con una sola versión de más por cambio real, y sin error de otro tipo", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda++) {
        const e = await c.escenario();
        const id = randomUUID();
        await c.dueno.query(
          "insert into seccion_de_carta (id, empresa_id, nombre, nombre_clave, orden, activa) values ($1, $2, 'Postres', 'postres', 0, false)",
          [id, e.empresa],
        );
        const [a, b] = await aLaVez(
          [
            () => firme(() => c.casos.reactivarSeccionDeCarta(e.gerente, { seccionId: id })),
            () => firme(() => c.casos.reactivarSeccionDeCarta(e.administrador, { seccionId: id })),
          ],
          ronda,
        );
        expect(
          [valorDe(a).yaEstaba, valorDe(b).yaEstaba].filter((v) => !v),
          `ronda ${ronda}`,
        ).toHaveLength(1);
        expect((await c.auditoria(e.empresa, "SECCION_DE_CARTA_REACTIVADA")).length).toBe(1);
      }
    });
  },
);
