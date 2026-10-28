import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  crearLecturasDeComprobantes,
  type ComprobanteId,
  type EntradaDeNotaManual,
  type FiscalDb,
  type SalidaDeEmitir,
} from "../../src/modulos/fiscal/publico";
import { empresaId } from "../../src/primitivas/identificadores/marca";
import { EmisionFalsa } from "../utilidades/emision-falsa";
import { renglon } from "../utilidades/facturacion";
import { crearBarrera, crearBaseAparte } from "./entorno";
import {
  RelojDePrueba,
  casosDeFacturacion,
  crearEntornoDeFacturacion,
  crearEscenarioDeCasos,
  facturaManual,
  notaManual,
} from "./facturacion-casos-apoyo";
import { crearEntornoDeConsultas } from "./facturacion-consultas-apoyo";

/**
 * Lo ya acreditado de una factura (D-16) y el motivo obligatorio de la nota de crédito (D-17), contra una base real
 * con el rol limitado de la aplicación y ARCA siempre falsa. Las notas se emiten con el caso de uso REAL
 * (`emitirNotaDeCredito`) y se miran con las consultas reales (`verComprobante`, `listarComprobantes`). Cubre:
 *  1. La cifra y la etiqueta: pendientes que cuentan, rechazadas y descartadas que no, sin tope.
 *  2. El listado trae la misma etiqueta que el detalle, con una consulta agregada por página (sin N+1).
 *  3. El aislamiento por empresa: la nota de otra empresa nunca suma.
 *  4. La idempotencia: la misma clave devuelve la misma nota y lo acreditado no se duplica.
 *  5. La concurrencia: notas parciales simultáneas con claves distintas quedan todas, sin tope.
 *  6. El motivo: obligatorio y de hasta 200 caracteres en la nota de crédito; opcional en la de débito.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

describe.skipIf(base === null)(
  "facturación: lo acreditado (D-16) y el motivo de la nota (D-17)",
  () => {
    let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
    let dueno: pg.Client;
    let entorno: ReturnType<typeof crearEntornoDeFacturacion>;
    let consultasEntorno: ReturnType<typeof crearEntornoDeConsultas>;
    /** Mientras haya una barrera, toda transacción de un caso de uso espera en ella al leer un comprobante. */
    let barrera: (() => Promise<void>) | null = null;

    beforeAll(async () => {
      if (base === null) return;
      propia = await crearBaseAparte(base);
      entorno = crearEntornoDeFacturacion(propia.base, 16, (tx) => ({
        ...tx,
        comprobantes: {
          ...tx.comprobantes,
          obtener: async (...args) => {
            const c = await tx.comprobantes.obtener(...args);
            if (barrera !== null) await barrera();
            return c;
          },
          delOrigen: async (...args) => {
            const cs = await tx.comprobantes.delOrigen(...args);
            if (barrera !== null) await barrera();
            return cs;
          },
        },
      }));
      consultasEntorno = crearEntornoDeConsultas(propia.base);
      dueno = new pg.Client({ connectionString: propia.base.dueno });
      await dueno.connect();
    });
    afterAll(async () => {
      await dueno.end();
      await entorno.cerrar();
      await consultasEntorno.transacciones.cerrar();
      await propia.destruir();
    });

    /** Una empresa con su reloj y su ARCA falsa; emite y autoriza facturas de 121,00 y notas sobre ellas. */
    async function preparar() {
      const e = await crearEscenarioDeCasos(dueno, propia.base);
      const reloj = new RelojDePrueba(new Date());
      const falsa = new EmisionFalsa();
      const casos = casosDeFacturacion(
        entorno,
        {
          HOMOLOGACION: falsa,
          PRODUCCION: new EmisionFalsa(),
        },
        reloj,
      );
      const como = () => e.como(reloj.ahora());
      const consultas = consultasEntorno.consultas();
      const exito = <T>(r: { ok: true; valor: T } | { ok: false; error: unknown }): T => {
        if (!r.ok) throw new Error(`tenía que ser un éxito: ${JSON.stringify(r.error)}`);
        return r.valor;
      };
      /** Una factura B de 121,00 ya AUTORIZADA. */
      const facturaAutorizada = async (): Promise<ComprobanteId> => {
        const emitida = exito(await casos.emitirComprobanteManual(como(), facturaManual(e)));
        exito(
          await casos.validarComprobante(e.sistema(reloj.ahora()), {
            comprobanteId: emitida.comprobanteId,
          }),
        );
        return emitida.comprobanteId;
      };
      const pedidoDeNota = (
        factura: ComprobanteId,
        total: string,
        cambios: Partial<EntradaDeNotaManual> = {},
      ) => notaManual(factura, { renglones: [renglon(total, "1", "21")], ...cambios });
      /** Una nota de crédito por `total`, que queda pendiente (todavía no pasó por ARCA). */
      const notaPendiente = async (
        factura: ComprobanteId,
        total: string,
        cambios: Partial<EntradaDeNotaManual> = {},
      ): Promise<SalidaDeEmitir> =>
        exito(await casos.emitirNotaDeCredito(como(), pedidoDeNota(factura, total, cambios)));
      const validar = async (id: ComprobanteId) =>
        exito(await casos.validarComprobante(e.sistema(reloj.ahora()), { comprobanteId: id }));
      const detalle = async (id: ComprobanteId) =>
        exito(await consultas.verComprobante(como(), { comprobanteId: id }));
      const listado = async (pedido: Parameters<typeof consultas.listarComprobantes>[1] = {}) =>
        exito(await consultas.listarComprobantes(como(), pedido)).items;
      const acreditacionEnLista = async (id: ComprobanteId) =>
        (await listado({ limite: 50 })).find((i) => i.id === id)?.acreditacion;
      return {
        e,
        casos,
        falsa,
        como,
        consultas,
        exito,
        facturaAutorizada,
        pedidoDeNota,
        notaPendiente,
        validar,
        detalle,
        listado,
        acreditacionEnLista,
      };
    }

    const filas = async <T extends Record<string, unknown>>(texto: string, p: unknown[] = []) =>
      (await dueno.query<T>(texto, p)).rows;

    // ===============================================================================================
    describe("la cifra y la etiqueta", () => {
      it("sin notas: 0.00 y NINGUNA, en el detalle y en el listado", async () => {
        const p = await preparar();
        const factura = await p.facturaAutorizada();
        expect(await p.detalle(factura)).toMatchObject({
          estado: "AUTORIZADO",
          acreditado: "0.00",
          acreditacion: "NINGUNA",
        });
        expect(await p.acreditacionEnLista(factura)).toBe("NINGUNA");
      });

      it("una nota pendiente ya cuenta (D-15); al autorizarse sigue contando; la factura sigue AUTORIZADA", async () => {
        const p = await preparar();
        const factura = await p.facturaAutorizada();
        const nota = await p.notaPendiente(factura, "60.50");
        expect(nota.estado).toBe("PENDIENTE");
        expect(await p.detalle(factura)).toMatchObject({
          estado: "AUTORIZADO",
          acreditado: "60.50",
          acreditacion: "PARCIAL",
        });
        expect(await p.acreditacionEnLista(factura)).toBe("PARCIAL");
        await p.validar(nota.comprobanteId);
        expect(await p.detalle(factura)).toMatchObject({
          estado: "AUTORIZADO",
          acreditado: "60.50",
          acreditacion: "PARCIAL",
        });
        const enLaLista = await p.listado({ limite: 50 });
        expect(enLaLista.find((i) => i.id === nota.comprobanteId)?.acreditacion).toBeNull();
      });

      it("bordes: un centavo menos es PARCIAL, el total exacto es TOTAL, un centavo más es TOTAL (sin tope ni aviso)", async () => {
        const p = await preparar();
        const f1 = await p.facturaAutorizada();
        await p.notaPendiente(f1, "120.99");
        expect(await p.detalle(f1)).toMatchObject({
          acreditado: "120.99",
          acreditacion: "PARCIAL",
        });
        expect(await p.acreditacionEnLista(f1)).toBe("PARCIAL");

        const f2 = await p.facturaAutorizada();
        await p.notaPendiente(f2, "121.00");
        expect(await p.detalle(f2)).toMatchObject({ acreditado: "121.00", acreditacion: "TOTAL" });
        expect(await p.acreditacionEnLista(f2)).toBe("TOTAL");

        const f3 = await p.facturaAutorizada();
        await p.notaPendiente(f3, "121.01");
        expect(await p.detalle(f3)).toMatchObject({ acreditado: "121.01", acreditacion: "TOTAL" });
        expect(await p.acreditacionEnLista(f3)).toBe("TOTAL");
      });

      it("varias notas suman exacto, también pasándose del total", async () => {
        const p = await preparar();
        const factura = await p.facturaAutorizada();
        for (const total of ["33.33", "33.33", "33.33"]) await p.notaPendiente(factura, total);
        expect(await p.detalle(factura)).toMatchObject({
          acreditado: "99.99",
          acreditacion: "PARCIAL",
        });
        await p.notaPendiente(factura, "21.02");
        expect(await p.detalle(factura)).toMatchObject({
          acreditado: "121.01",
          acreditacion: "TOTAL",
        });
        await p.notaPendiente(factura, "100.00");
        expect(await p.detalle(factura)).toMatchObject({
          acreditado: "221.01",
          acreditacion: "TOTAL",
        });
        expect(await p.acreditacionEnLista(factura)).toBe("TOTAL");
      });

      it("una nota rechazada por ARCA deja de contar; una descartada no cuenta; las pendientes e inciertas sí", async () => {
        const p = await preparar();
        const factura = await p.facturaAutorizada();
        const rechazada = await p.notaPendiente(factura, "50.00");
        const descartada = await p.notaPendiente(factura, "30.00");
        const incierta = await p.notaPendiente(factura, "10.00");
        await p.notaPendiente(factura, "1.00");
        expect(await p.detalle(factura)).toMatchObject({ acreditado: "91.00" });

        p.falsa.programar("RECHAZA");
        await p.validar(rechazada.comprobanteId);
        expect(
          (await p.detalle(factura)).notasQueLoCitan.find((n) => n.id === rechazada.comprobanteId),
        ).toMatchObject({ estado: "RECHAZADO" });
        expect(await p.detalle(factura)).toMatchObject({ acreditado: "41.00" });

        exitoDeDescarte(
          await p.casos.descartarComprobante(p.como(), {
            comprobanteId: descartada.comprobanteId,
            motivo: "se cargó dos veces",
            versionEsperada: 1,
          }),
        );
        expect(await p.detalle(factura)).toMatchObject({
          acreditado: "11.00",
          acreditacion: "PARCIAL",
        });

        p.falsa.programar("INCIERTO");
        await p.validar(incierta.comprobanteId);
        expect(
          (await p.detalle(factura)).notasQueLoCitan.find((n) => n.id === incierta.comprobanteId),
        ).toMatchObject({ estado: "INCIERTO" });
        // «Confirmando» sigue contando.
        expect(await p.detalle(factura)).toMatchObject({ acreditado: "11.00" });
        expect(await p.acreditacionEnLista(factura)).toBe("PARCIAL");
      });

      it("una nota de débito no acredita; una nota de crédito en sí no tiene etiqueta ni cifra", async () => {
        const p = await preparar();
        const factura = await p.facturaAutorizada();
        p.exito(await p.casos.emitirNotaDeDebito(p.como(), p.pedidoDeNota(factura, "500.00")));
        expect(await p.detalle(factura)).toMatchObject({
          acreditado: "0.00",
          acreditacion: "NINGUNA",
        });
        const nc = await p.notaPendiente(factura, "10.00");
        expect(await p.detalle(nc.comprobanteId)).toMatchObject({
          acreditado: null,
          acreditacion: null,
        });
        const filasDeLista = await p.listado({ limite: 50 });
        expect(filasDeLista.find((i) => i.id === nc.comprobanteId)?.acreditacion).toBeNull();
        const nd = filasDeLista.find((i) => i.tipo === "NOTA_DEBITO_B");
        expect(nd?.acreditacion).toBe("NINGUNA");
      });
    });

    // ===============================================================================================
    describe("el listado: una consulta agregada por página, sin N+1", () => {
      it("la cantidad de consultas no depende de cuántas filas tiene la página", async () => {
        const p = await preparar();
        const facturas: ComprobanteId[] = [];
        for (let i = 0; i < 5; i++) {
          const f = await p.facturaAutorizada();
          facturas.push(f);
          await p.notaPendiente(f, i % 2 === 0 ? "10.00" : "121.00");
        }
        const medir = async (limite: number) => {
          const antes = consultasEntorno.consultasFiscalesHechas();
          const items = await p.listado({ limite });
          return {
            consultas: consultasEntorno.consultasFiscalesHechas() - antes,
            filas: items.length,
          };
        };
        const una = await medir(1);
        const todas = await medir(50);
        expect(una.filas).toBe(1);
        expect(todas.filas).toBe(10); // 5 facturas y 5 notas
        // La página y UNA lectura agregada de las notas: nunca una por fila.
        expect(una.consultas).toBe(2);
        expect(todas.consultas).toBe(2);
        const lista = await p.listado({ limite: 50 });
        expect(facturas.map((f) => lista.find((i) => i.id === f)?.acreditacion)).toEqual([
          "PARCIAL",
          "TOTAL",
          "PARCIAL",
          "TOTAL",
          "PARCIAL",
        ]);
      });

      it("una página vacía no hace la lectura de notas", async () => {
        const p = await preparar();
        const antes = consultasEntorno.consultasFiscalesHechas();
        expect(await p.listado()).toEqual([]);
        expect(consultasEntorno.consultasFiscalesHechas() - antes).toBe(1);
      });
    });

    // ===============================================================================================
    describe("aislamiento por empresa", () => {
      it("la nota de otra empresa nunca suma, ni en el detalle, ni en el listado, ni en la lectura", async () => {
        const a = await preparar();
        const b = await preparar();
        const facturaA = await a.facturaAutorizada();
        const facturaB = await b.facturaAutorizada();
        await a.notaPendiente(facturaA, "40.00");
        await b.notaPendiente(facturaB, "121.00");
        await b.notaPendiente(facturaB, "5.00");

        expect(await a.detalle(facturaA)).toMatchObject({
          acreditado: "40.00",
          acreditacion: "PARCIAL",
        });
        expect(await b.detalle(facturaB)).toMatchObject({
          acreditado: "126.00",
          acreditacion: "TOTAL",
        });
        expect(await a.acreditacionEnLista(facturaA)).toBe("PARCIAL");
        expect(await b.acreditacionEnLista(facturaB)).toBe("TOTAL");
        // La factura de la otra empresa ni se ve.
        expect(await a.consultas.verComprobante(a.como(), { comprobanteId: facturaB })).toEqual({
          ok: false,
          error: "COMPROBANTE_NO_ENCONTRADO",
        });
        expect((await a.listado({ limite: 50 })).map((i) => i.id)).not.toContain(facturaB);

        // La lectura filtra por empresa por sí misma, aun sin RLS (el dueño de la base la evade).
        const sinRls = new Kysely<FiscalDb>({
          dialect: new PostgresDialect({
            pool: new pg.Pool({ connectionString: propia.base.dueno, max: 1 }),
          }),
        });
        try {
          const lecturas = crearLecturasDeComprobantes(sinRls);
          const deA = await lecturas.notasQueCitanA(empresaId(a.e.empresa), [facturaA, facturaB]);
          expect([...deA.keys()]).toEqual([facturaA]);
          expect(deA.get(facturaA)).toHaveLength(1);
          const deB = await lecturas.notasQueCitanA(empresaId(b.e.empresa), [facturaA]);
          expect(deB.size).toBe(0);
        } finally {
          await sinRls.destroy();
        }
      });
    });

    // ===============================================================================================
    describe("idempotencia", () => {
      it("emitir la misma nota con la misma clave devuelve la misma nota y lo acreditado no se duplica", async () => {
        const p = await preparar();
        const factura = await p.facturaAutorizada();
        const pedido = p.pedidoDeNota(factura, "60.50");
        const primera = p.exito(await p.casos.emitirNotaDeCredito(p.como(), pedido));
        const segunda = p.exito(await p.casos.emitirNotaDeCredito(p.como(), pedido));
        expect(primera.yaExistia).toBe(false);
        expect(segunda).toMatchObject({ comprobanteId: primera.comprobanteId, yaExistia: true });
        expect(await p.detalle(factura)).toMatchObject({
          acreditado: "60.50",
          acreditacion: "PARCIAL",
        });
        expect((await p.detalle(factura)).notasQueLoCitan).toHaveLength(1);
        // También después de autorizarse la nota, y con un tercer toque.
        await p.validar(primera.comprobanteId);
        const tercera = p.exito(await p.casos.emitirNotaDeCredito(p.como(), pedido));
        expect(tercera).toMatchObject({ comprobanteId: primera.comprobanteId, yaExistia: true });
        expect(await p.detalle(factura)).toMatchObject({ acreditado: "60.50" });
        expect(
          await filas(
            "select 1 from comprobante where empresa_id = $1 and clase = 'NOTA_CREDITO'",
            [p.e.empresa],
          ),
        ).toHaveLength(1);
      });

      it("la misma clave con OTRO importe es CLAVE_REUTILIZADA y no suma nada", async () => {
        const p = await preparar();
        const factura = await p.facturaAutorizada();
        const clave = randomUUID();
        p.exito(
          await p.casos.emitirNotaDeCredito(p.como(), p.pedidoDeNota(factura, "10.00", { clave })),
        );
        expect(
          await p.casos.emitirNotaDeCredito(p.como(), p.pedidoDeNota(factura, "99.00", { clave })),
        ).toEqual({ ok: false, error: "CLAVE_REUTILIZADA" });
        expect(await p.detalle(factura)).toMatchObject({ acreditado: "10.00" });
      });

      it("dos emisiones simultáneas de la misma nota: una sola nota y lo acreditado cuenta una vez", async () => {
        const p = await preparar();
        const factura = await p.facturaAutorizada();
        const pedido = p.pedidoDeNota(factura, "40.00");
        barrera = crearBarrera(2);
        let rs;
        try {
          rs = await Promise.all([
            p.casos.emitirNotaDeCredito(p.como(), pedido),
            p.casos.emitirNotaDeCredito(p.como(), pedido),
          ]);
        } finally {
          barrera = null;
        }
        const [a, b] = rs.map((r) => p.exito(r));
        expect(a?.comprobanteId).toBe(b?.comprobanteId);
        expect([a?.yaExistia, b?.yaExistia].sort()).toEqual([false, true]);
        expect(await p.detalle(factura)).toMatchObject({
          acreditado: "40.00",
          acreditacion: "PARCIAL",
        });
      });
    });

    // ===============================================================================================
    describe("concurrencia", () => {
      it("notas parciales simultáneas con claves distintas quedan todas (no hay tope) y lo acreditado es la suma exacta", async () => {
        for (let ronda = 0; ronda < 3; ronda++) {
          const p = await preparar();
          const factura = await p.facturaAutorizada();
          const importes = ["40.00", "40.00", "40.01", "0.99"];
          barrera = crearBarrera(importes.length);
          let rs;
          try {
            rs = await Promise.all(
              importes.map((total) =>
                p.casos.emitirNotaDeCredito(p.como(), p.pedidoDeNota(factura, total)),
              ),
            );
          } finally {
            barrera = null;
          }
          const salidas = rs.map((r) => p.exito(r));
          expect(new Set(salidas.map((s) => s.comprobanteId)).size, `ronda ${ronda}`).toBe(4);
          expect(salidas.every((s) => !s.yaExistia)).toBe(true);
          const d = await p.detalle(factura);
          expect(d.notasQueLoCitan).toHaveLength(4);
          // 40.00 + 40.00 + 40.01 + 0.99 = 121.00: justo el total, y las cuatro quedaron.
          expect(d).toMatchObject({
            acreditado: "121.00",
            acreditacion: "TOTAL",
            estado: "AUTORIZADO",
          });
          expect(await p.acreditacionEnLista(factura)).toBe("TOTAL");
        }
      });

      it("sin tope: dos notas por el total completo a la vez quedan las dos y se pasa del total", async () => {
        const p = await preparar();
        const factura = await p.facturaAutorizada();
        barrera = crearBarrera(2);
        let rs;
        try {
          rs = await Promise.all([
            p.casos.emitirNotaDeCredito(p.como(), p.pedidoDeNota(factura, "121.00")),
            p.casos.emitirNotaDeCredito(p.como(), p.pedidoDeNota(factura, "121.00")),
          ]);
        } finally {
          barrera = null;
        }
        rs.forEach((r) => p.exito(r));
        expect(await p.detalle(factura)).toMatchObject({
          acreditado: "242.00",
          acreditacion: "TOTAL",
        });
      });
    });

    // ===============================================================================================
    describe("el motivo de la nota (D-17)", () => {
      const comprobantes = async (empresa: string) =>
        (await filas("select 1 from comprobante where empresa_id = $1", [empresa])).length;

      it("la nota de crédito sin motivo, con motivo vacío o de solo espacios se rechaza y no escribe nada", async () => {
        const p = await preparar();
        const factura = await p.facturaAutorizada();
        const antes = await comprobantes(p.e.empresa);
        for (const motivo of [null, "", "   ", "\t \n"]) {
          expect(
            await p.casos.emitirNotaDeCredito(
              p.como(),
              p.pedidoDeNota(factura, "10.00", { motivo }),
            ),
            JSON.stringify(motivo),
          ).toEqual({ ok: false, error: { codigo: "MOTIVO_INVALIDO" } });
        }
        expect(await comprobantes(p.e.empresa)).toBe(antes);
        expect(await p.detalle(factura)).toMatchObject({ acreditado: "0.00" });
      });

      it("200 caracteres pasan (y se guardan recortados); 201 se rechazan", async () => {
        const p = await preparar();
        const factura = await p.facturaAutorizada();
        const justo = p.exito(
          await p.casos.emitirNotaDeCredito(
            p.como(),
            p.pedidoDeNota(factura, "10.00", { motivo: `  ${"m".repeat(200)}  ` }),
          ),
        );
        const guardada = await filas<{ motivo: string }>(
          "select motivo from comprobante where id = $1",
          [justo.comprobanteId],
        );
        expect(guardada[0]?.motivo).toBe("m".repeat(200));
        expect(
          await p.casos.emitirNotaDeCredito(
            p.como(),
            p.pedidoDeNota(factura, "10.00", { motivo: "m".repeat(201) }),
          ),
        ).toEqual({ ok: false, error: { codigo: "MOTIVO_INVALIDO" } });
      });

      it("la nota de débito sigue con motivo opcional (sin motivo, vacío o con espacios); con más de 200 no", async () => {
        const p = await preparar();
        const factura = await p.facturaAutorizada();
        for (const motivo of [null, "", "   "]) {
          const nd = p.exito(
            await p.casos.emitirNotaDeDebito(
              p.como(),
              p.pedidoDeNota(factura, "10.00", { motivo }),
            ),
          );
          const g = await filas<{ motivo: string | null }>(
            "select motivo from comprobante where id = $1",
            [nd.comprobanteId],
          );
          expect(g[0]?.motivo).toBeNull();
        }
        expect(
          await p.casos.emitirNotaDeDebito(
            p.como(),
            p.pedidoDeNota(factura, "10.00", { motivo: "m".repeat(201) }),
          ),
        ).toEqual({ ok: false, error: { codigo: "MOTIVO_INVALIDO" } });
      });

      it("repetir con la misma clave una nota ya emitida devuelve la misma nota, aunque ahora el motivo se exija", async () => {
        const p = await preparar();
        const factura = await p.facturaAutorizada();
        const pedido = p.pedidoDeNota(factura, "10.00");
        const primera = p.exito(await p.casos.emitirNotaDeCredito(p.como(), pedido));
        const otra = p.exito(await p.casos.emitirNotaDeCredito(p.como(), pedido));
        expect(otra.comprobanteId).toBe(primera.comprobanteId);
      });
    });
  },
);

function exitoDeDescarte(r: { ok: boolean; error?: unknown }): void {
  if (!r.ok) throw new Error(`no se descartó: ${JSON.stringify(r.error)}`);
}
